import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SimulateUplinkRequest {
  org_id?: string;
  selected_user_id?: string;
  applicationId?: string;
  deviceId: string;
  devEui?: string;
  cluster?: string;
  decodedPayload: Record<string, unknown>;
  fPort: number;
  gatewayId?: string;
  gatewayEui?: string;
  signalStrength?: number;
}

interface TTNSettings {
  api_key: string | null;
  application_id: string | null;
  cluster: string;
  enabled: boolean;
}

type TtnPayload = {
  api_key?: string;
  application_id?: string;
  cluster?: string;
  enabled?: boolean;
};

function isTtnPayload(value: unknown): value is TtnPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const stringKeys = ['api_key', 'application_id', 'cluster'] as const;

  for (const key of stringKeys) {
    if (key in payload && payload[key] != null && typeof payload[key] !== 'string') {
      return false;
    }
  }

  if ('enabled' in payload && payload.enabled != null && typeof payload.enabled !== 'boolean') {
    return false;
  }

  return true;
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
function generateTTNDeviceId(devEui: string): string | null {
  const normalized = normalizeDevEui(devEui);
  if (!normalized) return null;
  return `sensor-${normalized}`;
}

// Parse common TTN error codes and provide user-friendly messages
function parseTTNError(status: number, responseText: string, applicationId: string, deviceId: string, cluster?: string): {
  message: string;
  errorType: string;
  requiredRights?: string[];
  hint?: string;
  correlation_id?: string;
} {
  try {
    const errorData = JSON.parse(responseText);
    const errorName = errorData?.details?.[0]?.name || '';
    const errorMessage = errorData?.message || '';
    const correlationId = errorData?.details?.[0]?.correlation_id || errorData?.correlation_id || undefined;

    // Detect AS-specific "not found" errors (device registered but not on AS)
    if (
      errorMessage.includes('not_found') ||
      errorMessage.includes('pkg/redis') ||
      errorMessage.includes('as.up.data.drop') ||
      errorName === 'end_device_not_found'
    ) {
      return {
        message: `Device "${deviceId}" not visible on Application Server. The device may be registered in Identity Server but not on AS.`,
        errorType: 'as_not_visible',
        hint: `Device exists in TTN registry but was NOT registered on the Application Server. Re-provision the device using the Provisioning Wizard to register it on all required servers (IS, JS, NS, AS).`,
        correlation_id: correlationId,
      };
    }

    if (status === 403) {
      // Check for specific permission errors
      if (errorMessage.includes('downlink') || errorName === 'no_application_rights') {
        return {
          message: `API key doesn't have required permissions for application "${applicationId}".`,
          errorType: 'permission_error',
          requiredRights: [
            'Write downlink application traffic (traffic:down:write)',
            'Read application traffic (traffic:read)',
          ],
          hint: 'Go to TTN Console → Applications → [Your App] → API Keys → Edit your key, then add "Write downlink application traffic" permission.',
          correlation_id: correlationId,
        };
      }
      // Generic 403 - most likely missing application-specific permissions
      return {
        message: `API key doesn't have rights for application "${applicationId}".`,
        errorType: 'permission_error',
        requiredRights: [
          'Read application traffic (traffic:read)',
          'Write downlink application traffic (traffic:down:write)',
        ],
        hint: 'Your API key needs permissions for this specific application. In TTN Console, edit the API key and ensure it has access to this application with "Read application traffic" and "Write downlink application traffic" permissions.',
        correlation_id: correlationId,
      };
    }
    
    if (status === 404 || errorName === 'end_device_not_found' || errorMessage.includes('entity not found')) {
      return {
        message: `Device "${deviceId}" not found in TTN application "${applicationId}". TTN will drop uplinks as "entity not found".`,
        errorType: 'device_not_found',
        hint: `Register the device in TTN Console with device_id: ${deviceId}. Use the "Provision to TTN" button in the Devices tab to register it properly on all servers.`,
        correlation_id: correlationId,
      };
    }
    
    if (status === 401) {
      return {
        message: 'Invalid or expired TTN API key.',
        errorType: 'auth_error',
        hint: 'Generate a new key in TTN Console → API Keys.',
        correlation_id: correlationId,
      };
    }
    
    return {
      message: errorData.message || errorData.error || `TTN API error (${status})`,
      errorType: 'ttn_error',
      correlation_id: correlationId,
    };
  } catch {
    return {
      message: responseText || `TTN API error (${status})`,
      errorType: 'ttn_error',
    };
  }
}

