import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FetchOrgStateRequest {
  org_id: string;
}

interface RequestDiagnostics {
  request_url_redacted: string;
  request_method: string;
  request_headers_redacted: Record<string, string>;
  org_id_provided: string;
  frostguard_host?: string;
  duration_ms?: number;
  response_status?: number;
  response_status_text?: string;
  response_content_type?: string;
  response_body_snippet?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const localRequestId = crypto.randomUUID().slice(0, 8);
  const requestStartTime = Date.now();
  
  // Helper to build diagnostics object
  const buildDiagnostics = (
    orgId: string,
    frostguardUrl: string | undefined,
    syncApiKey: string | undefined,
    extraFields: Partial<RequestDiagnostics> = {}
  ): RequestDiagnostics => {
    const targetUrl = frostguardUrl 
      ? `${frostguardUrl}/functions/v1/org-state-api?org_id=[REDACTED]`
      : '[NOT_CONFIGURED]';
    
    return {
      request_url_redacted: targetUrl,
      request_method: 'GET',
      request_headers_redacted: {
        authorization: syncApiKey ? `Bearer ...${syncApiKey.slice(-4)}` : '[NOT_CONFIGURED]',
        content_type: 'application/json',
      },
      org_id_provided: orgId || '[MISSING]',
      frostguard_host: frostguardUrl ? new URL(frostguardUrl).host : undefined,
      duration_ms: Date.now() - requestStartTime,
      ...extraFields,
    };
  };

