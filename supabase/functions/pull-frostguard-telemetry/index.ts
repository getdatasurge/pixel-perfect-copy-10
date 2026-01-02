/**
 * @deprecated This function uses FROSTGUARD_ANON_KEY for direct database access.
 * The emulator now uses pull-based sync via fetch-org-state for entity data.
 * Telemetry data should be pulled through the org-state-api or dedicated endpoints.
 * This function is kept for backward compatibility only.
 */
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

    // Try to query sensor_uplinks table first (raw telemetry data)
    // This table should exist in FrostGuard based on the TTN webhook architecture
    let query = frostguard
      .from('sensor_uplinks')
      .select('*');

    if (org_id) {
      query = query.eq('org_id', org_id);
    } else if (unit_id) {
      query = query.eq('unit_id', unit_id);
    }

    // Get the most recent uplinks
    query = query.order('received_at', { ascending: false }).limit(10);

    const { data: uplinkData, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching from FrostGuard sensor_uplinks:', fetchError);

      // Try the unit_telemetry_view if it exists
      const viewQuery = frostguard
        .from('unit_telemetry_view')
        .select('*')
        .eq('org_id', org_id)
        .order('updated_at', { ascending: false })
        .limit(10);

      const { data: viewData, error: viewError } = await viewQuery;

      if (viewError) {
        console.error('Error fetching from FrostGuard unit_telemetry_view:', viewError);
        return new Response(
          JSON.stringify({
            error: `FrostGuard doesn't have telemetry tables. Tables tried: sensor_uplinks, unit_telemetry_view`,
            details: `sensor_uplinks error: ${fetchError.message}, view error: ${viewError.message}`
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use view data directly
      return new Response(
        JSON.stringify({
          success: true,
          data: viewData,
          count: viewData?.length || 0,
          source: 'unit_telemetry_view',
          synced_to_local: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!uplinkData || uplinkData.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          message: 'No telemetry data found in FrostGuard',
          count: 0,
          synced_to_local: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${uplinkData.length} sensor uplinks from FrostGuard`);

    // Optionally sync to local database
    if (sync_to_local && uplinkData.length > 0) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const localSupabase = createClient(supabaseUrl, supabaseServiceKey);

      // Convert sensor_uplinks to unit_telemetry format
      // We'll aggregate the most recent data per unit_id
      const telemetryByUnit = new Map();

      for (const uplink of uplinkData) {
        const unitId = uplink.unit_id;
        if (!unitId) continue;

        const payload = uplink.payload_json || {};

        if (!telemetryByUnit.has(unitId)) {
          telemetryByUnit.set(unitId, {
            unit_id: unitId,
            org_id: uplink.org_id,
            last_temp_f: payload.temperature || null,
            last_humidity: payload.humidity || null,
            door_state: payload.door_status || 'unknown',
            battery_pct: uplink.battery_pct,
            rssi_dbm: uplink.rssi_dbm,
            snr_db: uplink.snr_db,
            last_uplink_at: uplink.received_at,
            updated_at: uplink.received_at,
            expected_checkin_minutes: 5,
            warn_after_missed: 1,
            critical_after_missed: 5,
          });
        }
      }

      // Upsert aggregated telemetry
      for (const [unitId, telemetry] of telemetryByUnit) {
        const { error: upsertError } = await localSupabase
          .from('unit_telemetry')
          .upsert(telemetry, {
            onConflict: 'unit_id'
          });

        if (upsertError) {
          console.error('Error syncing to local database:', upsertError);
        }
      }

      console.log(`Synced ${telemetryByUnit.size} telemetry records to local database from ${uplinkData.length} uplinks`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: uplinkData,
        count: uplinkData.length,
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