// Resolve temperature from decoded payload, checking canonical + Dragino field names.
// Returns °C value or undefined if no temperature field is present.
function resolveTemperature(payload: Record<string, unknown>): number | undefined {
  for (const key of ['temperature', 'TempC_SHT', 'TempC_DS', 'ext_temperature', 'soil_temperature']) {
    if (typeof payload[key] === 'number') return payload[key] as number;
  }
  return undefined;
}

// Resolve door status from decoded payload, checking canonical + Dragino field names.
// Returns 'open' | 'closed' or undefined if no door field is present.
function resolveDoorStatus(payload: Record<string, unknown>): string | undefined {
  // String status fields
  if (typeof payload.door_status === 'string') return payload.door_status;
  if (typeof payload.DOOR_OPEN_STATUS === 'string') return payload.DOOR_OPEN_STATUS;
  // Boolean fields
  if (typeof payload.door_open === 'boolean') return payload.door_open ? 'open' : 'closed';
  if (typeof payload.door === 'boolean') return payload.door ? 'open' : 'closed';
  if (typeof payload.contact === 'boolean') return payload.contact ? 'open' : 'closed';
  return undefined;
}

// Validate TTN configuration before making API call
function validateConfig(applicationId: string, deviceId: string, cluster: string): string | null {
  if (!applicationId || applicationId.trim() === '') {
    return 'Application ID is required. Find it in TTN Console → Applications.';
  }
  if (!deviceId || deviceId.trim() === '') {
    return 'Device ID is required.';
  }
  // Accept canonical format: sensor-{16 hex chars}
  if (!/^sensor-[a-f0-9]{16}$/i.test(deviceId)) {
    return `Device ID "${deviceId}" has invalid format. Expected format: sensor-XXXXXXXXXXXXXXXX (16 hex characters). Example: sensor-0f8fe95caba665d4`;
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

// Load TTN settings from synced_users table for a user
async function loadUserSettings(userId: string): Promise<TTNSettings | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials');
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('synced_users')
      .select('ttn')
      .eq('source_user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error loading user TTN settings:', error);
      return null;
    }

    if (!data || !data.ttn) {
      console.log(`No TTN settings found for user ${userId}`);
      return null;
    }

    const ttn = data.ttn;
    if (!isTtnPayload(ttn)) {
      console.warn(`Invalid TTN settings payload for user ${userId}`);
      return null;
    }

    if (!ttn.enabled) {
      console.log(`TTN not enabled for user ${userId}`);
      return null;
    }

    // Map synced_users.ttn structure to TTNSettings interface
    return {
      api_key: ttn.api_key ?? null,
      application_id: ttn.application_id ?? null,
      cluster: ttn.cluster || 'nam1',
      enabled: ttn.enabled ?? false,
    };
  } catch (err) {
    console.error('Exception loading user settings:', err);
    return null;
  }
}

// Load TTN settings from database for an organization
async function loadOrgSettings(orgId: string): Promise<TTNSettings | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials');
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('ttn_settings')
      .select('api_key, application_id, cluster, enabled')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('Error loading org TTN settings:', error);
      return null;
    }

    if (!data || !data.enabled) {
      console.log(`No enabled TTN settings for org ${orgId}`);
      return null;
    }

    return data as TTNSettings;
  } catch (err) {
    console.error('Exception loading org settings:', err);
    return null;
  }
}

