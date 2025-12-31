import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  frostguardApiUrl: string;
}

interface SiteMembership {
  site_id: string;
  site_name: string | null;
  is_default: boolean;
}

// Decode JWT payload without verification (we just need metadata)
function decodeJwtPayload(jwt: string): { ref?: string; role?: string } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return { ref: payload.ref, role: payload.role };
  } catch {
    return null;
  }
}

// Extract project ref from Supabase URL
function extractProjectRef(url: string): string | null {
  const match = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get FrostGuard service role key
    const frostguardServiceKey = Deno.env.get('FROSTGUARD_SERVICE_ROLE_KEY')?.trim();
    if (!frostguardServiceKey) {
      console.error('FROSTGUARD_SERVICE_ROLE_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'FROSTGUARD_SERVICE_ROLE_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate key format
    const keyPayload = decodeJwtPayload(frostguardServiceKey);
    if (!keyPayload || keyPayload.role !== 'service_role') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid FROSTGUARD_SERVICE_ROLE_KEY - must be a service_role key'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { frostguardApiUrl }: SyncRequest = await req.json();

    if (!frostguardApiUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'FrostGuard API URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize URL to base
    let baseUrl = frostguardApiUrl;
    if (frostguardApiUrl.includes('/functions/')) {
      const match = frostguardApiUrl.match(/^(https?:\/\/[^\/]+)/);
      if (match) baseUrl = match[1];
    }

    // Validate key matches URL project
    const urlRef = extractProjectRef(baseUrl);
    if (urlRef && keyPayload.ref && urlRef !== keyPayload.ref) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Project mismatch: key is for "${keyPayload.ref}" but URL is for "${urlRef}"`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Syncing users from FrostGuard at ${baseUrl}`);

    // Create FrostGuard client
    const frostguardClient = createClient(baseUrl, frostguardServiceKey);

    // List all users from FrostGuard
    const { data: authData, error: authError } = await frostguardClient.auth.admin.listUsers();

    if (authError) {
      console.error('Error listing users:', authError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to list FrostGuard users',
          details: authError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const frostguardUsers = authData.users || [];
    console.log(`Found ${frostguardUsers.length} users in FrostGuard`);

    if (frostguardUsers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, message: 'No users found in FrostGuard' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user IDs for querying related tables
    const userIds = frostguardUsers.map(u => u.id);

    // Query profiles table for default_site_id
    let profilesMap: Record<string, { default_site_id: string | null }> = {};
    try {
      const { data: profiles, error: profilesError } = await frostguardClient
        .from('profiles')
        .select('id, default_site_id')
        .in('id', userIds);
      
      if (profilesError) {
        console.warn('Could not query profiles table:', profilesError.message);
      } else if (profiles) {
        console.log(`Found ${profiles.length} profiles with default_site_id data`);
        profiles.forEach(p => {
          profilesMap[p.id] = { default_site_id: p.default_site_id };
        });
      }
    } catch (err) {
      console.warn('Profiles table query failed:', err);
    }

    // Query site memberships - try both table names
    let siteMembershipsMap: Record<string, SiteMembership[]> = {};
    
    // Try site_memberships first
    try {
      const { data: memberships, error: membershipsError } = await frostguardClient
        .from('site_memberships')
        .select('user_id, site_id, is_default, sites(name)')
        .in('user_id', userIds);
      
      if (!membershipsError && memberships && memberships.length > 0) {
        console.log(`Found ${memberships.length} site memberships from site_memberships table`);
        memberships.forEach((m: any) => {
          if (!siteMembershipsMap[m.user_id]) {
            siteMembershipsMap[m.user_id] = [];
          }
          siteMembershipsMap[m.user_id].push({
            site_id: m.site_id,
            site_name: m.sites?.name || null,
            is_default: m.is_default || false,
          });
        });
      } else if (membershipsError) {
        console.warn('site_memberships query failed:', membershipsError.message);
      }
    } catch (err) {
      console.warn('site_memberships table not available:', err);
    }

    // If no memberships found, try user_site_memberships
    if (Object.keys(siteMembershipsMap).length === 0) {
      try {
        const { data: memberships, error: membershipsError } = await frostguardClient
          .from('user_site_memberships')
          .select('source_user_id, site_id, is_default, site_name')
          .in('source_user_id', userIds);
        
        if (!membershipsError && memberships && memberships.length > 0) {
          console.log(`Found ${memberships.length} site memberships from user_site_memberships table`);
          memberships.forEach((m: any) => {
            const userId = m.source_user_id;
            if (!siteMembershipsMap[userId]) {
              siteMembershipsMap[userId] = [];
            }
            siteMembershipsMap[userId].push({
              site_id: m.site_id,
              site_name: m.site_name || null,
              is_default: m.is_default || false,
            });
          });
        } else if (membershipsError) {
          console.warn('user_site_memberships query failed:', membershipsError.message);
        }
      } catch (err) {
        console.warn('user_site_memberships table not available:', err);
      }
    }

    console.log(`Site memberships found for ${Object.keys(siteMembershipsMap).length} users`);

    // Create local Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Local Supabase configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const localClient = createClient(supabaseUrl, supabaseServiceKey);

    // Transform and upsert users to synced_users table
    const usersToSync = frostguardUsers.map(user => {
      const profile = profilesMap[user.id];
      const userSites = siteMembershipsMap[user.id] || [];
      const defaultSite = userSites.find(s => s.is_default);
      
      return {
        source_user_id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        source_organization_id: user.user_metadata?.organization_id || '00000000-0000-0000-0000-000000000000',
        source_site_id: user.user_metadata?.site_id || null,
        source_unit_id: user.user_metadata?.unit_id || null,
        default_site_id: profile?.default_site_id || defaultSite?.site_id || null,
        synced_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await localClient
      .from('synced_users')
      .upsert(usersToSync, { 
        onConflict: 'source_user_id',
      });

    if (upsertError) {
      console.error('Error upserting users:', upsertError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to save users to synced_users',
          details: upsertError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully synced ${usersToSync.length} users to synced_users table`);

    // Now sync site memberships
    let membershipsSynced = 0;
    for (const user of frostguardUsers) {
      const userSites = siteMembershipsMap[user.id] || [];
      
      if (userSites.length === 0) continue;

      // Delete existing memberships for this user
      const { error: deleteError } = await localClient
        .from('user_site_memberships')
        .delete()
        .eq('source_user_id', user.id);

      if (deleteError) {
        console.warn(`Failed to delete old memberships for user ${user.id}:`, deleteError.message);
        continue;
      }

      // Insert new memberships
      const membershipsToInsert = userSites.map(site => ({
        source_user_id: user.id,
        site_id: site.site_id,
        site_name: site.site_name,
        is_default: site.is_default,
      }));

      const { error: insertError } = await localClient
        .from('user_site_memberships')
        .insert(membershipsToInsert);

      if (insertError) {
        console.warn(`Failed to insert memberships for user ${user.id}:`, insertError.message);
      } else {
        membershipsSynced += membershipsToInsert.length;
      }
    }

    console.log(`Successfully synced ${membershipsSynced} site memberships`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: usersToSync.length,
        memberships_synced: membershipsSynced,
        message: `Synced ${usersToSync.length} users and ${membershipsSynced} site memberships from FrostGuard`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
