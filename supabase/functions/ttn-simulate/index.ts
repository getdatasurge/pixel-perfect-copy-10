import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
function parseTTNError(status: number, responseText: string, applicationId: string, deviceId: string): { 
  message: string; 
  errorType: string;
  requiredRights?: string[];
  hint?: string;
} {
  try {
    const errorData = JSON.parse(responseText);
    const errorName = errorData?.details?.[0]?.name || '';
    const errorMessage = errorData?.message || '';
    
    if (status === 403) {
      // Check for specific permission errors
      if (errorMessage.includes('downlink') || errorName === 'no_application_rights') {
        return {
          message: `API key doesn't have required permissions for application "${applicationId}".`,
          errorType: 'permission_error',
          requiredRights: [
            'Write downlink application traffic',
            'Read application traffic (traffic:read)',
          ],
          hint: 'Edit your API key in TTN Console → API Keys → Edit, and add the "Write downlink application traffic" permission.',
        };
      }
      return {
        message: `API key doesn't have rights for application "${applicationId}".`,
        errorType: 'permission_error',
        requiredRights: ['Read application traffic', 'Write downlink application traffic'],
        hint: 'Verify the API key was created with permissions for this specific application.',
      };
    }
    
    if (status === 404 || errorName === 'end_device_not_found' || errorMessage.includes('not_found') || errorMessage.includes('entity not found')) {
      return {
        message: `Device "${deviceId}" not found in TTN application "${applicationId}". TTN will drop uplinks as "entity not found".`,
        errorType: 'device_not_found',
        hint: `Register the device in TTN Console with device_id: ${deviceId}. Use the "Register in TTN" button or create it manually.`,
      };
    }
    
    if (status === 401) {
      return {
        message: 'Invalid or expired TTN API key.',
        errorType: 'auth_error',
        hint: 'Generate a new key in TTN Console → API Keys.',
      };
    }
    
    return {
      message: errorData.message || errorData.error || `TTN API error (${status})`,
      errorType: 'ttn_error',
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

    const ttn = data.ttn as any;
    if (!ttn.enabled) {
      console.log(`TTN not enabled for user ${userId}`);
      return null;
    }

    // Map synced_users.ttn structure to TTNSettings interface
    return {
      api_key: ttn.api_key || null,
      application_id: ttn.application_id || null,
      cluster: ttn.cluster || 'eu1',
      enabled: ttn.enabled || false,
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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SimulateUplinkRequest = await req.json();
    let { org_id, selected_user_id, deviceId, decodedPayload, fPort } = body;

    // Load TTN API key from org settings
    // Frontend provides application_id and cluster (user-specific)
    // We only need to fetch the API key (org-level credential)
    let apiKey: string | undefined;
    let applicationId: string | undefined;
    let cluster: string | undefined;
    let settingsSource = 'request';

    // Use application_id and cluster from request body (user-specific TTN app)
    applicationId = body.applicationId;
    cluster = body.cluster;

    // Fetch API key from org's TTN settings
    if (org_id) {
      console.log(`Loading TTN API key for org: ${org_id}`);
      const orgSettings = await loadOrgSettings(org_id);

      if (orgSettings?.api_key) {
        apiKey = orgSettings.api_key;
        settingsSource = 'org_settings';
        console.log(`Using org API key with user's TTN app: cluster=${cluster}, app=${applicationId}`);
      }
    }

    // Fallback to global secret if no org API key
    if (!apiKey) {
      apiKey = Deno.env.get('TTN_API_KEY');
      settingsSource = 'global_secret';
      console.log(`Using global API key`);
    }

    // Convert legacy eui-xxx format to canonical sensor-xxx format
    if (deviceId && deviceId.startsWith('eui-')) {
      const devEui = deviceId.substring(4); // Remove 'eui-' prefix
      const canonicalId = generateTTNDeviceId(devEui);
      if (canonicalId) {
        console.log(`Converting legacy device_id "${deviceId}" to canonical format "${canonicalId}"`);
        deviceId = canonicalId;
      }
    }

    // Validate we have required credentials
    if (!apiKey) {
      console.error('No TTN API key available');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: org_id 
            ? 'TTN not configured for this organization. Go to Webhook tab to configure TTN settings.'
            : 'TTN_API_KEY not configured. Add your TTN API key in project secrets or configure per-org settings.',
          errorType: 'missing_api_key',
          hint: 'Configure TTN settings in the Webhook tab for your organization.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate configuration
    const validationError = validateConfig(applicationId!, deviceId, cluster!);
    if (validationError) {
      console.error('Validation error:', validationError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: validationError,
          errorType: 'validation_error',
          deviceId,
          expectedFormat: 'sensor-XXXXXXXXXXXXXXXX',
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
      console.error('Preflight check failed: device not found in TTN');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: deviceCheck.error,
          errorType: 'device_not_found',
          hint: deviceCheck.hint,
          deviceId,
          applicationId,
          cluster,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
    console.log('TTN API response status:', response.status);
    console.log('TTN API response:', responseText);

    if (!response.ok) {
      const parsedError = parseTTNError(response.status, responseText, applicationId!, deviceId);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: parsedError.message,
          errorType: parsedError.errorType,
          requiredRights: parsedError.requiredRights,
          hint: parsedError.hint,
          status: response.status,
          applicationId,
          deviceId,
          cluster,
          settingsSource,
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
        ttnResponse: responseText || null,
        settingsSource,
        cluster,
        applicationId,
        deviceId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in ttn-simulate function:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, errorType: 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
