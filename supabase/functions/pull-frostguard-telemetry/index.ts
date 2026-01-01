import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PullTelemetryRequest {
  org_id?: string;
  unit_id?: string;
  sync_to_local?: boolean; // If true, syncs data to local unit_telemetry table
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as PullTelemetryRequest;
    const { org_id, unit_id, sync_to_local = false } = body;

    if (!org_id && !unit_id) {
      return new Response(
        JSON.stringify({ error: 'Either org_id or unit_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Connect to FrostGuard (Project 1)
    const frostguardUrl = 'https://mfwyiifehsvwnjwqoxht.supabase.co';
    const frostguardKey = Deno.env.get('FROSTGUARD_ANON_KEY');

    if (!frostguardKey) {
      return new Response(
        JSON.stringify({ error: 'FrostGuard credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const frostguard = createClient(frostguardUrl, frostguardKey);

    // Build query to pull telemetry from FrostGuard
    let query = frostguard
      .from('unit_telemetry')
      .select('*');

    if (unit_id) {
      query = query.eq('unit_id', unit_id);
    } else if (org_id) {
      query = query.eq('org_id', org_id);
    }

    // Get the most recent telemetry
    query = query.order('updated_at', { ascending: false }).limit(10);

    const { data: telemetryData, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching from FrostGuard:', fetchError);
      return new Response(
        JSON.stringify({ error: `Failed to fetch from FrostGuard: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!telemetryData || telemetryData.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          message: 'No telemetry data found in FrostGuard'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Optionally sync to local database
    if (sync_to_local && telemetryData.length > 0) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const localSupabase = createClient(supabaseUrl, supabaseServiceKey);

      // Upsert each telemetry record to local database
      for (const record of telemetryData) {
        const { error: upsertError } = await localSupabase
          .from('unit_telemetry')
          .upsert({
            id: record.id,
            unit_id: record.unit_id,
            org_id: record.org_id,
            last_temp_f: record.last_temp_f,
            last_humidity: record.last_humidity,
            door_state: record.door_state,
            last_door_event_at: record.last_door_event_at,
            battery_pct: record.battery_pct,
            rssi_dbm: record.rssi_dbm,
            snr_db: record.snr_db,
            last_uplink_at: record.last_uplink_at,
            updated_at: record.updated_at,
            expected_checkin_minutes: record.expected_checkin_minutes,
            warn_after_missed: record.warn_after_missed,
            critical_after_missed: record.critical_after_missed,
          }, {
            onConflict: 'id'
          });

        if (upsertError) {
          console.error('Error syncing to local database:', upsertError);
          // Continue with other records even if one fails
        }
      }

      console.log(`Synced ${telemetryData.length} telemetry records to local database`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: telemetryData,
        count: telemetryData.length,
        synced_to_local: sync_to_local,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in pull-frostguard-telemetry:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
