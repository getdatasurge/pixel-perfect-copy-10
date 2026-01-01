import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { org_id, unit_id } = await req.json();
    
    console.log('[pull-frostguard-telemetry] Request:', { org_id, unit_id });

    if (!org_id && !unit_id) {
      return new Response(
        JSON.stringify({ error: 'Either org_id or unit_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Connect to FrostGuard (Project 1)
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const frostguardKey = Deno.env.get('FROSTGUARD_SERVICE_ROLE_KEY');

    if (!frostguardUrl || !frostguardKey) {
      console.error('[pull-frostguard-telemetry] Missing FrostGuard credentials');
      return new Response(
        JSON.stringify({ error: 'FrostGuard connection not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const frostguard = createClient(frostguardUrl, frostguardKey);

    // Query unit_telemetry from FrostGuard
    let query = frostguard.from('unit_telemetry').select('*');
    
    if (org_id) {
      query = query.eq('org_id', org_id);
    }
    if (unit_id) {
      query = query.eq('unit_id', unit_id);
    }

    const { data: remoteTelemetry, error: fetchError } = await query;

    if (fetchError) {
      console.error('[pull-frostguard-telemetry] FrostGuard query error:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch from FrostGuard', details: fetchError.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pull-frostguard-telemetry] Fetched from FrostGuard:', remoteTelemetry?.length || 0, 'records');

    if (!remoteTelemetry || remoteTelemetry.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, message: 'No telemetry found in FrostGuard' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Connect to local Supabase (Project 2)
    const localUrl = Deno.env.get('SUPABASE_URL')!;
    const localKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const local = createClient(localUrl, localKey);

    // Upsert telemetry records into local unit_telemetry table
    const { data: upsertedData, error: upsertError } = await local
      .from('unit_telemetry')
      .upsert(
        remoteTelemetry.map((record: any) => ({
          org_id: record.org_id,
          unit_id: record.unit_id,
          last_temp_f: record.last_temp_f,
          last_humidity: record.last_humidity,
          door_state: record.door_state,
          battery_pct: record.battery_pct,
          rssi_dbm: record.rssi_dbm,
          snr_db: record.snr_db,
          last_uplink_at: record.last_uplink_at,
          last_door_event_at: record.last_door_event_at,
          expected_checkin_minutes: record.expected_checkin_minutes,
          warn_after_missed: record.warn_after_missed,
          critical_after_missed: record.critical_after_missed,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'org_id,unit_id', ignoreDuplicates: false }
      )
      .select();

    if (upsertError) {
      console.error('[pull-frostguard-telemetry] Local upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to store telemetry locally', details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pull-frostguard-telemetry] Synced to local:', upsertedData?.length || 0, 'records');

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: upsertedData?.length || remoteTelemetry.length,
        telemetry: upsertedData || remoteTelemetry
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pull-frostguard-telemetry] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