serve(async (req) => {
  // Generate unique request ID for traceability
  const requestId = crypto.randomUUID();
  
  // Debug logging for incoming requests
  console.log(`[ttn-simulate][${requestId}] ${req.method} request from ${req.headers.get('origin') || 'unknown origin'}`);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: SimulateUplinkRequest = await req.json();
    const { org_id, selected_user_id, decodedPayload, fPort, gatewayId, gatewayEui, devEui: requestDevEui, signalStrength: requestSignalStrength } = body;
    let { deviceId } = body;
    // Capture applicationId from request body — the frontend sends the correct
    // value from the FrostGuard live pull which takes precedence over the
    // potentially-stale synced_users mirror.
    const requestApplicationId = body.applicationId || undefined;

    console.log(`[ttn-simulate][${requestId}] Processing request`, { deviceId, org_id, selected_user_id, requestApplicationId });

    // Load TTN credentials - prioritize user's full API key
    let apiKey: string | undefined;
    let applicationId: string | undefined;
    let cluster: string | undefined;
    let settingsSource = 'request';

    // ONLY use user's full API key from synced_users.ttn (no org fallback)
    if (!selected_user_id) {
      console.error(`[ttn-simulate][${requestId}] No selected_user_id provided`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No user selected. Please select a user from the user selector to simulate TTN uplinks.',
          errorType: 'no_user_selected',
          hint: 'Use the user selector at the top of the page to choose a user with TTN credentials.',
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ttn-simulate][${requestId}] Loading user TTN settings for: ${selected_user_id}`);
    const userSettings = await loadUserSettings(selected_user_id);

    if (!userSettings) {
      console.error(`[ttn-simulate][${requestId}] No TTN settings found for user ${selected_user_id}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: `No TTN settings found for the selected user. User must be synced from FrostGuard first.`,
          errorType: 'no_user_settings',
          hint: 'Trigger a user sync from FrostGuard to populate TTN credentials for this user.',
          userId: selected_user_id,
          request_id: requestId,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get application_id: prefer the value sent by the frontend (from FrostGuard
    // live pull) over the synced_users mirror which can be stale
    applicationId = requestApplicationId || userSettings.application_id || undefined;
    cluster = userSettings.cluster;
    if (requestApplicationId && userSettings.application_id && requestApplicationId !== userSettings.application_id) {
      console.warn(`[ttn-simulate][${requestId}] application_id mismatch: request=${requestApplicationId}, synced_users=${userSettings.application_id}. Using request value.`);
    }

    // Try to get API key from user settings first
    if (userSettings.api_key) {
      apiKey = userSettings.api_key;
      settingsSource = 'user_settings';
      console.log(`[ttn-simulate] Using user's API key (last4: ****${apiKey.slice(-4)}) with app: ${applicationId}, cluster: ${cluster}`);
    } else if (org_id) {
      // Fallback: load API key from org's ttn_settings (canonical source)
      console.log(`[ttn-simulate] User settings missing API key, checking org ttn_settings for org ${org_id}`);
      const orgSettings = await loadOrgSettings(org_id);
      
      if (orgSettings?.api_key) {
        apiKey = orgSettings.api_key;
        settingsSource = 'org_ttn_settings';
        // Use org settings for app/cluster if user settings didn't have them
        if (!applicationId && orgSettings.application_id) {
          applicationId = orgSettings.application_id;
        }
        if (!cluster && orgSettings.cluster) {
          cluster = orgSettings.cluster;
        }
        console.log(`[ttn-simulate] Using org API key from ttn_settings (last4: ****${apiKey.slice(-4)}) with app: ${applicationId}, cluster: ${cluster}`);
      }
    }

    // Final validation
    if (!apiKey || !applicationId) {
      console.error(`[ttn-simulate][${requestId}] Incomplete TTN settings after fallback: hasApiKey=${!!apiKey}, hasApplicationId=${!!applicationId}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Incomplete TTN settings. Missing API key or application ID.',
          errorType: 'incomplete_settings',
          hint: apiKey ? 'Application ID is missing. Configure TTN settings in Webhook Settings.' : 'API key is missing. Save your API key in Webhook Settings → TTN Configuration.',
          userId: selected_user_id,
          orgId: org_id,
          hasApiKey: !!apiKey,
          hasApplicationId: !!applicationId,
          settingsSource,
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ttn-simulate][${requestId}] TTN_REQUEST`, {
      endpoint: 'simulate-uplink',
      deviceId,
      apiKeyLast4_used: apiKey.slice(-4),
      settingsSource,
      cluster,
      applicationId,
    });

    // Convert legacy eui-xxx format to canonical sensor-xxx format
    if (deviceId && deviceId.startsWith('eui-')) {
      const devEui = deviceId.substring(4); // Remove 'eui-' prefix
      const canonicalId = generateTTNDeviceId(devEui);
      if (canonicalId) {
        console.log(`Converting legacy device_id "${deviceId}" to canonical format "${canonicalId}"`);
        deviceId = canonicalId;
      }
    }

    // Validate configuration
    const validationError = validateConfig(applicationId!, deviceId, cluster!);
    if (validationError) {
      console.error(`[ttn-simulate][${requestId}] Validation error:`, validationError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: validationError,
          errorType: 'validation_error',
          deviceId,
          expectedFormat: 'sensor-XXXXXXXXXXXXXXXX',
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Simulating uplink:', { 
      applicationId, 
      deviceId, 
      cluster, 
      fPort, 
      settingsSource,
      orgId: org_id || 'none'
    });

    // Build the TTN Simulate Uplink API URL
    // Note: We skip the IS-based preflight device check because it queries the
    // Identity Server (GET /api/v3/applications/.../devices/...) which requires
    // `devices:read` rights. The simulate endpoint uses the Application Server
    // (POST /api/v3/as/.../up/simulate) which only needs `traffic:down:write`.
    // When the API key lacks `devices:read`, TTN returns 404 on the IS check
    // even though the device exists and simulation would succeed.
    // The simulate endpoint returns proper errors handled by parseTTNError().
    const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/as/applications/${applicationId}/devices/${deviceId}/up/simulate`;

    console.log('Calling TTN API:', ttnUrl);

    // Build the simulate uplink payload.
    // Send decoded_payload directly — TTN's simulate API passes it straight to
    // webhooks WITHOUT running the payload formatter. This is the official
    // testing mechanism and exactly what FrostGuard reads.
    // Also include frm_payload (Base64-encoded JSON) for TTN Console log realism.
    // Use explicit signalStrength from request, fall back to decoded_payload, then default
    const rssi = requestSignalStrength ?? (decodedPayload.signal_strength as number) ?? -70;
    const now = new Date().toISOString();

    // Build gateway_ids — include eui when the frontend provides it
    const gatewayIds: Record<string, string> = {
      gateway_id: gatewayId || "simulated-gateway",
    };
    if (gatewayEui) {
      gatewayIds.eui = gatewayEui.toUpperCase();
    }

    // Resolve dev_eui: prefer the value from the frontend (from FrostGuard sensor
    // record), fall back to extracting from device_id (sensor-{hex} pattern).
    // TTN's SimulateUplink API does NOT populate dev_eui in the forwarded webhook
    // unless we explicitly include end_device_ids in the request body.
    let resolvedDevEui = requestDevEui?.replace(/[:\s-]/g, '').toUpperCase();
    if (!resolvedDevEui && deviceId) {
      const match = deviceId.match(/^(?:sensor-|eui-)([0-9a-fA-F]+)$/);
      if (match) resolvedDevEui = match[1].toUpperCase();
    }

    const simulatePayload: Record<string, unknown> = {
      downlinks: [],
      // Include end_device_ids so TTN forwards dev_eui in the webhook event.
      // Without this, simulated uplinks arrive at the webhook without dev_eui
      // and FrostGuard can't identify the sensor.
      ...(resolvedDevEui && {
        end_device_ids: {
          device_id: deviceId,
          application_ids: { application_id: applicationId },
          dev_eui: resolvedDevEui,
          join_eui: "0000000000000000",
          dev_addr: "260CFFFF",
        },
      }),
      uplink_message: {
        // Dummy session_key_id to mimic a joined device — may trigger TTN to
        // include full device identifiers in the forwarded webhook event.
        session_key_id: "AAAAAAAAAAAAAAAAAAAAAA==",
        f_port: fPort,
        frm_payload: btoa(JSON.stringify(decodedPayload)),
        decoded_payload: decodedPayload,
        rx_metadata: [
          {
            gateway_ids: gatewayIds,
            rssi,
            channel_rssi: rssi,
            snr: 7.5,
            channel_index: 0,
            received_at: now,
          }
        ],
        settings: {
          data_rate: {
            lora: {
              bandwidth: 125000,
              spreading_factor: 7,
              coding_rate: "4/5",
            }
          },
          frequency: "904300000",
        },
      }
    };

    const response = await fetch(ttnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(simulatePayload),
    });

    const responseText = await response.text();
    console.log(`[ttn-simulate][${requestId}] TTN API response status:`, response.status);
    console.log(`[ttn-simulate][${requestId}] TTN API response:`, responseText);

    if (!response.ok) {
      const parsedError = parseTTNError(response.status, responseText, applicationId!, deviceId, cluster);
      
      console.log(`[ttn-simulate][${requestId}] TTN error parsed:`, {
        errorType: parsedError.errorType,
        status: response.status,
        message: parsedError.message,
        correlation_id: parsedError.correlation_id,
      });
      
      // IMPORTANT: Return 200 with success:false so frontend can parse the response
      // supabase.functions.invoke throws on non-2xx and loses the response body
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: parsedError.message,
          errorType: parsedError.errorType,
          requiredRights: parsedError.requiredRights,
          hint: parsedError.hint,
          ttn_status: response.status,
          status: response.status, // Keep for backward compatibility
          applicationId,
          deviceId,
          cluster,
          cluster_used: cluster,
          host_used: `${cluster}.cloud.thethings.network`,
          settingsSource,
          request_id: requestId,
          correlation_id: parsedError.correlation_id,
          cluster_hint: parsedError.errorType === 'as_not_visible'
            ? `Device registered but not visible on Application Server at ${cluster}.cloud.thethings.network. Re-provision the device.`
            : response.status === 404 
            ? `Device not found on ${cluster}.cloud.thethings.network. Verify this is the correct cluster for your TTN Console.`
            : undefined,
        }),
        { 
          status: 200, // Return 200 so invoke doesn't throw
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[ttn-simulate][${requestId}] Success: uplink simulated for ${deviceId}`);

    // ========================================
    // DUAL-WRITE: After TTN success, persist to Supabase
    // ========================================
    console.log(`[ttn-simulate][${requestId}] Writing uplink to Supabase...`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Extract dev_eui from device_id (sensor-XXXXXXXXXXXXXXXX)
    const devEui = deviceId.replace('sensor-', '').toUpperCase();
    const now = new Date().toISOString();
    
    // Get unit_id from payload or lookup from lora_sensors
    let unitId = decodedPayload.unit_id as string | undefined;
    
    // If unit_id is not a UUID, try to resolve it from lora_sensors
    const isUuid = unitId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unitId);
    if (!isUuid && org_id) {
      console.log(`[ttn-simulate][${requestId}] Resolving unit_id from lora_sensors for dev_eui: ${devEui}`);
      const { data: sensorData } = await supabase
        .from('lora_sensors')
        .select('unit_id')
        .eq('dev_eui', devEui.toLowerCase())
        .eq('org_id', org_id)
        .maybeSingle();
      
      if (sensorData?.unit_id) {
        unitId = sensorData.unit_id;
        console.log(`[ttn-simulate][${requestId}] Resolved unit_id: ${unitId}`);
      }
    }
    
    // 1. Insert into sensor_uplinks (raw history)
    const uplinkRecord = {
      org_id: org_id,
      dev_eui: devEui.toLowerCase(),
      f_port: fPort,
      payload_json: decodedPayload,
      rssi_dbm: (decodedPayload.signal_strength as number) ?? -70,
      battery_pct: (decodedPayload.battery_level as number) ?? null,
      received_at: now,
      unit_id: isUuid ? unitId : (unitId || null),
    };
    
    console.log(`[ttn-simulate][${requestId}] Inserting sensor_uplink:`, JSON.stringify(uplinkRecord));
    
    const { error: uplinkError } = await supabase
      .from('sensor_uplinks')
      .insert(uplinkRecord);
    
    if (uplinkError) {
      console.warn(`[ttn-simulate][${requestId}] Failed to insert sensor_uplink:`, uplinkError.message);
    } else {
      console.log(`[ttn-simulate][${requestId}] sensor_uplink inserted successfully`);
    }
    
    // 2. Upsert unit_telemetry (real-time state) if we have a valid unit_id
    // Detect payload type from field presence instead of hardcoded fPort values,
    // since device library models use varying fPorts (85, 5, 6, etc.)
    const hasTemperature = resolveTemperature(decodedPayload) !== undefined;
    const hasDoor = resolveDoorStatus(decodedPayload) !== undefined;

    if (unitId && isUuid && org_id) {
      const telemetryUpdate: Record<string, unknown> = {
        unit_id: unitId,
        org_id: org_id,
        battery_pct: (decodedPayload.battery_level as number) ?? null,
        rssi_dbm: (decodedPayload.signal_strength as number) ?? null,
        last_uplink_at: now,
        updated_at: now,
      };

      // Temperature data — check canonical and Dragino field names
      if (hasTemperature) {
        const tempC = resolveTemperature(decodedPayload)!;
        telemetryUpdate.last_temp_f = tempC * 9/5 + 32;
        const humidity = (decodedPayload.humidity ?? decodedPayload.Hum_SHT) as number | undefined;
        if (humidity !== undefined) {
          telemetryUpdate.last_humidity = humidity;
        }
      }

      // Door data — check canonical and Dragino field names
      if (hasDoor) {
        const doorStatus = resolveDoorStatus(decodedPayload)!;
        telemetryUpdate.door_state = doorStatus;
        telemetryUpdate.last_door_event_at = now;
        console.log(`[ttn-simulate][${requestId}] Door event: ${doorStatus} for unit ${unitId}`);
      }

      console.log(`[ttn-simulate][${requestId}] Upserting unit_telemetry:`, JSON.stringify(telemetryUpdate));

      const { error: telemetryError } = await supabase
        .from('unit_telemetry')
        .upsert(telemetryUpdate, { onConflict: 'unit_id' });

      if (telemetryError) {
        console.warn(`[ttn-simulate][${requestId}] Failed to upsert unit_telemetry:`, telemetryError.message);
      } else {
        console.log(`[ttn-simulate][${requestId}] unit_telemetry upserted for unit ${unitId}`);
      }
    }

    // 3. Insert into legacy door_events table when payload contains door data
    if (hasDoor) {
      const doorStatus = resolveDoorStatus(decodedPayload)!;
      const doorEventRecord = {
        device_serial: devEui.toLowerCase(),
        door_status: doorStatus,
        battery_level: (decodedPayload.battery_level as number) ?? null,
        signal_strength: (decodedPayload.signal_strength as number) ?? null,
        unit_id: unitId || null,
      };

      console.log(`[ttn-simulate][${requestId}] Inserting door_event:`, JSON.stringify(doorEventRecord));

      const { error: doorError } = await supabase
        .from('door_events')
        .insert(doorEventRecord);

      if (doorError) {
        console.warn(`[ttn-simulate][${requestId}] Failed to insert door_event:`, doorError.message);
      } else {
        console.log(`[ttn-simulate][${requestId}] door_event inserted successfully`);
      }
    }

    // 4. Insert into legacy sensor_readings table when payload contains temperature data
    if (hasTemperature) {
      const tempC = resolveTemperature(decodedPayload)!;
      const humidity = (decodedPayload.humidity ?? decodedPayload.Hum_SHT) as number | undefined;
      const readingRecord = {
        device_serial: devEui.toLowerCase(),
        temperature: tempC,
        humidity: humidity ?? null,
        battery_level: (decodedPayload.battery_level as number) ?? null,
        signal_strength: (decodedPayload.signal_strength as number) ?? null,
        unit_id: unitId || null,
        reading_type: 'simulated',
      };

      console.log(`[ttn-simulate][${requestId}] Inserting sensor_reading:`, JSON.stringify(readingRecord));

      const { error: readingError } = await supabase
        .from('sensor_readings')
        .insert(readingRecord);

      if (readingError) {
        console.warn(`[ttn-simulate][${requestId}] Failed to insert sensor_reading:`, readingError.message);
      } else {
        console.log(`[ttn-simulate][${requestId}] sensor_reading inserted successfully`);
      }
    }

    // TTN simulate endpoint returns empty response on success
    // Include server_timestamp for frontend time synchronization
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Uplink simulated successfully',
        ttnResponse: responseText || null,
        settingsSource,
        cluster,
        applicationId,
        deviceId,
        request_id: requestId,
        // Authoritative server timestamp for client sync
        server_timestamp: now,
        received_at: now,
        db_writes: {
          sensor_uplinks: !uplinkError,
          unit_telemetry: unitId && isUuid ? true : 'skipped_no_uuid',
          door_events: hasDoor,
          sensor_readings: hasTemperature,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ttn-simulate] Error in function:`, error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, errorType: 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
