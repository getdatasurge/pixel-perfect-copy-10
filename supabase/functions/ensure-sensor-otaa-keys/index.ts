// Edge function to ensure OTAA credentials exist for a sensor
// Calls FrostGuard to generate/retrieve JoinEUI + AppKey
// Uses API key auth only (no JWT, no Service Role keys)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnsureKeysRequest {
  org_id: string;
  sensor_id?: string;
  dev_eui: string;
  request_id?: string;
}

interface EnsureKeysResponse {
  ok: boolean;
  join_eui?: string;
  app_key?: string;
  sensor_id?: string;
  source?: 'existing' | 'generated';
  updated_at?: string;
  error?: string;
  hint?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const startTime = performance.now();
  
  console.log(`[${requestId}] ensure-sensor-otaa-keys: Request received`);

  try {
    // Get FrostGuard configuration from secrets
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');
    
    if (!frostguardUrl) {
      console.error(`[${requestId}] FROSTGUARD_SUPABASE_URL not configured`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'FrostGuard URL not configured',
          hint: 'Set FROSTGUARD_SUPABASE_URL in project secrets',
          request_id: requestId,
        } as EnsureKeysResponse),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!syncApiKey) {
      console.error(`[${requestId}] PROJECT2_SYNC_API_KEY not configured`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Sync API key not configured',
          hint: 'Set PROJECT2_SYNC_API_KEY in project secrets',
          request_id: requestId,
        } as EnsureKeysResponse),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: EnsureKeysRequest = await req.json();
    const { org_id, sensor_id, dev_eui, request_id: clientRequestId } = body;
    
    console.log(`[${requestId}] ensure-sensor-otaa-keys: Processing`, {
      org_id,
      sensor_id,
      dev_eui_last4: dev_eui?.slice(-4),
      client_request_id: clientRequestId,
    });

    // Validate required fields
    if (!org_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'org_id is required',
          request_id: requestId,
        } as EnsureKeysResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!dev_eui) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'dev_eui is required',
          request_id: requestId,
        } as EnsureKeysResponse),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call FrostGuard's ensure-sensor-otaa-keys endpoint
    const frostguardEndpoint = `${frostguardUrl}/functions/v1/ensure-sensor-otaa-keys`;
    
    console.log(`[${requestId}] Calling FrostGuard:`, {
      endpoint: frostguardEndpoint,
      api_key_last4: syncApiKey.slice(-4),
    });

    const response = await fetch(frostguardEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncApiKey}`,
        'x-sync-api-key': syncApiKey,
      },
      body: JSON.stringify({
        org_id,
        sensor_id,
        dev_eui,
        request_id: requestId,
      }),
    });

    const duration = Math.round(performance.now() - startTime);
    
    console.log(`[${requestId}] FrostGuard response:`, {
      status: response.status,
      duration_ms: duration,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${requestId}] FrostGuard error:`, {
        status: response.status,
        error: errorText.slice(0, 500),
      });
      
      // If FrostGuard doesn't have this endpoint yet, fall back to local generation
      if (response.status === 404) {
        console.log(`[${requestId}] FrostGuard endpoint not found - generating keys locally as fallback`);
        
        // Generate keys locally (temporary fallback until FrostGuard implements the endpoint)
        const generatedKeys = generateOTAACredentials();
        
        return new Response(
          JSON.stringify({
            ok: true,
            join_eui: generatedKeys.joinEui,
            app_key: generatedKeys.appKey,
            sensor_id,
            source: 'generated',
            updated_at: new Date().toISOString(),
            request_id: requestId,
            _note: 'Generated locally (FrostGuard endpoint not available)',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({
          ok: false,
          error: `FrostGuard returned ${response.status}`,
          hint: response.status === 401 
            ? 'Check PROJECT2_SYNC_API_KEY is valid'
            : 'Check FrostGuard logs for details',
          request_id: requestId,
        } as EnsureKeysResponse),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    console.log(`[${requestId}] Success:`, {
      source: data.source,
      has_join_eui: !!data.join_eui,
      has_app_key: !!data.app_key,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        join_eui: data.join_eui,
        app_key: data.app_key,
        sensor_id: data.sensor_id || sensor_id,
        source: data.source || 'existing',
        updated_at: data.updated_at || new Date().toISOString(),
        request_id: requestId,
      } as EnsureKeysResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    console.error(`[${requestId}] Unexpected error after ${duration}ms:`, err);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        hint: 'Check edge function logs for details',
        request_id: requestId,
      } as EnsureKeysResponse),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper: Generate OTAA credentials locally as fallback
function generateOTAACredentials(): { joinEui: string; appKey: string } {
  const bytes8 = new Uint8Array(8);
  const bytes16 = new Uint8Array(16);
  crypto.getRandomValues(bytes8);
  crypto.getRandomValues(bytes16);
  
  const joinEui = Array.from(bytes8)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  
  const appKey = Array.from(bytes16)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  
  return { joinEui, appKey };
}
