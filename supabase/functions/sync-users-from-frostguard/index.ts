import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  frostguardApiUrl: string;
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

    // Transform and upsert users to local cache
    const usersToSync = frostguardUsers.map(user => ({
      user_id: user.id,
      email: user.email || null,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      organization_id: user.user_metadata?.organization_id || null,
      site_id: user.user_metadata?.site_id || null,
      unit_id: user.user_metadata?.unit_id || null,
      updated_at: user.updated_at || new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }));

    const { error: upsertError, count } = await localClient
      .from('users_cache')
      .upsert(usersToSync, { 
        onConflict: 'user_id',
        count: 'exact'
      });

    if (upsertError) {
      console.error('Error upserting users:', upsertError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to save users to cache',
          details: upsertError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully synced ${usersToSync.length} users to cache`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: usersToSync.length,
        message: `Synced ${usersToSync.length} users from FrostGuard`
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