  try {
    const body = await req.json() as FetchOrgStateRequest;
    const { org_id } = body;

    // Get configuration early for diagnostics
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');

    if (!org_id) {
      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 400,
          error: 'org_id is required',
          error_code: 'MISSING_ORG_ID',
          request_id: localRequestId,
          hint: 'No organization ID was provided in the request body.',
          diagnostics,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate org_id format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(org_id)) {
      console.error(`[fetch-org-state][${localRequestId}] Invalid org_id format:`, org_id);
      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 400,
          error: 'Invalid organization ID format',
          error_code: 'INVALID_ORG_ID',
          request_id: localRequestId,
          hint: 'The organization ID must be a valid UUID.',
          diagnostics,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate configuration
    if (!frostguardUrl) {
      console.error(`[fetch-org-state][${localRequestId}] FROSTGUARD_SUPABASE_URL not configured`);
      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 500,
          error: 'FrostGuard URL not configured',
          error_code: 'CONFIG_MISSING',
          request_id: localRequestId,
          hint: 'FROSTGUARD_SUPABASE_URL is not set in project secrets. Contact support.',
          diagnostics,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!syncApiKey) {
      console.error(`[fetch-org-state][${localRequestId}] PROJECT2_SYNC_API_KEY not configured`);
      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 500,
          error: 'Sync API key not configured',
          error_code: 'CONFIG_MISSING',
          request_id: localRequestId,
          hint: 'PROJECT2_SYNC_API_KEY is not set in project secrets. Contact support.',
          diagnostics,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the request to FrostGuard's org-state-api
    const orgStateUrl = `${frostguardUrl}/functions/v1/org-state-api?org_id=${encodeURIComponent(org_id)}`;
    
    console.log(`[fetch-org-state][${localRequestId}] Fetching org state from FrostGuard for org: ${org_id}`);
    console.log(`[fetch-org-state][${localRequestId}] Target URL: ${orgStateUrl.replace(/org_id=.*/, 'org_id=[REDACTED]')}`);
    console.log(`[fetch-org-state][${localRequestId}] Auth: Bearer token present, key last4: ${syncApiKey.slice(-4)}`);

    const response = await fetch(orgStateUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const responseContentType = response.headers.get('content-type') || 'unknown';
    const durationMs = Date.now() - requestStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetch-org-state][${localRequestId}] FrostGuard returned ${response.status}:`, errorText);
      
      // Capture response snippet (first 2KB, redacted)
      const responseSnippet = errorText.slice(0, 2048);
      
      // Try to parse JSON for structured errors from FrostGuard
      let errorData: Record<string, unknown> = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { raw_response: responseSnippet };
      }

      // Extract fields from FrostGuard's structured response
      const frostguardRequestId = errorData.request_id as string | undefined;
      const errorMessage = (errorData.error || errorData.message || `FrostGuard API error: ${response.status}`) as string;
      const errorCode = (errorData.error_code || errorData.code) as string | undefined;

      // Build comprehensive diagnostics
      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey, {
        response_status: response.status,
        response_status_text: response.statusText,
        response_content_type: responseContentType,
        response_body_snippet: responseSnippet.slice(0, 500), // Smaller snippet for JSON response
        duration_ms: durationMs,
      });

      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: response.status,
          error: errorMessage,
          error_code: errorCode || `HTTP_${response.status}`,
          request_id: frostguardRequestId || localRequestId,
          hint: getStatusHint(response.status, errorCode),
          details: errorData,
          diagnostics,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    // Check if FrostGuard returned ok: false in the body (even with HTTP 200)
    if (data.ok === false) {
      console.error(`[fetch-org-state][${localRequestId}] FrostGuard returned ok=false in body:`, {
        error: data.error,
        error_code: data.error_code,
        request_id: data.request_id,
        response_keys: Object.keys(data),
      });

      // Build a more descriptive error message when FrostGuard doesn't provide one
      const hasNoErrorMessage = !data.error && !data.message;
      const fallbackError = hasNoErrorMessage
        ? `FrostGuard rejected the request for org ${org_id.slice(0, 8)}... (no error message provided)`
        : (data.error || data.message || 'FrostGuard returned failure in response body');

      // Build a more helpful hint when the error is vague
      const fallbackHint = hasNoErrorMessage
        ? 'The organization may not exist in FrostGuard, or the API key may lack permissions for this org. Try selecting a different user or contact support.'
        : (data.hint || 'FrostGuard processed the request but returned an error.');

      const diagnostics = buildDiagnostics(org_id, frostguardUrl, syncApiKey, {
        response_status: 200,
        response_status_text: 'OK (but ok=false in body)',
        response_content_type: responseContentType,
        duration_ms: durationMs,
      });

      return new Response(
        JSON.stringify({
          ok: false,
          status_code: data.status_code || 200,
          error: fallbackError,
          error_code: data.error_code || data.code || 'UPSTREAM_FAILURE',
          request_id: data.request_id || localRequestId,
          hint: fallbackHint,
          details: {
            sync_version: data.sync_version,
            has_sites: Array.isArray(data.sites),
            has_units: Array.isArray(data.units),
            has_sensors: Array.isArray(data.sensors),
            has_gateways: Array.isArray(data.gateways),
            org_id_requested: org_id,
            response_keys: Object.keys(data),
          },
          diagnostics,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch-org-state][${localRequestId}] Successfully fetched org state:`, {
      sync_version: data.sync_version,
      sites_count: data.sites?.length || 0,
      units_count: data.units?.length || 0,
      sensors_count: data.sensors?.length || 0,
      gateways_count: data.gateways?.length || 0,
      ttn_enabled: data.ttn?.enabled || false,
      duration_ms: durationMs,
    });

    // Pass through the response from FrostGuard with added diagnostics
    return new Response(
      JSON.stringify({
        ...data,
        ok: true,
        status_code: 200,
        request_id: data.request_id || localRequestId,
        diagnostics: {
          duration_ms: durationMs,
          frostguard_host: new URL(frostguardUrl).host,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[fetch-org-state][${localRequestId}] Error:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Try to get config for diagnostics even on error
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');
    
    // Check for CORS-like or network errors
    const isCorsLike = message.includes('CORS') || message.includes('blocked') || message.includes('network');
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        status_code: 500,
        error: message,
        error_code: isCorsLike ? 'NETWORK_ERROR' : 'INTERNAL_ERROR',
        request_id: localRequestId,
        hint: isCorsLike 
          ? 'Network or CORS error. Check that FrostGuard URL is correct and accessible.'
          : 'Unexpected error in fetch-org-state. Export a support snapshot for diagnosis.',
        diagnostics: {
          request_url_redacted: frostguardUrl ? `${frostguardUrl}/functions/v1/org-state-api?org_id=[REDACTED]` : '[NOT_CONFIGURED]',
          request_method: 'GET',
          request_headers_redacted: {
            authorization: syncApiKey ? `Bearer ...${syncApiKey.slice(-4)}` : '[NOT_CONFIGURED]',
          },
          org_id_provided: '[PARSE_ERROR]',
          duration_ms: Date.now() - requestStartTime,
          error_type: error instanceof Error ? error.name : 'Unknown',
        },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function for status-specific hints
function getStatusHint(status: number, errorCode?: string): string {
  switch (status) {
    case 401:
      return 'Unauthorized: The SYNC API key is invalid or missing. Check PROJECT2_SYNC_API_KEY in project secrets.';
    case 403:
      return 'Forbidden: The API key lacks permissions for this organization or endpoint.';
    case 400:
      if (errorCode === 'MISSING_ORG_ID') return 'Bad request: No organization ID was provided.';
      if (errorCode === 'INVALID_ORG_ID') return 'Bad request: The organization ID format is invalid.';
      return 'Bad request: The request was malformed. Check the organization ID.';
    case 404:
      return 'Not found: The org-state-api endpoint or organization does not exist. Check FROSTGUARD_SUPABASE_URL.';
    case 500:
      return 'FrostGuard internal error: The org-state-api edge function failed. Export a snapshot and check FrostGuard logs.';
    case 502:
    case 503:
      return 'FrostGuard unavailable: The service is temporarily unavailable. Try again in a moment.';
    default:
      return `FrostGuard returned status ${status}. Export a support snapshot for diagnosis.`;
  }
}
