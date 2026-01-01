import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UserSite {
  site_id: string;
  site_name?: string;
}

interface TTNConnection {
  enabled: boolean;
  provisioning_status?: string | null;
  cluster?: string | null;
  application_id?: string | null;
  webhook_id?: string | null;
  webhook_url?: string | null;
  api_key_last4?: string | null;
  webhook_secret_last4?: string | null;
  updated_at?: string | null;
}

interface SyncedUser {
  user_id: string;
  email: string;
  full_name: string | null;
  organization_id: string | null;
  site_id: string | null;        // Legacy single site (backward compatible)
  unit_id: string | null;
  updated_at: string;
  // New fields from Project 1
  default_site_id?: string | null;
  user_sites?: UserSite[];
  ttn?: TTNConnection; // NEW: TTN connection data
}

interface SyncPayload {
  users: SyncedUser[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate API key using Bearer token
  const authHeader = req.headers.get('Authorization');
  const expectedKey = Deno.env.get('PROJECT2_SYNC_API_KEY');
  
  if (!expectedKey) {
    console.error('[user-sync] Missing PROJECT2_SYNC_API_KEY secret');
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    console.error('[user-sync] Invalid or missing authorization');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload: SyncPayload = await req.json();
    
    if (!payload.users || !Array.isArray(payload.users)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: expected users array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[user-sync] Received ${payload.users.length} user(s) to sync`);

    const results = [];
    
    for (const user of payload.users) {
      // Validate that organization_id is present (required field)
      if (!user.organization_id) {
        console.error(`[user-sync] Rejected user ${user.user_id}: organization_id is required`);
        results.push({ 
          user_id: user.user_id, 
          success: false, 
          error: 'organization_id is required for all users' 
        });
        continue;
      }

      // Upsert user data into synced_users table
      const { data, error } = await supabase
        .from('synced_users')
        .upsert({
          source_user_id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          source_organization_id: user.organization_id,
          source_site_id: user.site_id,
          source_unit_id: user.unit_id,
          default_site_id: user.default_site_id || null,
          synced_at: user.updated_at,
          last_updated_at: new Date().toISOString(),
          // NEW: Store TTN connection data (null-safe)
          ttn: user.ttn || null,
        }, {
          onConflict: 'source_user_id',
        })
        .select()
        .single();

      if (error) {
        console.error(`[user-sync] Error upserting user ${user.user_id}:`, error);
        results.push({ user_id: user.user_id, success: false, error: error.message });
        continue;
      }
      
      // Debug logging for TTN data
      console.log(`[user-sync] user=${user.email} org=${user.organization_id} sites=${user.user_sites?.length ?? 0} ttn_enabled=${user.ttn?.enabled ?? false} cluster=${user.ttn?.cluster ?? 'n/a'}`);

      // Handle user_sites if provided
      if (user.user_sites && user.user_sites.length > 0) {
        console.log(`[user-sync] Syncing ${user.user_sites.length} site memberships for user ${user.user_id}`);
        
        // Delete existing memberships for this user
        const { error: deleteError } = await supabase
          .from('user_site_memberships')
          .delete()
          .eq('source_user_id', user.user_id);
        
        if (deleteError) {
          console.error(`[user-sync] Error deleting old memberships for ${user.user_id}:`, deleteError);
        }
        
        // Insert new memberships
        const memberships = user.user_sites.map(site => ({
          source_user_id: user.user_id,
          site_id: site.site_id,
          site_name: site.site_name || null,
          is_default: site.site_id === user.default_site_id,
        }));
        
        const { error: insertError } = await supabase
          .from('user_site_memberships')
          .insert(memberships);
        
        if (insertError) {
          console.error(`[user-sync] Error inserting memberships for ${user.user_id}:`, insertError);
          results.push({ 
            user_id: user.user_id, 
            success: true, 
            warning: `User synced but site memberships failed: ${insertError.message}` 
          });
          continue;
        }
        
        console.log(`[user-sync] Successfully synced ${memberships.length} site memberships for user ${user.user_id}`);
      }

      console.log(`[user-sync] Successfully synced user ${user.user_id}`);
      results.push({ user_id: user.user_id, success: true });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: successCount, 
        failed: failCount,
        results 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[user-sync] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
