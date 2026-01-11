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
  cluster?: string;
  decodedPayload: Record<string, unknown>;
  fPort: number;
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
      cluster: ttn.cluster || 'eu1',
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

// Check if device exists in TTN before simulating
async function checkDeviceExists(
  cluster: string, 
  applicationId: string, 
  deviceId: string, 
  apiKey: string
): Promise<{ exists: boolean; error?: string; hint?: string }> {
  try {
    const checkUrl = `https://${cluster}.cloud.thethings.network/api/v3/applications/${applicationId}/devices/${deviceId}`;
    console.log('Preflight check - verifying device exists:', checkUrl);
    
    const response = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (response.status === 404) {
      return { 
        exists: false, 
        error: `Device "${deviceId}" not provisioned in TTN application "${applicationId}". TTN will drop uplinks as "entity not found".`,
        hint: `Register the device in TTN Console first using the "Register in TTN" button, or create it manually with device_id: ${deviceId}`,
      };
    }
    
    if (response.status === 403) {
      // Can't verify but might still work for simulation
      console.warn('Cannot verify device existence (403), proceeding with simulation');
      return { exists: true };
    }
    
    if (!response.ok) {
      console.warn(`Device check returned ${response.status}, proceeding with simulation`);
      return { exists: true };
    }
    
    console.log('Device exists in TTN, proceeding with simulation');
    return { exists: true };
  } catch (err) {
    console.error('Error checking device existence:', err);
    // On network error, proceed with simulation
    return { exists: true };
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
    const { org_id, selected_user_id, decodedPayload, fPort } = body;
    let { deviceId } = body;
    
    console.log(`[ttn-simulate][${requestId}] Processing request`, { deviceId, org_id, selected_user_id });

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

    // Get application_id and cluster from user settings
    applicationId = userSettings.application_id || undefined;
    cluster = userSettings.cluster;

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

    // Preflight check: verify device exists in TTN
    const deviceCheck = await checkDeviceExists(cluster!, applicationId!, deviceId, apiKey);
    if (!deviceCheck.exists) {
      console.error(`[ttn-simulate][${requestId}] Preflight check failed: device not found in TTN`);
      // Return 200 with success:false so frontend can parse the error details
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: deviceCheck.error,
          errorType: 'device_not_found',
          hint: deviceCheck.hint,
          ttn_status: 404,
          deviceId,
          applicationId,
          cluster,
          cluster_used: cluster,
          host_used: `${cluster}.cloud.thethings.network`,
          request_id: requestId,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the TTN Simulate Uplink API URL
    const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/as/applications/${applicationId}/devices/${deviceId}/up/simulate`;

    console.log('Calling TTN API:', ttnUrl);

    // Build the simulate uplink payload
    const simulatePayload = {
      downlinks: [],
      uplink_message: {
        f_port: fPort,
        decoded_payload: decodedPayload,
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

    // TTN simulate endpoint returns empty response on success
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
