import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SimulateUplinkRequest {
  applicationId: string;
  deviceId: string;
  cluster: string;
  decodedPayload: Record<string, unknown>;
  fPort: number;
}

// Parse common TTN error codes and provide user-friendly messages
function parseTTNError(status: number, responseText: string, applicationId: string, deviceId: string): string {
  try {
    const errorData = JSON.parse(responseText);
    const errorName = errorData?.details?.[0]?.name || '';
    
    if (status === 403 || errorName === 'no_application_rights') {
      return `API key doesn't have rights for application "${applicationId}". Verify: 1) Application ID matches exactly what's in TTN Console, 2) API key was created with "Write downlink application traffic" permission for this specific application.`;
    }
    if (status === 404 || errorName === 'end_device_not_found') {
      return `Device "${deviceId}" not found in TTN application "${applicationId}". Register the device in TTN Console first with matching DevEUI.`;
    }
    if (status === 401) {
      return `Invalid or expired TTN API key. Generate a new key in TTN Console → API Keys.`;
    }
    
    return errorData.message || errorData.error || `TTN API error (${status})`;
  } catch {
    return responseText || `TTN API error (${status})`;
  }
}

// Validate TTN configuration before making API call
function validateConfig(applicationId: string, deviceId: string, cluster: string): string | null {
  if (!applicationId || applicationId.trim() === '') {
    return 'Application ID is required. Find it in TTN Console → Applications.';
  }
  if (!deviceId || deviceId.trim() === '') {
    return 'Device ID is required.';
  }
  if (!/^eui-[a-f0-9]{16}$/i.test(deviceId)) {
    return `Device ID "${deviceId}" has invalid format. Expected format: eui-XXXXXXXXXXXXXXXX (16 hex characters).`;
  }
  if (!cluster || cluster.trim() === '') {
    return 'TTN cluster is required.';
  }
  const validClusters = ['nam1', 'eu1', 'au1'];
  if (!validClusters.includes(cluster)) {
    return `Invalid cluster "${cluster}". Must be one of: ${validClusters.join(', ')}.`;
  }
  return null;
}

serve(async (req) => {
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
          error: 'TTN_API_KEY not configured. Add your TTN API key in project secrets.',
          errorType: 'missing_api_key'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: SimulateUplinkRequest = await req.json();
    const { applicationId, deviceId, cluster, decodedPayload, fPort } = body;

    // Validate configuration before calling TTN
    const validationError = validateConfig(applicationId, deviceId, cluster);
    if (validationError) {
      console.error('Validation error:', validationError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: validationError,
          errorType: 'validation_error'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Simulating uplink:', { applicationId, deviceId, cluster, fPort });

    // Build the TTN Simulate Uplink API URL
    // Format: https://{cluster}.cloud.thethings.network/api/v3/as/applications/{app_id}/devices/{device_id}/up/simulate
    const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/as/applications/${applicationId}/devices/${deviceId}/up/simulate`;

    console.log('Calling TTN API:', ttnUrl);

    // Build the simulate uplink payload
    // TTN expects the payload in a specific format for simulating uplinks
    const simulatePayload = {
      downlinks: [],
      uplink_message: {
        f_port: fPort,
        decoded_payload: decodedPayload,
        // Optional: Add simulated metadata
        rx_metadata: [
          {
            gateway_ids: {
              gateway_id: "simulated-gateway",
            },
            rssi: decodedPayload.signal_strength ?? -70,
            snr: 7.5,
          }
        ],
        settings: {
          data_rate: {
            lora: {
              bandwidth: 125000,
              spreading_factor: 7,
            }
          },
          frequency: "868100000",
        },
      }
    };

    const response = await fetch(ttnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ttnApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(simulatePayload),
    });

    const responseText = await response.text();
    console.log('TTN API response status:', response.status);
    console.log('TTN API response:', responseText);

    if (!response.ok) {
      const errorMessage = parseTTNError(response.status, responseText, applicationId, deviceId);
      
      // Determine error type for frontend handling
      let errorType = 'ttn_error';
      if (response.status === 403) errorType = 'permission_error';
      else if (response.status === 404) errorType = 'device_not_found';
      else if (response.status === 401) errorType = 'auth_error';
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: errorMessage,
          errorType,
          status: response.status,
          applicationId,
          deviceId
        }),
        { 
          status: response.status >= 400 && response.status < 500 ? response.status : 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // TTN simulate endpoint returns empty response on success
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Uplink simulated successfully',
        ttnResponse: responseText || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in ttn-simulate function:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
