import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeviceToProvision {
  dev_eui: string;
  join_eui: string;
  app_key: string;
  name: string;
}

interface BatchProvisionRequest {
  org_id?: string;
  devices: DeviceToProvision[];
}

interface ProvisionResult {
  dev_eui: string;
  ttn_device_id: string;
  status: 'created' | 'already_exists' | 'failed';
  error?: string;
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
function generateTTNDeviceId(normalizedDevEui: string): string {
  return `sensor-${normalizedDevEui}`;
}

// Mask sensitive data for logging
function maskKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[${requestId}] Batch provision request received`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: BatchProvisionRequest = await req.json();
    const { org_id, devices } = body;

    console.log(`[${requestId}] Processing ${devices?.length || 0} devices for org ${org_id || 'none'}`);

    if (!devices || devices.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          requestId,
          error: 'No devices provided for provisioning',
          results: [],
          summary: { created: 0, already_exists: 0, failed: 0, total: 0 },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load TTN settings from database
    let ttnSettings: any = null;
    if (org_id) {
      const { data, error } = await supabase
        .from('ttn_settings')
        .select('*')
        .eq('org_id', org_id)
        .maybeSingle();

      if (error) {
        console.error(`[${requestId}] Error loading TTN settings:`, error);
      } else {
        ttnSettings = data;
      }
    }

    // Get API key from settings or environment
    const apiKey = ttnSettings?.api_key || Deno.env.get('TTN_API_KEY');
    const cluster = ttnSettings?.cluster || 'eu1';
    const applicationId = ttnSettings?.application_id;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          requestId,
          error: 'TTN API key not configured. Configure TTN settings first.',
          results: [],
          summary: { created: 0, already_exists: 0, failed: 0, total: 0 },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!applicationId) {
      return new Response(
        JSON.stringify({
          ok: false,
          requestId,
          error: 'TTN Application ID not configured. Configure TTN settings first.',
          results: [],
          summary: { created: 0, already_exists: 0, failed: 0, total: 0 },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] Using cluster=${cluster}, app=${applicationId}`);

    const results: ProvisionResult[] = [];
    const summary = { created: 0, already_exists: 0, failed: 0, total: devices.length };

    // Process each device
    for (const device of devices) {
      const { dev_eui, join_eui, app_key, name } = device;

      // Validate and normalize DevEUI
      const normalizedDevEui = normalizeDevEui(dev_eui);
      if (!normalizedDevEui) {
        console.error(`[${requestId}] Invalid DevEUI: ${dev_eui}`);
        results.push({
          dev_eui,
          ttn_device_id: 'invalid',
          status: 'failed',
          error: 'Invalid DevEUI format. Must be 16 hex characters.',
        });
        summary.failed++;
        continue;
      }

      const deviceId = generateTTNDeviceId(normalizedDevEui);
      console.log(`[${requestId}] Provisioning device: ${name} -> ${deviceId}, appKey: ${maskKey(app_key)}`);

      try {
        // Build TTN Device Registry API URL
        const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/applications/${applicationId}/devices`;

        // Determine frequency plan based on cluster
        const frequencyPlan = cluster === 'nam1' ? 'US_902_928_FSB_2' :
                             cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN';

        // Build the device registration payload for OTAA
        const devicePayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: join_eui.toUpperCase().replace(/[:\s-]/g, ''),
            },
            name: name || deviceId,
            description: `Provisioned via Emulator at ${new Date().toISOString()}`,
            lorawan_version: 'MAC_V1_0_3',
            lorawan_phy_version: 'PHY_V1_0_3_REV_A',
            frequency_plan_id: frequencyPlan,
            supports_join: true,
            root_keys: {
              app_key: {
                key: app_key.toUpperCase().replace(/[:\s-]/g, ''),
              },
            },
          },
          field_mask: {
            paths: [
              'ids.device_id',
              'ids.dev_eui',
              'ids.join_eui',
              'name',
              'description',
              'lorawan_version',
              'lorawan_phy_version',
              'frequency_plan_id',
              'supports_join',
              'root_keys.app_key.key',
            ],
          },
        };

        // Register in Identity Server
        const response = await fetch(ttnUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(devicePayload),
        });

        const responseText = await response.text();

        if (response.status === 409) {
          // Device already exists - treat as success
          console.log(`[${requestId}] Device ${deviceId} already exists`);
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'already_exists',
          });
          summary.already_exists++;
          continue;
        }

        if (!response.ok) {
          let errorMessage = `TTN API error: ${response.status}`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            }
            if (response.status === 403) {
              errorMessage = 'API key lacks permission to register devices';
            } else if (response.status === 404) {
              errorMessage = `Application "${applicationId}" not found`;
            }
          } catch {
            // Use raw response
          }
          
          console.error(`[${requestId}] TTN error for ${deviceId}: ${errorMessage}`);
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'failed',
            error: errorMessage,
          });
          summary.failed++;
          continue;
        }

        // Also register in Join Server for OTAA
        const joinServerUrl = `https://${cluster}.cloud.thethings.network/api/v3/js/applications/${applicationId}/devices/${deviceId}`;
        
        const joinServerPayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: join_eui.toUpperCase().replace(/[:\s-]/g, ''),
            },
            network_server_address: `${cluster}.cloud.thethings.network`,
            application_server_address: `${cluster}.cloud.thethings.network`,
            root_keys: {
              app_key: {
                key: app_key.toUpperCase().replace(/[:\s-]/g, ''),
              },
            },
          },
          field_mask: {
            paths: [
              'ids.device_id',
              'ids.dev_eui',
              'ids.join_eui',
              'network_server_address',
              'application_server_address',
              'root_keys.app_key.key',
            ],
          },
        };

        const jsResponse = await fetch(joinServerUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(joinServerPayload),
        });

        if (!jsResponse.ok) {
          console.warn(`[${requestId}] Join Server warning for ${deviceId}: ${jsResponse.status}`);
          // Continue anyway - device is registered in Identity Server
        }

        console.log(`[${requestId}] Device ${deviceId} registered successfully`);
        
        // Update sensor status in database to 'active' (provisioned)
        if (org_id) {
          const { error: updateError } = await supabase
            .from('lora_sensors')
            .update({ 
              status: 'active',
              ttn_device_id: deviceId,
              updated_at: new Date().toISOString(),
            })
            .eq('dev_eui', dev_eui.toUpperCase().replace(/[:\s-]/g, ''))
            .eq('org_id', org_id);
          
          if (updateError) {
            console.warn(`[${requestId}] Could not update sensor status for ${deviceId}: ${updateError.message}`);
          } else {
            console.log(`[${requestId}] Updated sensor status to 'active' for ${deviceId}`);
          }
        }
        
        results.push({
          dev_eui,
          ttn_device_id: deviceId,
          status: 'created',
        });
        summary.created++;

      } catch (err: any) {
        console.error(`[${requestId}] Error provisioning ${deviceId}:`, err.message);
        
        // Update sensor status to 'pending' with error info
        if (org_id) {
          await supabase
            .from('lora_sensors')
            .update({ 
              status: 'pending', // Keep pending on failure
              updated_at: new Date().toISOString(),
            })
            .eq('dev_eui', dev_eui.toUpperCase().replace(/[:\s-]/g, ''))
            .eq('org_id', org_id);
        }
        
        results.push({
          dev_eui,
          ttn_device_id: deviceId,
          status: 'failed',
          error: err.message || 'Unknown error',
        });
        summary.failed++;
      }
    }

    console.log(`[${requestId}] Batch complete: ${summary.created} created, ${summary.already_exists} existed, ${summary.failed} failed`);

    return new Response(
      JSON.stringify({
        ok: summary.failed === 0,
        requestId,
        results,
        summary,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error(`[${requestId}] Unexpected error:`, err.message);
    return new Response(
      JSON.stringify({
        ok: false,
        requestId,
        error: err.message || 'Unknown error',
        results: [],
        summary: { created: 0, already_exists: 0, failed: 0, total: 0 },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
