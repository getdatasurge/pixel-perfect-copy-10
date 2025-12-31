import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  frostguardApiUrl: string;
  searchTerm?: string;
}

interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  organization_id?: string;
  site_id?: string;
  unit_id?: string;
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
    // Use service role key to bypass RLS on FrostGuard profiles table
    const frostguardServiceKey = Deno.env.get('FROSTGUARD_SERVICE_ROLE_KEY')?.trim();
    if (!frostguardServiceKey) {
      console.error('FROSTGUARD_SERVICE_ROLE_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'FROSTGUARD_SERVICE_ROLE_KEY not configured. Add it in Lovable Cloud secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate key format
    const keyPayload = decodeJwtPayload(frostguardServiceKey);
    if (!keyPayload) {
      console.error('FROSTGUARD_SERVICE_ROLE_KEY is not a valid JWT');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid key format',
          details: 'FROSTGUARD_SERVICE_ROLE_KEY does not look like a Supabase API key. Paste the service_role key from your FrostGuard project settings.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate role
    if (keyPayload.role !== 'service_role') {
      console.error(`Key role is "${keyPayload.role}", expected "service_role"`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Wrong key type',
          details: `Key role is "${keyPayload.role}". You need the service_role key (not anon) to bypass RLS.`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { frostguardApiUrl, searchTerm }: SearchRequest = await req.json();

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
      console.error(`Key ref "${keyPayload.ref}" doesn't match URL ref "${urlRef}"`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Project mismatch',
          details: `The service_role key belongs to project "${keyPayload.ref}" but the URL points to project "${urlRef}". Make sure both are from the same FrostGuard project.`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Searching FrostGuard users at ${baseUrl} (ref: ${urlRef}), search term: "${searchTerm || ''}", key ref: ${keyPayload.ref}`);

    const frostguardClient = createClient(baseUrl, frostguardServiceKey);

    // Use auth.admin.listUsers() to get base user data
    const { data: authData, error: authError } = await frostguardClient.auth.admin.listUsers();

    if (authError) {
      console.error('Error listing users:', authError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to query FrostGuard users',
          details: authError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authUsers = authData.users || [];
    const userIds = authUsers.map(u => u.id);
    console.log(`Found ${authUsers.length} auth users, fetching site data...`);

    // Try to fetch profiles with default_site_id from FrostGuard
    let profilesMap: Record<string, { default_site_id?: string }> = {};
    try {
      const { data: profiles, error: profilesError } = await frostguardClient
        .from('profiles')
        .select('id, default_site_id')
        .in('id', userIds);
      
      if (profilesError) {
        console.warn('Could not fetch profiles (table may not exist):', profilesError.message);
      } else if (profiles) {
        profiles.forEach(p => {
          profilesMap[p.id] = { default_site_id: p.default_site_id };
        });
        console.log(`Fetched ${profiles.length} profiles with default_site_id`);
      }
    } catch (e) {
      console.warn('Profiles table query failed:', e);
    }

    // Try to fetch site memberships from FrostGuard
    // Try multiple possible table names that FrostGuard might use
    let siteMembershipsMap: Record<string, Array<{ site_id: string; site_name?: string }>> = {};
    
    // Attempt 1: Try 'site_memberships' table
    try {
      const { data: memberships, error: membershipsError } = await frostguardClient
        .from('site_memberships')
        .select('user_id, site_id, site:sites(name)')
        .in('user_id', userIds);
      
      if (!membershipsError && memberships) {
        memberships.forEach(m => {
          if (!siteMembershipsMap[m.user_id]) {
            siteMembershipsMap[m.user_id] = [];
          }
          siteMembershipsMap[m.user_id].push({
            site_id: m.site_id,
            site_name: (m.site as any)?.name || null,
          });
        });
        console.log(`Fetched site_memberships: ${memberships.length} rows`);
      } else if (membershipsError) {
        console.warn('site_memberships query failed:', membershipsError.message);
      }
    } catch (e) {
      console.warn('site_memberships table query failed:', e);
    }

    // Attempt 2: If no memberships found, try 'user_site_memberships' table
    if (Object.keys(siteMembershipsMap).length === 0) {
      try {
        const { data: memberships, error: membershipsError } = await frostguardClient
          .from('user_site_memberships')
          .select('user_id, site_id, site_name')
          .in('user_id', userIds);
        
        if (!membershipsError && memberships) {
          memberships.forEach(m => {
            if (!siteMembershipsMap[m.user_id]) {
              siteMembershipsMap[m.user_id] = [];
            }
            siteMembershipsMap[m.user_id].push({
              site_id: m.site_id,
              site_name: m.site_name || null,
            });
          });
          console.log(`Fetched user_site_memberships: ${memberships.length} rows`);
        } else if (membershipsError) {
          console.warn('user_site_memberships query failed:', membershipsError.message);
        }
      } catch (e) {
        console.warn('user_site_memberships table query failed:', e);
      }
    }

    // Map auth users to profile format with site data
    let users = authUsers.map(user => {
      const profile = profilesMap[user.id];
      const userSites = siteMembershipsMap[user.id] || [];
      
      return {
        id: user.id,
        email: user.email || null,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        organization_id: user.user_metadata?.organization_id || null,
        site_id: user.user_metadata?.site_id || null,
        unit_id: user.user_metadata?.unit_id || null,
        default_site_id: profile?.default_site_id || null,
        user_sites: userSites,
      };
    });

    // Apply search filter client-side
    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      users = users.filter(u => 
        u.email?.toLowerCase().includes(term) ||
        u.full_name?.toLowerCase().includes(term)
      );
    }

    const usersWithSites = users.filter(u => u.user_sites.length > 0).length;
    console.log(`Returning ${users.length} users (${usersWithSites} with sites)`);

    return new Response(
      JSON.stringify({ success: true, users, source: 'auth' }),
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
