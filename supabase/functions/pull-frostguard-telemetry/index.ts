// Pull Telemetry from FrostGuard
// Queries sensor_readings table from FrostGuard (Project 1) and optionally syncs to local

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PullTelemetryRequest {
  org_id?: string;
  unit_id?: string;
  sync_to_local?: boolean;
}

interface PullTelemetryResult {
  ok: boolean;
  request_id: string;
  data?: unknown[];
  count?: number;
  source?: string;
  synced_to_local?: boolean;
  error?: string;
  error_code?: string;
  hint?: string;
  table_attempted?: string;
}

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log(`[pull-frostguard-telemetry][${requestId}] Request received`);

  try {
    const body = await req.json() as PullTelemetryRequest;
    const { org_id, unit_id, sync_to_local = false } = body;

    // Validate required inputs
    if (!org_id && !unit_id) {
      console.log(`[pull-frostguard-telemetry][${requestId}] Missing org_id and unit_id`);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'Either org_id or unit_id is required',
        error_code: 'MISSING_REQUIRED_PARAM',
        hint: 'Provide org_id to pull telemetry for an organization, or unit_id for a specific unit',
      }, 400);
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] PULL_REQUEST`, {
      org_id: org_id || null,
      unit_id: unit_id || null,
      sync_to_local,
    });

    // Connect to FrostGuard (Project 1)
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL') || 'https://mfwyiifehsvwnjwqoxht.supabase.co';
    const frostguardKey = Deno.env.get('FROSTGUARD_ANON_KEY');

    if (!frostguardKey) {
      console.error(`[pull-frostguard-telemetry][${requestId}] Missing FROSTGUARD_ANON_KEY`);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'FrostGuard credentials not configured',
        error_code: 'MISSING_FROSTGUARD_CONFIG',
        hint: 'FROSTGUARD_ANON_KEY environment variable is missing. Configure it in Supabase secrets.',
      }, 500);
    }

    const frostguard = createClient(frostguardUrl, frostguardKey);

    // Query sensor_readings table (correct table in FrostGuard)
    console.log(`[pull-frostguard-telemetry][${requestId}] Querying sensor_readings from FrostGuard`);
    
    let query = frostguard
      .from('sensor_readings')
      .select('*');

    // Note: sensor_readings may not have org_id column directly
    // It might be linked via unit_id or device_serial
    // For now, we'll try to filter if the column exists
    if (unit_id) {
      query = query.eq('unit_id', unit_id);
    }

    // Get the most recent readings
    query = query.order('created_at', { ascending: false }).limit(50);

    const { data: readingsData, error: fetchError } = await query;

    if (fetchError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] FrostGuard query error:`, fetchError);
      
      // Check if it's a table not found error
      if (fetchError.code === 'PGRST205' || fetchError.message?.includes('not find')) {
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: `Table not found in FrostGuard: ${fetchError.message}`,
          error_code: 'TABLE_NOT_FOUND',
          hint: `FrostGuard schema may have changed. Check if sensor_readings table exists. Hint from DB: ${fetchError.hint || 'none'}`,
          table_attempted: 'sensor_readings',
        }, 404);
      }

      // Check if it's an RLS/permission error
      if (fetchError.code === '42501' || fetchError.message?.includes('permission')) {
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: `Permission denied: ${fetchError.message}`,
          error_code: 'PERMISSION_DENIED',
          hint: 'FrostGuard RLS policies may be blocking access. Check that FROSTGUARD_ANON_KEY has SELECT permission.',
          table_attempted: 'sensor_readings',
        }, 403);
      }

      return buildResponse({
        ok: false,
        request_id: requestId,
        error: fetchError.message,
        error_code: fetchError.code || 'QUERY_ERROR',
        hint: fetchError.hint || 'Query to FrostGuard sensor_readings failed',
        table_attempted: 'sensor_readings',
      }, 500);
    }

    if (!readingsData || readingsData.length === 0) {
      console.log(`[pull-frostguard-telemetry][${requestId}] No telemetry data found`);
      return buildResponse({
        ok: true,
        request_id: requestId,
        data: [],
        count: 0,
        source: 'sensor_readings',
        synced_to_local: false,
        hint: 'No telemetry data found in FrostGuard for the given criteria',
      }, 200);
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] Found ${readingsData.length} readings`);

    // Optionally sync to local database
    if (sync_to_local && readingsData.length > 0) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const localSupabase = createClient(supabaseUrl, supabaseServiceKey);

        // Convert sensor_readings to unit_telemetry format
        // Group by unit_id and take the most recent values
        const telemetryByUnit = new Map<string, Record<string, unknown>>();

        for (const reading of readingsData) {
          const unitId = reading.unit_id;
          if (!unitId) continue;

          // Only keep the most recent reading per unit
          if (!telemetryByUnit.has(unitId)) {
            telemetryByUnit.set(unitId, {
              unit_id: unitId,
              org_id: org_id || reading.org_id,
              last_temp_f: reading.temperature || null,
              last_humidity: reading.humidity || null,
              door_state: 'unknown', // sensor_readings may not have door state
              battery_pct: reading.battery_level || null,
              rssi_dbm: reading.signal_strength || null,
              snr_db: null,
              last_uplink_at: reading.created_at,
              updated_at: reading.created_at,
              expected_checkin_minutes: 5,
              warn_after_missed: 1,
              critical_after_missed: 5,
            });
          }
        }

        // Upsert aggregated telemetry
        let syncedCount = 0;
        for (const [unitId, telemetry] of telemetryByUnit) {
          const { error: upsertError } = await localSupabase
            .from('unit_telemetry')
            .upsert(telemetry, { onConflict: 'unit_id' });

          if (upsertError) {
            console.warn(`[pull-frostguard-telemetry][${requestId}] Upsert warning for ${unitId}:`, upsertError.message);
          } else {
            syncedCount++;
          }
        }

        console.log(`[pull-frostguard-telemetry][${requestId}] Synced ${syncedCount} telemetry records from ${readingsData.length} readings`);
      } catch (syncErr) {
        console.warn(`[pull-frostguard-telemetry][${requestId}] Local sync error:`, syncErr);
        // Don't fail the whole request, just note sync failed
      }
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] PULL_SUCCESS`, {
      count: readingsData.length,
      source: 'sensor_readings',
      synced: sync_to_local,
    });

    return buildResponse({
      ok: true,
      request_id: requestId,
      data: readingsData,
      count: readingsData.length,
      source: 'sensor_readings',
      synced_to_local: sync_to_local,
    }, 200);

  } catch (error) {
    console.error(`[pull-frostguard-telemetry][${requestId}] Error:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return buildResponse({
      ok: false,
      request_id: requestId,
      error: message,
      error_code: 'UNKNOWN_ERROR',
      hint: 'An unexpected error occurred while pulling telemetry',
    }, 500);
  }
});

function buildResponse(data: PullTelemetryResult, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
