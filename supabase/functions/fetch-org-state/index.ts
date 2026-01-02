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

    // Build the request to FrostGuard's org-state-api
    const orgStateUrl = `${frostguardUrl}/functions/v1/org-state-api?org_id=${encodeURIComponent(org_id)}`;
    
    console.log(`[fetch-org-state] Fetching org state from FrostGuard for org: ${org_id}`);

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
