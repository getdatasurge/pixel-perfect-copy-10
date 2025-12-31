import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProxyRequest {
  selected_user_id: string;
  org_id?: string;
  site_id?: string;
}

interface TTNSnapshot {
  cluster: string;
  application_id: string;
  api_key_name?: string;
  api_key_last4: string;
  api_key_id?: string;
  ttn_enabled: boolean;
  webhook_id?: string;
  webhook_enabled: boolean;
  webhook_base_url?: string;
  webhook_path?: string;
  webhook_headers?: Record<string, string>;
  updated_at: string;
  last_test_at?: string;
  last_test_success?: boolean;
  last_test_message?: string;
}

interface ProxyResponse {
  ok: boolean;
  snapshot?: TTNSnapshot;
  error?: string;
  code?: string;
  request_id: string;
}

serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] proxy-frostguard-ttn-snapshot request received`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED', request_id: requestId }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body: ProxyRequest = await req.json();
    const { selected_user_id, org_id, site_id } = body;

    if (!selected_user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'selected_user_id is required', code: 'MISSING_PARAM', request_id: requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] Fetching TTN snapshot for user=${selected_user_id}, org=${org_id}, site=${site_id}`);

    // Read environment variables
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const sharedSecret = Deno.env.get('FROSTGUARD_SYNC_SHARED_SECRET');

    if (!frostguardUrl) {
      console.error(`[${requestId}] FROSTGUARD_SUPABASE_URL not configured`);
      return new Response(
        JSON.stringify({ ok: false, error: 'FrostGuard URL not configured', code: 'CONFIG_ERROR', request_id: requestId }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!sharedSecret) {
      console.error(`[${requestId}] FROSTGUARD_SYNC_SHARED_SECRET not configured`);
      return new Response(
        JSON.stringify({ ok: false, error: 'Sync secret not configured', code: 'CONFIG_ERROR', request_id: requestId }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Project 1's get-ttn-integration-snapshot endpoint
    const snapshotUrl = `${frostguardUrl}/functions/v1/get-ttn-integration-snapshot`;
    console.log(`[${requestId}] Calling FrostGuard: ${snapshotUrl}`);

    const upstreamResponse = await fetch(snapshotUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-shared-secret': sharedSecret,
      },
      body: JSON.stringify({
        user_id: selected_user_id,
        org_id,
        site_id,
      }),
    });

    const upstreamStatus = upstreamResponse.status;
    let upstreamBody: any;

    try {
      upstreamBody = await upstreamResponse.json();
    } catch {
      upstreamBody = await upstreamResponse.text();
    }

    console.log(`[${requestId}] FrostGuard response: status=${upstreamStatus}`);

    // Map upstream errors to client-friendly codes
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Integration snapshot access denied. Check shared secret / permissions.',
          code: 'UNAUTHORIZED',
          request_id: requestId,
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (upstreamStatus === 404) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'No TTN integration saved for this user yet.',
          code: 'NOT_FOUND',
          request_id: requestId,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (upstreamStatus >= 500) {
      console.error(`[${requestId}] FrostGuard server error:`, upstreamBody);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'FrostGuard snapshot service error.',
          code: 'UPSTREAM_ERROR',
          upstream_status: upstreamStatus,
          upstream_body: typeof upstreamBody === 'string' ? upstreamBody.slice(0, 200) : JSON.stringify(upstreamBody).slice(0, 200),
          request_id: requestId,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!upstreamResponse.ok) {
      console.error(`[${requestId}] FrostGuard unexpected error:`, upstreamBody);
      return new Response(
        JSON.stringify({
          ok: false,
          error: upstreamBody?.error || 'Unknown upstream error',
          code: upstreamBody?.code || 'UPSTREAM_ERROR',
          request_id: requestId,
        }),
        { status: upstreamStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success - return the snapshot
    const snapshot: TTNSnapshot = {
      cluster: upstreamBody.cluster || 'eu1',
      application_id: upstreamBody.application_id || '',
      api_key_name: upstreamBody.api_key_name,
      api_key_last4: upstreamBody.api_key_last4 || '',
      api_key_id: upstreamBody.api_key_id,
      ttn_enabled: upstreamBody.ttn_enabled ?? false,
      webhook_id: upstreamBody.webhook_id,
      webhook_enabled: upstreamBody.webhook_enabled ?? false,
      webhook_base_url: upstreamBody.webhook_base_url,
      webhook_path: upstreamBody.webhook_path,
      webhook_headers: upstreamBody.webhook_headers,
      updated_at: upstreamBody.updated_at || new Date().toISOString(),
      last_test_at: upstreamBody.last_test_at,
      last_test_success: upstreamBody.last_test_success,
      last_test_message: upstreamBody.last_test_message,
    };

    console.log(`[${requestId}] Snapshot fetched successfully: cluster=${snapshot.cluster}, app=${snapshot.application_id}`);

    return new Response(
      JSON.stringify({ ok: true, snapshot, request_id: requestId } as ProxyResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error(`[${requestId}] Proxy error:`, err);

    const isNetworkError = err.message?.includes('fetch') || err.message?.includes('network') || err.message?.includes('connect');
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: isNetworkError ? 'Could not reach FrostGuard. Check your internet connection.' : (err.message || 'Proxy error'),
        code: isNetworkError ? 'NETWORK_ERROR' : 'PROXY_ERROR',
        request_id: requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
