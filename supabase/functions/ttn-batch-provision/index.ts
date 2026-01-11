import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { loadTTNSettings } from '../_shared/settings.ts';

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
  selected_user_id?: string;
  devices: DeviceToProvision[];
}

interface ProvisionDebug {
  cluster_used: string;
  application_id: string;
  endpoints: {
    is: string;
    js: string;
    ns: string;
    as: string;
  };
  as_verified: boolean;
  registration_steps: string[];
  correlation_ids?: string[];
}

interface ProvisionResult {
  dev_eui: string;
  ttn_device_id: string;
  status: 'created' | 'already_exists' | 'failed';
  error?: string;
  error_code?: string;
  debug?: ProvisionDebug;
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

// Extract correlation IDs from TTN response
function extractCorrelationIds(responseText: string): string[] {
  try {
    const data = JSON.parse(responseText);
    if (data?.details?.[0]?.correlation_id) {
      return [data.details[0].correlation_id];
    }
    if (data?.correlation_id) {
      return [data.correlation_id];
    }
  } catch {
    // Not JSON
  }
  return [];
}

// Verify device exists on Application Server (critical for simulate to work)
async function verifyASVisibility(
  cluster: string,
  applicationId: string,
  deviceId: string,
  apiKey: string,
  requestId: string
): Promise<{ visible: boolean; error?: string }> {
  const asCheckUrl = `https://${cluster}.cloud.thethings.network/api/v3/as/applications/${applicationId}/devices/${deviceId}`;
  
  console.log(`[${requestId}] Verifying AS visibility at: ${asCheckUrl}`);
  
  try {
    const response = await fetch(asCheckUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (response.status === 200) {
      console.log(`[${requestId}] AS verification passed - device visible on Application Server`);
      return { visible: true };
    } else if (response.status === 404) {
      console.error(`[${requestId}] AS verification FAILED - device NOT visible on Application Server`);
      return { 
        visible: false, 
        error: 'Device registered but NOT visible on Application Server. Uplinks will be dropped as "entity not found".' 
      };
    }
    console.warn(`[${requestId}] AS verification returned unexpected status: ${response.status}`);
    return { visible: false, error: `AS check returned ${response.status}` };
  } catch (err: any) {
    console.error(`[${requestId}] AS verification exception:`, err.message);
    return { visible: false, error: `AS verification failed: ${err.message}` };
  }
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
    const { org_id, selected_user_id, devices } = body;

    console.log(`[${requestId}] Processing ${devices?.length || 0} devices for org ${org_id || 'none'}, user ${selected_user_id || 'none'}`);

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

    // Load TTN settings using shared loader (user-first, org-fallback)
    let ttnSettings = null;
    let settingsSource = 'none';

    if (selected_user_id) {
      const result = await loadTTNSettings(selected_user_id, org_id);
      if (result.settings) {
        ttnSettings = result.settings;
        settingsSource = result.source || 'unknown';
      }
    } else if (org_id) {
      // Fallback to org-only if no user selected
      const { data, error } = await supabase
        .from('ttn_settings')
        .select('api_key, application_id, cluster, enabled')
        .eq('org_id', org_id)
        .maybeSingle();

      if (error) {
        console.error(`[${requestId}] Error loading TTN settings:`, error);
      } else if (data) {
        ttnSettings = data;
        settingsSource = 'org';
      }
    }

    // Get API key from settings or environment
    const apiKey = ttnSettings?.api_key || Deno.env.get('TTN_API_KEY');
    const cluster = ttnSettings?.cluster || 'eu1';
    const applicationId = ttnSettings?.application_id;

    console.log(`[${requestId}] PROVISIONING_TARGET`, {
      application_id: applicationId,
      cluster,
      settings_source: settingsSource,
      selected_user_id,
      org_id,
    });

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

    console.log(`[${requestId}] Using cluster=${cluster}, app=${applicationId}, source=${settingsSource}`);

    const results: ProvisionResult[] = [];
    const summary = { created: 0, already_exists: 0, failed: 0, total: devices.length };

    // Build common endpoints for debug output
    const baseUrl = `https://${cluster}.cloud.thethings.network/api/v3`;

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
          error_code: 'INVALID_EUI',
        });
        summary.failed++;
        continue;
      }

      const deviceId = generateTTNDeviceId(normalizedDevEui);
      const normalizedJoinEui = join_eui.toUpperCase().replace(/[:\s-]/g, '');
      const normalizedAppKey = app_key.toUpperCase().replace(/[:\s-]/g, '');
      
      console.log(`[${requestId}] Provisioning device: ${name} -> ${deviceId}, appKey: ${maskKey(app_key)}`);

      // Debug info for this device
      const debug: ProvisionDebug = {
        cluster_used: cluster,
        application_id: applicationId,
        endpoints: {
          is: `${baseUrl}/applications/${applicationId}/devices`,
          js: `${baseUrl}/js/applications/${applicationId}/devices/${deviceId}`,
          ns: `${baseUrl}/ns/applications/${applicationId}/devices/${deviceId}`,
          as: `${baseUrl}/as/applications/${applicationId}/devices/${deviceId}`,
        },
        as_verified: false,
        registration_steps: [],
      };

      // Determine frequency plan based on cluster
      const frequencyPlan = cluster === 'nam1' ? 'US_902_928_FSB_2' :
                           cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN';

      try {
        // =============================================
        // STEP 1: Register in Identity Server (IS)
        // =============================================
        const isUrl = debug.endpoints.is;
        console.log(`[${requestId}] Step 1/4: Registering in Identity Server...`);

        const isPayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: normalizedJoinEui,
            },
            name: name || deviceId,
            description: `Provisioned via Emulator at ${new Date().toISOString()}`,
            lorawan_version: 'MAC_V1_0_3',
            lorawan_phy_version: 'PHY_V1_0_3_REV_A',
            frequency_plan_id: frequencyPlan,
            supports_join: true,
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
            ],
          },
        };

        const isResponse = await fetch(isUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(isPayload),
        });

        const isResponseText = await isResponse.text();
        debug.correlation_ids = extractCorrelationIds(isResponseText);

        if (isResponse.status === 409) {
          // Device already exists - check if it's visible on AS
          console.log(`[${requestId}] Device ${deviceId} already exists in IS, checking AS visibility...`);
          debug.registration_steps.push('IS: already_exists');
          
          const asCheck = await verifyASVisibility(cluster, applicationId, deviceId, apiKey, requestId);
          debug.as_verified = asCheck.visible;
          
          if (!asCheck.visible) {
            // Device exists in IS but not visible on AS - needs re-registration on AS
            console.warn(`[${requestId}] Device exists in IS but NOT on AS - attempting AS registration`);
            
            // Try to register on AS
            const asUrl = debug.endpoints.as;
            const asPayload = {
              end_device: {
                ids: {
                  device_id: deviceId,
                  dev_eui: normalizedDevEui.toUpperCase(),
                  join_eui: normalizedJoinEui,
                },
              },
              field_mask: {
                paths: ['ids.device_id', 'ids.dev_eui', 'ids.join_eui'],
              },
            };

            const asResponse = await fetch(asUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(asPayload),
            });

            if (asResponse.ok) {
              console.log(`[${requestId}] Successfully registered existing device on AS`);
              debug.registration_steps.push('AS: registered');
              debug.as_verified = true;
            } else {
              console.error(`[${requestId}] Failed to register existing device on AS: ${asResponse.status}`);
              debug.registration_steps.push(`AS: failed (${asResponse.status})`);
            }
          }
          
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'already_exists',
            debug,
          });
          summary.already_exists++;
          continue;
        }

        if (!isResponse.ok) {
          let errorMessage = `Identity Server error: ${isResponse.status}`;
          try {
            const errorData = JSON.parse(isResponseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            }
            if (isResponse.status === 403) {
              errorMessage = 'API key lacks permission to register devices';
            } else if (isResponse.status === 404) {
              errorMessage = `Application "${applicationId}" not found`;
            }
          } catch {
            // Use raw response
          }
          
          console.error(`[${requestId}] IS error for ${deviceId}: ${errorMessage}`);
          debug.registration_steps.push(`IS: failed (${isResponse.status})`);
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'failed',
            error: errorMessage,
            error_code: 'IS_REGISTRATION_FAILED',
            debug,
          });
          summary.failed++;
          continue;
        }

        console.log(`[${requestId}] IS registration successful`);
        debug.registration_steps.push('IS: created');

        // =============================================
        // STEP 2: Register in Join Server (JS)
        // =============================================
        const jsUrl = debug.endpoints.js;
        console.log(`[${requestId}] Step 2/4: Registering in Join Server...`);
        
        const jsPayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: normalizedJoinEui,
            },
            network_server_address: `${cluster}.cloud.thethings.network`,
            application_server_address: `${cluster}.cloud.thethings.network`,
            root_keys: {
              app_key: {
                key: normalizedAppKey,
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

        const jsResponse = await fetch(jsUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jsPayload),
        });

        if (!jsResponse.ok) {
          const jsText = await jsResponse.text();
          console.warn(`[${requestId}] JS warning for ${deviceId}: ${jsResponse.status} - ${jsText}`);
          debug.registration_steps.push(`JS: warning (${jsResponse.status})`);
          // Continue - JS errors are often recoverable
        } else {
          console.log(`[${requestId}] JS registration successful`);
          debug.registration_steps.push('JS: created');
        }

        // =============================================
        // STEP 3: Register in Network Server (NS)
        // =============================================
        const nsUrl = debug.endpoints.ns;
        console.log(`[${requestId}] Step 3/4: Registering in Network Server...`);

        const nsPayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: normalizedJoinEui,
            },
            frequency_plan_id: frequencyPlan,
            lorawan_version: 'MAC_V1_0_3',
            lorawan_phy_version: 'PHY_V1_0_3_REV_A',
            supports_join: true,
          },
          field_mask: {
            paths: [
              'ids.device_id',
              'ids.dev_eui',
              'ids.join_eui',
              'frequency_plan_id',
              'lorawan_version',
              'lorawan_phy_version',
              'supports_join',
            ],
          },
        };

        const nsResponse = await fetch(nsUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(nsPayload),
        });

        if (!nsResponse.ok) {
          const nsText = await nsResponse.text();
          console.warn(`[${requestId}] NS warning for ${deviceId}: ${nsResponse.status} - ${nsText}`);
          debug.registration_steps.push(`NS: warning (${nsResponse.status})`);
          // Continue - we'll verify AS visibility as the true test
        } else {
          console.log(`[${requestId}] NS registration successful`);
          debug.registration_steps.push('NS: created');
        }

        // =============================================
        // STEP 4: Register in Application Server (AS)
        // =============================================
        const asUrl = debug.endpoints.as;
        console.log(`[${requestId}] Step 4/4: Registering in Application Server...`);

        const asPayload = {
          end_device: {
            ids: {
              device_id: deviceId,
              dev_eui: normalizedDevEui.toUpperCase(),
              join_eui: normalizedJoinEui,
            },
          },
          field_mask: {
            paths: [
              'ids.device_id',
              'ids.dev_eui',
              'ids.join_eui',
            ],
          },
        };

        const asResponse = await fetch(asUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(asPayload),
        });

        if (!asResponse.ok) {
          const asText = await asResponse.text();
          console.error(`[${requestId}] AS error for ${deviceId}: ${asResponse.status} - ${asText}`);
          debug.registration_steps.push(`AS: failed (${asResponse.status})`);
          
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'failed',
            error: 'Device registered in IS but failed to register on Application Server. Uplinks will be dropped.',
            error_code: 'AS_REGISTRATION_FAILED',
            debug,
          });
          summary.failed++;
          continue;
        }

        console.log(`[${requestId}] AS registration successful`);
        debug.registration_steps.push('AS: created');

        // =============================================
        // STEP 5: Verify AS Visibility (the true test)
        // =============================================
        console.log(`[${requestId}] Verifying device is visible on AS...`);
        
        const asVerification = await verifyASVisibility(cluster, applicationId, deviceId, apiKey, requestId);
        debug.as_verified = asVerification.visible;

        if (!asVerification.visible) {
          console.error(`[${requestId}] AS verification FAILED for ${deviceId}: ${asVerification.error}`);
          debug.registration_steps.push('AS_VERIFY: failed');
          
          results.push({
            dev_eui,
            ttn_device_id: deviceId,
            status: 'failed',
            error: asVerification.error || 'Device not visible on Application Server after registration',
            error_code: 'AS_NOT_VISIBLE',
            debug,
          });
          summary.failed++;
          continue;
        }

        debug.registration_steps.push('AS_VERIFY: passed');
        console.log(`[${requestId}] Device ${deviceId} fully registered and verified on AS ✓`);
        
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
          debug,
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
          error_code: 'NETWORK_ERROR',
          debug: {
            cluster_used: cluster,
            application_id: applicationId,
            endpoints: {
              is: `${baseUrl}/applications/${applicationId}/devices`,
              js: `${baseUrl}/js/applications/${applicationId}/devices/${deviceId}`,
              ns: `${baseUrl}/ns/applications/${applicationId}/devices/${deviceId}`,
              as: `${baseUrl}/as/applications/${applicationId}/devices/${deviceId}`,
            },
            as_verified: false,
            registration_steps: ['exception'],
          },
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
        debug: {
          cluster_used: cluster,
          application_id: applicationId,
          settings_source: settingsSource,
        },
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
