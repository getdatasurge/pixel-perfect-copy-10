const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegisterDeviceRequest {
  applicationId: string;
  cluster: string;
  devEui: string;
  joinEui: string;
  appKey: string;
  deviceName: string;
}

// Normalize DevEUI: strip colons/spaces/dashes, lowercase, validate 16 hex chars
function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// Generate canonical TTN device_id from DevEUI
// Format: sensor-{normalized_deveui}
function generateTTNDeviceId(normalizedDevEui: string): string {
  return `sensor-${normalizedDevEui}`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ttnApiKey = Deno.env.get('TTN_API_KEY');
    
    if (!ttnApiKey) {
      console.error('TTN_API_KEY not configured');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'TTN API key not configured. Add TTN_API_KEY to project secrets.' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RegisterDeviceRequest = await req.json();
    const { applicationId, cluster, devEui, joinEui, appKey, deviceName } = body;

    console.log('Registering device in TTN:', { applicationId, cluster, devEui, deviceName });

    // Validate required fields
    if (!applicationId || !cluster || !devEui || !joinEui || !appKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: applicationId, cluster, devEui, joinEui, appKey' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize and validate DevEUI
    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid DevEUI format. Must be 16 hex characters (e.g., 0F8FE95CABA665D4).' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate canonical TTN device_id: sensor-{normalized_deveui}
    const deviceId = generateTTNDeviceId(normalizedDevEui);
    console.log('Using canonical device_id:', deviceId);

    // Build TTN Device Registry API URL
    const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/applications/${applicationId}/devices`;

    // Build the device registration payload for OTAA
    const devicePayload = {
      end_device: {
        ids: {
          device_id: deviceId,
          dev_eui: normalizedDevEui.toUpperCase(),
          join_eui: joinEui.toUpperCase().replace(/[:\s-]/g, ''),
        },
        name: deviceName || deviceId,
        description: `Registered via FrostGuard Emulator at ${new Date().toISOString()}`,
        lorawan_version: "MAC_V1_0_3",
        lorawan_phy_version: "PHY_V1_0_3_REV_A",
        frequency_plan_id: cluster === 'nam1' ? 'US_902_928_FSB_2' : 
                          cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN',
        supports_join: true,
        root_keys: {
          app_key: {
            key: appKey.toUpperCase().replace(/[:\s-]/g, ''),
          },
        },
      },
      field_mask: {
        paths: [
          "ids.device_id",
          "ids.dev_eui",
          "ids.join_eui",
          "name",
          "description",
          "lorawan_version",
          "lorawan_phy_version",
          "frequency_plan_id",
          "supports_join",
          "root_keys.app_key.key",
        ],
      },
    };

    console.log('Calling TTN Device Registry API:', ttnUrl);

    // Register in Identity Server
    const response = await fetch(ttnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ttnApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(devicePayload),
    });

    const responseText = await response.text();
    console.log('TTN API response:', response.status, responseText);

    if (!response.ok) {
      let errorMessage = `TTN API error: ${response.status}`;
      
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.message) {
          errorMessage = errorData.message;
        }
        if (errorData.details) {
          console.error('TTN error details:', errorData.details);
        }
        
        // Handle specific error cases
        if (response.status === 409) {
          errorMessage = `Device ${deviceId} already exists in TTN application`;
        } else if (response.status === 403) {
          errorMessage = 'API key lacks permission to register devices. Ensure it has "Write to Application" rights.';
        } else if (response.status === 404) {
          errorMessage = `Application "${applicationId}" not found. Check application ID and cluster.`;
        }
      } catch {
        // Use raw response if not JSON
        errorMessage = responseText || errorMessage;
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: errorMessage,
          status: response.status,
          deviceId,
          ttnDeviceId: deviceId,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also register in Join Server for OTAA
    const joinServerUrl = `https://${cluster}.cloud.thethings.network/api/v3/js/applications/${applicationId}/devices/${deviceId}`;
    
    const joinServerPayload = {
      end_device: {
        ids: {
          device_id: deviceId,
          dev_eui: normalizedDevEui.toUpperCase(),
          join_eui: joinEui.toUpperCase().replace(/[:\s-]/g, ''),
        },
        network_server_address: `${cluster}.cloud.thethings.network`,
        application_server_address: `${cluster}.cloud.thethings.network`,
        root_keys: {
          app_key: {
            key: appKey.toUpperCase().replace(/[:\s-]/g, ''),
          },
        },
      },
      field_mask: {
        paths: [
          "ids.device_id",
          "ids.dev_eui",
          "ids.join_eui",
          "network_server_address",
          "application_server_address",
          "root_keys.app_key.key",
        ],
      },
    };

    const jsResponse = await fetch(joinServerUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ttnApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(joinServerPayload),
    });

    if (!jsResponse.ok) {
      console.warn('Join Server registration warning:', jsResponse.status, await jsResponse.text());
      // Continue anyway - device is registered in Identity Server
    }

    console.log('Device registered successfully:', deviceId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        deviceId,
        ttnDeviceId: deviceId,
        devEui: normalizedDevEui.toUpperCase(),
        message: `Device ${deviceId} registered in TTN application ${applicationId}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unexpected error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
