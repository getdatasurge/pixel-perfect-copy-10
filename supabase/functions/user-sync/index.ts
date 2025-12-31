import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncedUser {
  user_id: string;
  email: string;
  full_name: string | null;
  organization_id: string | null;
  site_id: string | null;
  unit_id: string | null;
  updated_at: string;
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
          synced_at: user.updated_at,
          last_updated_at: new Date().toISOString(),
        }, {
          onConflict: 'source_user_id',
        })
        .select()
        .single();

      if (error) {
        console.error(`[user-sync] Error upserting user ${user.user_id}:`, error);
        results.push({ user_id: user.user_id, success: false, error: error.message });
      } else {
        console.log(`[user-sync] Successfully synced user ${user.user_id}`);
        results.push({ user_id: user.user_id, success: true });
      }
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
