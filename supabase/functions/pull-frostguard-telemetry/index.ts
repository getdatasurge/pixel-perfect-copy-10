// Pull Telemetry from FrostGuard
// Queries sensor_readings table from FrostGuard (Project 1) and optionally syncs to local
//
// IMPORTANT: This function always returns HTTP 200 with ok:true/false in the body.
// This is because supabase.functions.invoke() doesn't properly expose error response
// bodies for non-2xx status codes, causing clients to see generic error messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Log immediately on module load to catch boot errors
console.log('[pull-frostguard-telemetry] Module loading...');

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
  diagnostics?: Record<string, unknown>;
}

// Always return HTTP 200 so supabase.functions.invoke() can access the response body.
// Error state is indicated by ok:false in the response.
function buildResponse(data: PullTelemetryResult): Response {
  return new Response(JSON.stringify(data), {
    status: 200, // Always 200 - errors are in the body with ok:false
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Safe error response that never throws
function safeErrorResponse(requestId: string, error: unknown, context: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.constructor.name : typeof error;

  console.error(`[pull-frostguard-telemetry][${requestId}] ${context}:`, message);

  return buildResponse({
    ok: false,
    request_id: requestId,
    error: message,
    error_code: 'UNHANDLED_ERROR',
    hint: `Error in ${context}. Check Edge Function logs for request_id: ${requestId}`,
    diagnostics: {
      context,
      error_type: errorType,
      timestamp: new Date().toISOString(),
    },
  });
}

console.log('[pull-frostguard-telemetry] Module loaded successfully');

// Use Deno.serve (modern API) instead of deprecated serve() import
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  console.log(`[pull-frostguard-telemetry][${requestId}] Request received: ${req.method} ${req.url}`);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log(`[pull-frostguard-telemetry][${requestId}] CORS preflight`);
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Diagnostic: Log environment variable availability (not values)
  const envDiagnostics = {
    has_frostguard_url: !!Deno.env.get('FROSTGUARD_SUPABASE_URL'),
    has_frostguard_key: !!Deno.env.get('FROSTGUARD_ANON_KEY'),
    has_supabase_url: !!Deno.env.get('SUPABASE_URL'),
    has_service_role_key: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    frostguard_url_preview: Deno.env.get('FROSTGUARD_SUPABASE_URL')?.slice(0, 30) || '(not set)',
    frostguard_key_preview: Deno.env.get('FROSTGUARD_ANON_KEY')
      ? `****${Deno.env.get('FROSTGUARD_ANON_KEY')!.slice(-4)}`
      : '(not set)',
  };

  console.log(`[pull-frostguard-telemetry][${requestId}] ENV_CHECK:`, JSON.stringify(envDiagnostics));

  try {
    // Parse request body with explicit error handling
    let body: PullTelemetryRequest;
    try {
      const contentType = req.headers.get('content-type') || '';
      console.log(`[pull-frostguard-telemetry][${requestId}] Content-Type: ${contentType}`);

      const rawBody = await req.text();
      console.log(`[pull-frostguard-telemetry][${requestId}] Raw body length: ${rawBody.length}`);

      if (!rawBody || rawBody.trim() === '') {
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: 'Request body is empty',
          error_code: 'EMPTY_BODY',
          hint: 'The request must include a JSON body with org_id or unit_id',
          diagnostics: envDiagnostics,
        });
      }

      body = JSON.parse(rawBody) as PullTelemetryRequest;
      console.log(`[pull-frostguard-telemetry][${requestId}] Parsed body:`, JSON.stringify(body));
    } catch (parseError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] JSON parse error:`, parseError);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: `Invalid JSON in request body: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
        error_code: 'INVALID_JSON',
        hint: 'Ensure the request body is valid JSON with org_id or unit_id',
        diagnostics: envDiagnostics,
      });
    }

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
        diagnostics: envDiagnostics,
      });
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
        hint: 'FROSTGUARD_ANON_KEY environment variable is missing. Configure it in Supabase Dashboard > Project Settings > Edge Functions > Secrets.',
        diagnostics: envDiagnostics,
      });
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] Connecting to FrostGuard: ${frostguardUrl.slice(0, 30)}...`);

    let frostguard;
    try {
      frostguard = createClient(frostguardUrl, frostguardKey);
    } catch (clientError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] Failed to create FrostGuard client:`, clientError);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: `Failed to initialize FrostGuard client: ${clientError instanceof Error ? clientError.message : 'Unknown error'}`,
        error_code: 'CLIENT_INIT_ERROR',
        hint: 'Check that FROSTGUARD_SUPABASE_URL and FROSTGUARD_ANON_KEY are valid',
        diagnostics: envDiagnostics,
      });
    }

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

    console.log(`[pull-frostguard-telemetry][${requestId}] Executing query...`);
    const { data: readingsData, error: fetchError } = await query;

    if (fetchError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] FrostGuard query error:`, fetchError);
      console.error(`[pull-frostguard-telemetry][${requestId}] Error details:`, JSON.stringify({
        code: fetchError.code,
        message: fetchError.message,
        hint: fetchError.hint,
        details: fetchError.details,
      }));

      // Check if it's a table not found error
      if (fetchError.code === 'PGRST205' || fetchError.message?.includes('not find')) {
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: `Table not found in FrostGuard: ${fetchError.message}`,
          error_code: 'TABLE_NOT_FOUND',
          hint: `FrostGuard schema may have changed. Check if sensor_readings table exists. Hint from DB: ${fetchError.hint || 'none'}`,
          table_attempted: 'sensor_readings',
          diagnostics: { ...envDiagnostics, pg_error_code: fetchError.code },
        });
      }

      // Check if it's an RLS/permission error
      if (fetchError.code === '42501' || fetchError.message?.includes('permission')) {
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: `Permission denied: ${fetchError.message}`,
          error_code: 'PERMISSION_DENIED',
          hint: 'FrostGuard RLS policies may be blocking access. Check that FROSTGUARD_ANON_KEY has SELECT permission on sensor_readings.',
          table_attempted: 'sensor_readings',
          diagnostics: { ...envDiagnostics, pg_error_code: fetchError.code },
        });
      }

      // Generic query error - include all available details
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: fetchError.message,
        error_code: fetchError.code || 'QUERY_ERROR',
        hint: fetchError.hint || `Query to FrostGuard sensor_readings failed. PostgreSQL error code: ${fetchError.code || 'unknown'}`,
        table_attempted: 'sensor_readings',
        diagnostics: { ...envDiagnostics, pg_error_code: fetchError.code, pg_hint: fetchError.hint },
      });
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
      });
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] Found ${readingsData.length} readings`);

    // Optionally sync to local database
    let syncedCount = 0;
    let syncError: string | null = null;

    if (sync_to_local && readingsData.length > 0) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !supabaseServiceKey) {
          console.warn(`[pull-frostguard-telemetry][${requestId}] Missing local Supabase credentials for sync`);
          syncError = 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for local sync';
        } else {
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
        }
      } catch (syncErr) {
        console.warn(`[pull-frostguard-telemetry][${requestId}] Local sync error:`, syncErr);
        syncError = syncErr instanceof Error ? syncErr.message : 'Unknown sync error';
        // Don't fail the whole request, just note sync failed
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[pull-frostguard-telemetry][${requestId}] PULL_SUCCESS in ${elapsed}ms`, {
      count: readingsData.length,
      source: 'sensor_readings',
      synced: sync_to_local,
      synced_count: syncedCount,
      sync_error: syncError,
    });

    return buildResponse({
      ok: true,
      request_id: requestId,
      data: readingsData,
      count: readingsData.length,
      source: 'sensor_readings',
      synced_to_local: sync_to_local && syncedCount > 0,
      diagnostics: sync_to_local ? { synced_count: syncedCount, sync_error: syncError } : undefined,
    });

  } catch (error) {
    return safeErrorResponse(requestId, error, 'main handler');
  }
});
