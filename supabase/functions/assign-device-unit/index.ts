// assign-device-unit: Proxy to FrostGuard update-sensor-assignment endpoint
// Uses API key authentication (PROJECT2_SYNC_API_KEY), NOT Service Role key

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignDeviceUnitRequest {
  org_id: string;
  sensor_id: string;
  unit_id?: string;
  site_id?: string;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = performance.now();
  
  console.log(`[assign-device-unit][${requestId}] ${req.method} request received`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as AssignDeviceUnitRequest;
    const { org_id, sensor_id, unit_id, site_id } = body;

    console.log(`[assign-device-unit][${requestId}] Assigning device ${sensor_id} to unit ${unit_id || 'null'}`);

    // Validate required fields
    if (!org_id || !sensor_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing required fields: org_id and sensor_id are required',
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get FrostGuard connection details - use API key auth (not Service Role)
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');

    if (!frostguardUrl) {
      console.error(`[assign-device-unit][${requestId}] FROSTGUARD_SUPABASE_URL not configured`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'FrostGuard URL not configured',
          error_code: 'CONFIG_MISSING',
          hint: 'FROSTGUARD_SUPABASE_URL is not set in project secrets.',
          request_id: requestId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!syncApiKey) {
      console.error(`[assign-device-unit][${requestId}] PROJECT2_SYNC_API_KEY not configured`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Sync API key not configured',
          error_code: 'CONFIG_MISSING',
          hint: 'PROJECT2_SYNC_API_KEY is not set in project secrets.',
          request_id: requestId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call FrostGuard's update-sensor-assignment endpoint via API key auth
    const updatePayload = {
      org_id,
      sensor_id,
      unit_id: unit_id || null,
      site_id: site_id || null,
    };

    console.log(`[assign-device-unit][${requestId}] Calling FrostGuard update-sensor-assignment:`, {
      sensor_id,
      unit_id: unit_id || 'null',
      site_id: site_id || 'null',
      api_key_last4: syncApiKey.slice(-4),
    });

    const frostguardResponse = await fetch(`${frostguardUrl}/functions/v1/update-sensor-assignment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncApiKey}`,
      },
      body: JSON.stringify(updatePayload),
    });

    const responseText = await frostguardResponse.text();
    let responseData: Record<string, unknown>;
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw_response: responseText.slice(0, 500) };
    }

    if (!frostguardResponse.ok) {
      console.error(`[assign-device-unit][${requestId}] FrostGuard error:`, {
        status: frostguardResponse.status,
        response: responseData,
      });

      // Provide helpful hints for common errors
      let hint = 'FrostGuard rejected the assignment request.';
      if (frostguardResponse.status === 404) {
        hint = 'FrostGuard update-sensor-assignment endpoint not found. This endpoint may need to be created in FrostGuard.';
      } else if (frostguardResponse.status === 401) {
        hint = 'API key authentication failed. Check PROJECT2_SYNC_API_KEY.';
      } else if (frostguardResponse.status === 403) {
        hint = 'API key lacks permission for this organization.';
      }

      return new Response(
        JSON.stringify({
          ok: false,
          error: responseData.error || responseData.message || `FrostGuard returned ${frostguardResponse.status}`,
          error_code: responseData.error_code || responseData.code || `HTTP_${frostguardResponse.status}`,
          hint,
          request_id: requestId,
          frostguard_request_id: responseData.request_id,
        }),
        { status: frostguardResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if FrostGuard returned ok: false in body
    if (responseData.ok === false) {
      console.error(`[assign-device-unit][${requestId}] FrostGuard returned ok=false:`, responseData);
      return new Response(
        JSON.stringify({
          ok: false,
          error: responseData.error || 'FrostGuard returned failure status',
          error_code: responseData.error_code || 'UPSTREAM_FAILURE',
          request_id: requestId,
          frostguard_request_id: responseData.request_id,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const durationMs = Math.round(performance.now() - startTime);
    console.log(`[assign-device-unit][${requestId}] Success in ${durationMs}ms:`, responseData);

    return new Response(
      JSON.stringify({
        ok: true,
        sensor_id: responseData.sensor_id || sensor_id,
        unit_id: responseData.unit_id,
        site_id: responseData.site_id,
        updated_at: responseData.updated_at,
        request_id: requestId,
        frostguard_request_id: responseData.request_id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[assign-device-unit][${requestId}] Unexpected error:`, message);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: message,
        request_id: requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
