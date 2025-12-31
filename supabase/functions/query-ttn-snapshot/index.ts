import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryRequest {
  user_id: string;
  org_id?: string;
  site_id?: string;
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
  site_id: string | null;
}

serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] query-ttn-snapshot invoked`);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, org_id, site_id } = (await req.json()) as QueryRequest;

    if (!user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "user_id is required", code: "MISSING_USER_ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] Querying TTN snapshot for user: ${user_id}, org: ${org_id || 'auto'}, site: ${site_id || 'none'}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let settings: TTNSettingsRow | null = null;
    let settingsSource = 'unknown';

    // Step 1: Try to load SITE-SPECIFIC settings first if site_id provided
    if (org_id && site_id) {
      console.log(`[${requestId}] Checking for site-specific TTN settings...`);
      const { data: siteSettings, error: siteErr } = await supabase
        .from("ttn_settings")
        .select("cluster, application_id, api_key, enabled, webhook_secret, updated_at, last_test_at, last_test_success, site_id")
        .eq("org_id", org_id)
        .eq("site_id", site_id)
        .maybeSingle();

      if (!siteErr && siteSettings && siteSettings.api_key) {
        settings = siteSettings as TTNSettingsRow;
        settingsSource = 'site';
        console.log(`[${requestId}] Using site-specific settings: app=${settings.application_id}`);
      }
    }

    // Step 2: Fall back to ORG-LEVEL settings if no site-specific found
    if (!settings && org_id) {
      console.log(`[${requestId}] Loading org-level TTN settings for org: ${org_id}`);
      const { data: orgSettings, error: orgErr } = await supabase
        .from("ttn_settings")
        .select("cluster, application_id, api_key, enabled, webhook_secret, updated_at, last_test_at, last_test_success, site_id")
        .eq("org_id", org_id)
        .is("site_id", null)
        .maybeSingle();

      if (!orgErr && orgSettings && orgSettings.api_key) {
        settings = orgSettings as TTNSettingsRow;
        settingsSource = 'org';
        console.log(`[${requestId}] Using org-level settings: app=${settings.application_id}`);
      }
    }

    // No settings found anywhere
    if (!settings || !settings.application_id || !settings.api_key) {
      console.log(`[${requestId}] No TTN settings found for user/org`);
      return new Response(
        JSON.stringify({ ok: false, error: "No TTN settings found. Configure in Webhook tab.", code: "NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Query TTN directly with the settings
    const ttnCluster = settings.cluster || "nam1";
    const ttnBaseUrl = `https://${ttnCluster}.cloud.thethings.network`;
    const applicationUrl = `${ttnBaseUrl}/api/v3/applications/${settings.application_id}`;

    let ttnConnected = false;
    let ttnApplicationName: string | undefined;
    let ttnDeviceCount: number | undefined;
    let ttnError: string | undefined;

    console.log(`[${requestId}] Querying TTN API: ${applicationUrl}`);

    try {
      const ttnResponse = await fetch(applicationUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${settings.api_key}`,
          "Content-Type": "application/json",
        },
      });

      if (ttnResponse.ok) {
        const appData = await ttnResponse.json();
        ttnConnected = true;
        ttnApplicationName = appData.name || appData.ids?.application_id;
        console.log(`[${requestId}] TTN connection successful - app: ${ttnApplicationName}`);

        // Get device count
        try {
          const devicesUrl = `${ttnBaseUrl}/api/v3/applications/${settings.application_id}/devices?field_mask=ids`;
          const devicesResponse = await fetch(devicesUrl, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${settings.api_key}`,
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
        console.log(`[${requestId}] TTN API error: ${statusCode}`);

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
      application_id: settings.application_id,
      api_key_last4: settings.api_key.slice(-4),
      ttn_enabled: settings.enabled,
      webhook_enabled: !!settings.webhook_secret,
      updated_at: settings.updated_at,
      last_test_at: settings.last_test_at || undefined,
      last_test_success: settings.last_test_success ?? undefined,
      ttn_connected: ttnConnected,
      ttn_application_name: ttnApplicationName,
      ttn_device_count: ttnDeviceCount,
      ttn_error: ttnError,
    };

    console.log(`[${requestId}] Returning snapshot from ${settingsSource} - app: ${settings.application_id}, connected: ${ttnConnected}, devices: ${ttnDeviceCount ?? 'n/a'}`);

    return new Response(
      JSON.stringify({ ok: true, snapshot, source: settingsSource }),
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
