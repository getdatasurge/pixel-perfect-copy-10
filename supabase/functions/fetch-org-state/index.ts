import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FetchOrgStateRequest {
  org_id: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const localRequestId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await req.json() as FetchOrgStateRequest;
    const { org_id } = body;

    if (!org_id) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 400,
          error: 'org_id is required',
          error_code: 'MISSING_ORG_ID',
          request_id: localRequestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the FrostGuard API endpoint and API key from secrets
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');

    if (!frostguardUrl) {
      console.error('[fetch-org-state] FROSTGUARD_SUPABASE_URL not configured');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 500,
          error: 'FrostGuard URL not configured',
          error_code: 'CONFIG_MISSING',
          request_id: localRequestId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!syncApiKey) {
      console.error('[fetch-org-state] PROJECT2_SYNC_API_KEY not configured');
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 500,
          error: 'Sync API key not configured',
          error_code: 'CONFIG_MISSING',
          request_id: localRequestId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate org_id format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(org_id)) {
      console.error('[fetch-org-state] Invalid org_id format:', org_id);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: 400,
          error: 'Invalid organization ID format',
          error_code: 'INVALID_ORG_ID',
          request_id: localRequestId,
          hint: 'The organization ID must be a valid UUID.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the request to FrostGuard's org-state-api
    const orgStateUrl = `${frostguardUrl}/functions/v1/org-state-api?org_id=${encodeURIComponent(org_id)}`;
    
    console.log(`[fetch-org-state] Fetching org state from FrostGuard for org: ${org_id}`);
    console.log(`[fetch-org-state] Target URL: ${orgStateUrl.replace(/org_id=.*/, 'org_id=[REDACTED]')}`);
    console.log(`[fetch-org-state] Auth: Bearer token present, key last4: ${syncApiKey.slice(-4)}`);

    const response = await fetch(orgStateUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetch-org-state] FrostGuard returned ${response.status}:`, errorText);
      
      // Try to parse JSON for structured errors from FrostGuard
      let errorData: Record<string, unknown> = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { raw: errorText.slice(0, 500) };
      }

      // Extract fields from FrostGuard's structured response
      const frostguardRequestId = errorData.request_id as string | undefined;
      const errorMessage = (errorData.error || errorData.message || `FrostGuard API error: ${response.status}`) as string;
      const errorCode = (errorData.error_code || errorData.code) as string | undefined;

      return new Response(
        JSON.stringify({ 
          ok: false, 
          status_code: response.status,
          error: errorMessage,
          error_code: errorCode || null,
          request_id: frostguardRequestId || localRequestId,
          details: errorData,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    // Check if FrostGuard returned ok: false in the body (even with HTTP 200)
    if (data.ok === false) {
      console.error('[fetch-org-state] FrostGuard returned ok=false in body:', {
        error: data.error,
        error_code: data.error_code,
        request_id: data.request_id,
        response_keys: Object.keys(data),
      });

      // Build a more descriptive error message when FrostGuard doesn't provide one
      const hasNoErrorMessage = !data.error && !data.message;
      const fallbackError = hasNoErrorMessage
        ? `FrostGuard rejected the request for org ${org_id.slice(0, 8)}... (no error message provided)`
        : 'FrostGuard returned failure in response body';

      // Build a more helpful hint when the error is vague
      const fallbackHint = hasNoErrorMessage
        ? 'The organization may not exist in FrostGuard, or the API key may lack permissions for this org. Try selecting a different user or contact support.'
        : 'FrostGuard processed the request but returned an error.';

      return new Response(
        JSON.stringify({
          ok: false,
          status_code: data.status_code || 200,
          error: data.error || data.message || fallbackError,
          error_code: data.error_code || data.code || 'UPSTREAM_FAILURE',
          request_id: data.request_id || localRequestId,
          hint: data.hint || fallbackHint,
          details: {
            sync_version: data.sync_version,
            has_sites: Array.isArray(data.sites),
            has_sensors: Array.isArray(data.sensors),
            has_gateways: Array.isArray(data.gateways),
            org_id_requested: org_id,
            response_keys: Object.keys(data),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch-org-state] Successfully fetched org state:`, {
      sync_version: data.sync_version,
      sites_count: data.sites?.length || 0,
      sensors_count: data.sensors?.length || 0,
      gateways_count: data.gateways?.length || 0,
      ttn_enabled: data.ttn?.enabled || false,
    });

    // Pass through the response from FrostGuard
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[fetch-org-state] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        ok: false, 
        status_code: 500,
        error: message,
        error_code: 'INTERNAL_ERROR',
        request_id: localRequestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
