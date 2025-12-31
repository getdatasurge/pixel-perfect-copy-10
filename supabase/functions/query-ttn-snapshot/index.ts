import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryRequest {
  user_id: string; // source_user_id from synced_users
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
  // Live TTN data
  ttn_application_name?: string;
  ttn_device_count?: number;
  ttn_connected: boolean;
  ttn_error?: string;
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

    console.log(`[${requestId}] Querying TTN snapshot for user: ${user_id}, org: ${org_id || 'auto'}`);

    // Get FrostGuard connection details
    const frostguardUrl = Deno.env.get("FROSTGUARD_SUPABASE_URL");
    const sharedSecret = Deno.env.get("FROSTGUARD_SYNC_SHARED_SECRET");

    if (!frostguardUrl || !sharedSecret) {
      console.error(`[${requestId}] FrostGuard connection not configured`);
      return new Response(
        JSON.stringify({ ok: false, error: "FrostGuard connection not configured", code: "CONFIG_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call FrostGuard to get this user's TTN settings
    const snapshotUrl = `${frostguardUrl}/functions/v1/get-ttn-integration-snapshot`;
    console.log(`[${requestId}] Fetching user TTN settings from FrostGuard: ${snapshotUrl}`);

    const frostguardResponse = await fetch(snapshotUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-shared-secret": sharedSecret,
      },
      body: JSON.stringify({
        user_id,
        org_id,
        site_id,
      }),
    });

    if (!frostguardResponse.ok) {
      const status = frostguardResponse.status;
      const errorText = await frostguardResponse.text();
      console.log(`[${requestId}] FrostGuard error: ${status} - ${errorText}`);

      if (status === 404) {
        return new Response(
          JSON.stringify({ ok: false, error: "No TTN settings found for this user", code: "NOT_FOUND" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 401 || status === 403) {
        return new Response(
          JSON.stringify({ ok: false, error: "Access denied to FrostGuard", code: "UNAUTHORIZED" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: false, error: "Failed to fetch user TTN settings", code: "UPSTREAM_ERROR" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const frostguardData = await frostguardResponse.json();
    
    if (!frostguardData.ok || !frostguardData.settings) {
      console.log(`[${requestId}] FrostGuard returned no settings:`, frostguardData);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: frostguardData.error || "No TTN settings found", 
          code: frostguardData.code || "NOT_FOUND" 
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const settings = frostguardData.settings;
    console.log(`[${requestId}] Got user TTN settings - cluster: ${settings.cluster}, app: ${settings.application_id}`);

    // Now query TTN directly with these credentials
    const ttnCluster = settings.cluster || "nam1";
    const ttnBaseUrl = `https://${ttnCluster}.cloud.thethings.network`;
    const applicationUrl = `${ttnBaseUrl}/api/v3/applications/${settings.application_id}`;

    let ttnConnected = false;
    let ttnApplicationName: string | undefined;
    let ttnDeviceCount: number | undefined;
    let ttnError: string | undefined;

    // Only query TTN if we have an API key
    if (settings.api_key) {
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

          // Try to get device count
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
    } else {
      console.log(`[${requestId}] No API key available - skipping TTN verification`);
      ttnError = "No API key configured";
    }

    // Build snapshot response
    const snapshot: TTNSnapshot = {
      cluster: ttnCluster,
      application_id: settings.application_id,
      api_key_last4: settings.api_key_last4 || (settings.api_key ? settings.api_key.slice(-4) : "????"),
      ttn_enabled: settings.enabled ?? true,
      webhook_enabled: !!settings.webhook_secret || !!settings.webhook_enabled,
      updated_at: settings.updated_at || new Date().toISOString(),
      last_test_at: settings.last_test_at,
      last_test_success: settings.last_test_success,
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
