// Pull Telemetry - Query local sensor_readings and sync to unit_telemetry
//
// ARCHITECTURE NOTE:
// Telemetry data flows: Sensors → TTN → ttn-webhook (local) → local sensor_readings/unit_telemetry
// This function queries the LOCAL database, not FrostGuard, because:
// 1. FrostGuard's sensor_readings table has RLS that blocks direct access
// 2. The ttn-webhook already writes telemetry to the local database
// 3. Querying local data is faster and more reliable
//
// If you need FrostGuard org data (sensors, gateways, sites), use fetch-org-state instead.

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
  diagnostics?: Record<string, unknown>;
}

// Always return HTTP 200 so supabase.functions.invoke() can access the response body.
function buildResponse(data: PullTelemetryResult): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Diagnostic: Log environment variable availability
  const envDiagnostics = {
    has_supabase_url: !!Deno.env.get('SUPABASE_URL'),
    has_service_role_key: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    source: 'local_database',
  };

  console.log(`[pull-frostguard-telemetry][${requestId}] Request received`);
  console.log(`[pull-frostguard-telemetry][${requestId}] ENV_CHECK:`, JSON.stringify(envDiagnostics));

  try {
    // Parse request body
    let body: PullTelemetryRequest;
    try {
      body = await req.json() as PullTelemetryRequest;
    } catch (parseError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] JSON parse error:`, parseError);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'Invalid JSON in request body',
        error_code: 'INVALID_JSON',
        hint: 'Ensure request body is valid JSON with org_id or unit_id',
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

    // Connect to LOCAL Supabase database
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(`[pull-frostguard-telemetry][${requestId}] Missing local Supabase credentials`);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'Local Supabase credentials not configured',
        error_code: 'MISSING_CONFIG',
        hint: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable is missing.',
        diagnostics: envDiagnostics,
      });
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] Connecting to local Supabase...`);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, try to get data from unit_telemetry (aggregated telemetry)
    console.log(`[pull-frostguard-telemetry][${requestId}] Querying unit_telemetry from local database`);

    let telemetryQuery = supabase
      .from('unit_telemetry')
      .select('*');

    if (org_id) {
      telemetryQuery = telemetryQuery.eq('org_id', org_id);
    }
    if (unit_id) {
      telemetryQuery = telemetryQuery.eq('unit_id', unit_id);
    }

    telemetryQuery = telemetryQuery.order('last_uplink_at', { ascending: false }).limit(50);

    const { data: telemetryData, error: telemetryError } = await telemetryQuery;

    if (telemetryError) {
      console.error(`[pull-frostguard-telemetry][${requestId}] unit_telemetry query error:`, telemetryError);

      // If unit_telemetry doesn't exist or has issues, try sensor_readings
      console.log(`[pull-frostguard-telemetry][${requestId}] Falling back to sensor_readings...`);

      let readingsQuery = supabase
        .from('sensor_readings')
        .select('*');

      if (unit_id) {
        readingsQuery = readingsQuery.eq('unit_id', unit_id);
      }

      readingsQuery = readingsQuery.order('created_at', { ascending: false }).limit(50);

      const { data: readingsData, error: readingsError } = await readingsQuery;

      if (readingsError) {
        console.error(`[pull-frostguard-telemetry][${requestId}] sensor_readings query error:`, readingsError);

        // Check for specific error types
        const errorMessage = readingsError.message || 'Unknown database error';
        const errorCode = readingsError.code || 'QUERY_ERROR';

        let hint = 'Database query failed. ';
        if (errorCode === 'PGRST204' || errorMessage.includes('does not exist')) {
          hint += 'The sensor_readings table may not exist. Telemetry data is created when the TTN webhook receives uplinks.';
        } else if (errorCode === '42501' || errorMessage.includes('permission')) {
          hint += 'Permission denied. Check database RLS policies.';
        } else {
          hint += `Error: ${errorMessage}`;
        }

        return buildResponse({
          ok: false,
          request_id: requestId,
          error: errorMessage,
          error_code: errorCode,
          hint,
          table_attempted: 'sensor_readings',
          diagnostics: { ...envDiagnostics, pg_error_code: errorCode },
        });
      }

      // Return sensor_readings data
      console.log(`[pull-frostguard-telemetry][${requestId}] Found ${readingsData?.length || 0} sensor_readings`);

      return buildResponse({
        ok: true,
        request_id: requestId,
        data: readingsData || [],
        count: readingsData?.length || 0,
        source: 'sensor_readings',
        synced_to_local: false,
        hint: readingsData?.length ? undefined : 'No sensor readings found. Telemetry is created when sensors send uplinks via TTN.',
      });
    }

    // Success with unit_telemetry
    console.log(`[pull-frostguard-telemetry][${requestId}] Found ${telemetryData?.length || 0} unit_telemetry records`);

    if (!telemetryData || telemetryData.length === 0) {
      return buildResponse({
        ok: true,
        request_id: requestId,
        data: [],
        count: 0,
        source: 'unit_telemetry',
        synced_to_local: false,
        hint: 'No telemetry data found. Telemetry is created when sensors send uplinks via the TTN webhook.',
        diagnostics: envDiagnostics,
      });
    }

    console.log(`[pull-frostguard-telemetry][${requestId}] PULL_SUCCESS`, {
      count: telemetryData.length,
      source: 'unit_telemetry',
    });

    return buildResponse({
      ok: true,
      request_id: requestId,
      data: telemetryData,
      count: telemetryData.length,
      source: 'unit_telemetry',
      synced_to_local: true, // Already in local DB
    });

  } catch (error) {
    console.error(`[pull-frostguard-telemetry][${requestId}] Unhandled error:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;

    if (stack) {
      console.error(`[pull-frostguard-telemetry][${requestId}] Stack trace:`, stack);
    }

    return buildResponse({
      ok: false,
      request_id: requestId,
      error: message,
      error_code: 'UNKNOWN_ERROR',
      hint: 'An unexpected error occurred. Check Supabase Edge Function logs for details.',
      diagnostics: {
        error_type: error instanceof Error ? error.constructor.name : typeof error,
      },
    });
  }
});
