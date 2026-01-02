import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Get FrostGuard connection details
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const frostguardKey = Deno.env.get('FROSTGUARD_SERVICE_ROLE_KEY');

    if (!frostguardUrl || !frostguardKey) {
      console.error(`[assign-device-unit][${requestId}] Missing FrostGuard credentials`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'FrostGuard integration not configured',
          request_id: requestId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create FrostGuard client
    const frostguard = createClient(frostguardUrl, frostguardKey, {
      auth: { persistSession: false },
    });

    // Update the sensor in FrostGuard
    const updatePayload: { unit_id?: string | null; site_id?: string | null } = {};
    
    // Handle unit_id assignment (null to unassign)
    if (unit_id !== undefined) {
      updatePayload.unit_id = unit_id || null;
    }
    
    // Handle site_id assignment (null to unassign)
    if (site_id !== undefined) {
      updatePayload.site_id = site_id || null;
    }

    console.log(`[assign-device-unit][${requestId}] Updating sensor with:`, updatePayload);

    const { data: updatedSensor, error: updateError } = await frostguard
      .from('sensors')
      .update(updatePayload)
      .eq('id', sensor_id)
      .eq('org_id', org_id)
      .select('id, unit_id, site_id, updated_at')
      .single();

    if (updateError) {
      console.error(`[assign-device-unit][${requestId}] FrostGuard update error:`, updateError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: updateError.message,
          error_code: updateError.code,
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const durationMs = Math.round(performance.now() - startTime);
    console.log(`[assign-device-unit][${requestId}] Success in ${durationMs}ms:`, updatedSensor);

    return new Response(
      JSON.stringify({
        ok: true,
        sensor_id: updatedSensor.id,
        unit_id: updatedSensor.unit_id,
        site_id: updatedSensor.site_id,
        updated_at: updatedSensor.updated_at,
        request_id: requestId,
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
