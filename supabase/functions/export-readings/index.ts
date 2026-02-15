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
    const { readings } = body;

    if (!readings || !Array.isArray(readings) || readings.length === 0) {
      return new Response(
        JSON.stringify({ error: 'readings array is required and must not be empty', request_id: requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (readings.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Maximum 100 readings per request', request_id: requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const freshtrackUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const ingestKey = Deno.env.get('EMULATOR_SYNC_API_KEY');

    if (!freshtrackUrl || !ingestKey) {
      console.error(`[export-readings][${requestId}] Missing config: URL=${!!freshtrackUrl}, KEY=${!!ingestKey}`);
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

    const targetUrl = `${freshtrackUrl}/functions/v1/ingest-readings`;
    console.log(`[export-readings][${requestId}] Forwarding ${readings.length} readings to ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-API-Key': ingestKey,
      },
      body: JSON.stringify({ readings }),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw_response: responseText.slice(0, 2048) };
    }

    console.log(`[export-readings][${requestId}] FreshTrack responded ${response.status}:`, {
      ingested: responseData.ingested,
      failed: responseData.failed,
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
    console.error(`[export-readings][${requestId}] Error:`, error);
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
