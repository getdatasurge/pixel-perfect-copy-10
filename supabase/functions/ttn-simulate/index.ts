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
        JSON.stringify({ success: false, error: 'TTN_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: SimulateUplinkRequest = await req.json();
    const { applicationId, deviceId, cluster, decodedPayload, fPort } = body;

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
      let errorMessage = `TTN API error: ${response.status}`;
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage = responseText || errorMessage;
      }
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: errorMessage,
          status: response.status 
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
