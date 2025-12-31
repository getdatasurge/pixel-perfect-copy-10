import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryRequest {
  org_id: string;
}

interface TTNSnapshot {
  cluster: string;
  application_id: string;
  api_key_last4: string;
  ttn_enabled: boolean;
  webhook_enabled: boolean;
  updated_at: string;
  last_test_at?: string;
  last_test_success?: boolean;
  // Live TTN data
  ttn_application_name?: string;
  ttn_device_count?: number;
  ttn_connected: boolean;
  ttn_error?: string;
}

interface TTNSettingsRow {
  cluster: string;
  application_id: string | null;
  api_key: string | null;
  enabled: boolean;
  webhook_secret: string | null;
  updated_at: string;
  last_test_at: string | null;
  last_test_success: boolean | null;
}

serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] query-ttn-snapshot invoked`);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { org_id } = (await req.json()) as QueryRequest;

    if (!org_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "org_id is required", code: "MISSING_ORG_ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] Querying TTN snapshot for org: ${org_id}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load TTN settings from local database
    const { data: settings, error: dbError } = await supabase
      .from("ttn_settings")
      .select("cluster, application_id, api_key, enabled, webhook_secret, updated_at, last_test_at, last_test_success")
      .eq("org_id", org_id)
      .single();

    if (dbError || !settings) {
      console.log(`[${requestId}] No TTN settings found for org: ${org_id}`);
      return new Response(
        JSON.stringify({ ok: false, error: "No TTN settings found for this organization", code: "NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ttnSettings = settings as TTNSettingsRow;

    if (!ttnSettings.application_id || !ttnSettings.api_key) {
      console.log(`[${requestId}] TTN settings incomplete - missing application_id or api_key`);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "TTN settings incomplete. Please configure application ID and API key.", 
          code: "INCOMPLETE_SETTINGS" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build TTN API URL
    const ttnCluster = ttnSettings.cluster || "nam1";
    const ttnBaseUrl = `https://${ttnCluster}.cloud.thethings.network`;
    const applicationUrl = `${ttnBaseUrl}/api/v3/applications/${ttnSettings.application_id}`;

    console.log(`[${requestId}] Querying TTN API: ${applicationUrl}`);

    // Query TTN API for application details
    let ttnConnected = false;
    let ttnApplicationName: string | undefined;
    let ttnDeviceCount: number | undefined;
    let ttnError: string | undefined;

    try {
      const ttnResponse = await fetch(applicationUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${ttnSettings.api_key}`,
          "Content-Type": "application/json",
        },
      });

      if (ttnResponse.ok) {
        const appData = await ttnResponse.json();
        ttnConnected = true;
        ttnApplicationName = appData.name || appData.ids?.application_id;
        console.log(`[${requestId}] TTN connection successful - app: ${ttnApplicationName}`);

        // Try to get device count
        try {
          const devicesUrl = `${ttnBaseUrl}/api/v3/applications/${ttnSettings.application_id}/devices?field_mask=ids`;
          const devicesResponse = await fetch(devicesUrl, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${ttnSettings.api_key}`,
              "Content-Type": "application/json",
            },
          });

          if (devicesResponse.ok) {
            const devicesData = await devicesResponse.json();
            ttnDeviceCount = devicesData.end_devices?.length || 0;
            console.log(`[${requestId}] Found ${ttnDeviceCount} devices in TTN`);
          }
        } catch (deviceErr) {
          console.log(`[${requestId}] Could not fetch device count: ${deviceErr}`);
        }
      } else {
        const statusCode = ttnResponse.status;
        const errorBody = await ttnResponse.text();
        console.log(`[${requestId}] TTN API error: ${statusCode} - ${errorBody}`);

        if (statusCode === 401) {
          ttnError = "Invalid API key";
        } else if (statusCode === 403) {
          ttnError = "Insufficient permissions";
        } else if (statusCode === 404) {
          ttnError = "Application not found";
        } else {
          ttnError = `TTN error: ${statusCode}`;
        }
      }
    } catch (fetchErr) {
      console.log(`[${requestId}] TTN fetch error: ${fetchErr}`);
      ttnError = "Could not connect to TTN";
    }

    // Build snapshot response
    const snapshot: TTNSnapshot = {
      cluster: ttnCluster,
      application_id: ttnSettings.application_id,
      api_key_last4: ttnSettings.api_key.slice(-4),
      ttn_enabled: ttnSettings.enabled,
      webhook_enabled: !!ttnSettings.webhook_secret,
      updated_at: ttnSettings.updated_at,
      last_test_at: ttnSettings.last_test_at || undefined,
      last_test_success: ttnSettings.last_test_success ?? undefined,
      ttn_connected: ttnConnected,
      ttn_application_name: ttnApplicationName,
      ttn_device_count: ttnDeviceCount,
      ttn_error: ttnError,
    };

    console.log(`[${requestId}] Returning snapshot - connected: ${ttnConnected}, devices: ${ttnDeviceCount ?? 'n/a'}`);

    return new Response(
      JSON.stringify({ ok: true, snapshot }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Unexpected error:`, err);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
