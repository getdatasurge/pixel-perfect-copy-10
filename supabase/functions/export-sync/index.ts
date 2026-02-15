import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed', request_id: requestId }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { org_id, sync_id, synced_at, gateways, devices, sensors } = body;

    if (!org_id) {
      return new Response(
        JSON.stringify({ error: 'org_id is required', request_id: requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const freshtrackUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('EMULATOR_SYNC_API_KEY');

    if (!freshtrackUrl || !syncApiKey) {
      console.error(`[export-sync][${requestId}] Missing config: URL=${!!freshtrackUrl}, KEY=${!!syncApiKey}`);
      return new Response(
        JSON.stringify({
          error: 'Export not configured',
          error_code: 'CONFIG_MISSING',
          request_id: requestId,
          hint: 'FROSTGUARD_SUPABASE_URL or EMULATOR_SYNC_API_KEY not set in project secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetUrl = `${freshtrackUrl}/functions/v1/emulator-sync`;
    console.log(`[export-sync][${requestId}] Forwarding to ${targetUrl} for org ${org_id.slice(0, 8)}...`);

    const payload = {
      org_id,
      sync_id: sync_id || `emu-${requestId}`,
      synced_at: synced_at || new Date().toISOString(),
      gateways: gateways || [],
      devices: devices || [],
      sensors: sensors || [],
    };

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncApiKey}`,
        'X-Emulator-Sync-Key': syncApiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw_response: responseText.slice(0, 2048) };
    }

    console.log(`[export-sync][${requestId}] FreshTrack responded ${response.status}:`, {
      success: responseData.success,
      counts: responseData.counts,
    });

    return new Response(
      JSON.stringify({
        ...responseData,
        request_id: (responseData.request_id as string) || requestId,
        proxy_status: response.status,
      }),
      {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`[export-sync][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        error_code: 'PROXY_ERROR',
        request_id: requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
