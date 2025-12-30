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

    // Query profiles table with only columns that exist
    let query = frostguardClient
      .from('profiles')
      .select('id, email, full_name, organization_id')
      .limit(50);

    // Add search filter if term provided
    if (searchTerm && searchTerm.trim()) {
      const term = `%${searchTerm.trim()}%`;
      query = query.or(`email.ilike.${term},full_name.ilike.${term}`);
    }

    const { data: profiles, error: profilesError } = await query;

    if (profilesError) {
      console.error('Error querying profiles:', profilesError);
      
      // Try alternative table names if profiles doesn't exist
      if (profilesError.code === '42P01' || profilesError.message?.includes('does not exist')) {
        // Try 'users' table
        const { data: users, error: usersError } = await frostguardClient
          .from('users')
          .select('id, email, name, organization_id, site_id, unit_id')
          .limit(50);

        if (usersError) {
          console.error('Error querying users table:', usersError);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Could not find profiles or users table in FrostGuard',
              details: profilesError.message
            }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Map users to profile format
        const mappedUsers = (users || []).map((u: any) => ({
          id: u.id,
          email: u.email,
          full_name: u.name,
          organization_id: u.organization_id,
          site_id: u.site_id,
          unit_id: u.unit_id,
        }));

        return new Response(
          JSON.stringify({ success: true, users: mappedUsers, source: 'users' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: profilesError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${profiles?.length || 0} users`);

    return new Response(
      JSON.stringify({ success: true, users: profiles || [], source: 'profiles' }),
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
