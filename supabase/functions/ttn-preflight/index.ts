import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreflightRequest {
  selected_user_id: string;
  org_id?: string;
  devices?: Array<{ dev_eui: string; name?: string }>;
  detect_cluster_from_url?: string; // If provided, parse cluster from TTN console URL
}

interface TTNSettings {
  api_key: string | null;
  application_id: string | null;
  cluster: string;
  enabled: boolean;
}

interface DeviceCheckResult {
  dev_eui: string;
  device_id: string;
  name?: string;
  registered: boolean;
  error?: string;
  hint?: string;
}

interface PreflightResult {
  ok: boolean;
  cluster: string;
  host: string;
  application: {
    id: string;
    exists: boolean;
    error?: string;
  };
  devices: DeviceCheckResult[];
  all_registered: boolean;
  unregistered_count: number;
  cluster_mismatch?: {
    detected_cluster: string;
    configured_cluster: string;
    hint: string;
  };
  request_id: string;
  settings_source: string;
}

// Parse cluster from TTN Console URL
function parseClusterFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Extract cluster from hostname like "nam1.cloud.thethings.network"
    const match = host.match(/^(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (match) {
      return match[1];
    }
    // Also try to match console URLs
    const consoleMatch = host.match(/^console\.(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (consoleMatch) {
      return consoleMatch[1];
    }
  } catch {
    // Invalid URL
  }
  return null;
}

// Normalize DevEUI
function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// Generate canonical TTN device_id
function generateTTNDeviceId(devEui: string): string | null {
  const normalized = normalizeDevEui(devEui);
  if (!normalized) return null;
  return `sensor-${normalized}`;
}

// Load TTN settings from synced_users
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

    if (error || !data?.ttn) {
      console.log(`No TTN settings found for user ${userId}`);
      return null;
    }

    const ttn = data.ttn as any;
    if (!ttn.enabled) {
      return null;
    }

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

// Load TTN settings from ttn_settings table
async function loadOrgSettings(orgId: string): Promise<TTNSettings | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('ttn_settings')
      .select('api_key, application_id, cluster, enabled')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error || !data?.enabled) {
      return null;
    }

    return data as TTNSettings;
  } catch (err) {
    console.error('Exception loading org settings:', err);
    return null;
  }
}

// Check if application exists
async function checkApplicationExists(
  cluster: string,
  applicationId: string,
  apiKey: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    const url = `https://${cluster}.cloud.thethings.network/api/v3/applications/${applicationId}`;
    console.log(`[preflight] Checking application: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.status === 404) {
      return { 
        exists: false, 
        error: `Application "${applicationId}" not found on cluster ${cluster}`,
      };
    }

    if (response.status === 401) {
      return { 
        exists: false, 
        error: 'Invalid or expired API key',
      };
    }

    if (response.status === 403) {
      return { 
        exists: false, 
        error: `API key does not have permission to access application "${applicationId}"`,
      };
    }

    if (!response.ok) {
      const text = await response.text();
      return { 
        exists: false, 
        error: `TTN returned ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    return { exists: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Error checking application:', err);
    return { exists: false, error: `Network error: ${errorMessage}` };
  }
}

// Check if device exists
async function checkDeviceExists(
  cluster: string,
  applicationId: string,
  deviceId: string,
  apiKey: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    const url = `https://${cluster}.cloud.thethings.network/api/v3/applications/${applicationId}/devices/${deviceId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }

    if (response.status === 403) {
      // Can't verify but might exist
      console.warn(`Cannot verify device ${deviceId} (403), assuming might exist`);
      return { exists: true };
    }

    if (!response.ok) {
      return { exists: false, error: `TTN returned ${response.status}` };
    }

    return { exists: true };
  } catch (err) {
    console.error(`Error checking device ${deviceId}:`, err);
    // On network error, assume might exist to not block
    return { exists: true };
  }
}

serve(async (req) => {
  const requestId = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[ttn-preflight] ${req.method} request, id: ${requestId}`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: PreflightRequest = await req.json();
    const { selected_user_id, org_id, devices = [], detect_cluster_from_url } = body;

    if (!selected_user_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'No user selected. Please select a user with TTN credentials.',
          request_id: requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load TTN settings
    console.log(`[preflight] Loading TTN settings for user: ${selected_user_id}`);
    let settings = await loadUserSettings(selected_user_id);
    let settingsSource = 'user';

    if (!settings?.api_key && org_id) {
      console.log(`[preflight] User settings missing API key, trying org: ${org_id}`);
      settings = await loadOrgSettings(org_id);
      settingsSource = 'org';
    }

    if (!settings?.api_key || !settings.application_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Incomplete TTN settings. Missing API key or application ID.',
          hint: 'Configure TTN settings in the Webhook Settings panel.',
          request_id: requestId,
          settings_source: settingsSource,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { api_key, application_id, cluster } = settings;
    const host = `${cluster}.cloud.thethings.network`;

    console.log(`[preflight] Settings loaded: cluster=${cluster}, app=${application_id}, source=${settingsSource}`);

    // Check for cluster mismatch if URL provided
    let clusterMismatch: PreflightResult['cluster_mismatch'];
    if (detect_cluster_from_url) {
      const detectedCluster = parseClusterFromUrl(detect_cluster_from_url);
      if (detectedCluster && detectedCluster !== cluster) {
        clusterMismatch = {
          detected_cluster: detectedCluster,
          configured_cluster: cluster,
          hint: `Your TTN Console is on "${detectedCluster}" but Emulator is configured for "${cluster}". Uplinks will be dropped. Switch to "${detectedCluster}" in TTN settings.`,
        };
        console.log(`[preflight] Cluster mismatch detected: ${detectedCluster} vs ${cluster}`);
      }
    }

    // Check application exists
    console.log(`[preflight] Checking application: ${application_id}`);
    const appCheck = await checkApplicationExists(cluster, application_id, api_key);

    if (!appCheck.exists) {
      return new Response(
        JSON.stringify({
          ok: false,
          cluster,
          host,
          application: {
            id: application_id,
            exists: false,
            error: appCheck.error,
          },
          devices: [],
          all_registered: false,
          unregistered_count: devices.length,
          cluster_mismatch: clusterMismatch,
          request_id: requestId,
          settings_source: settingsSource,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check each device
    const deviceResults: DeviceCheckResult[] = [];
    
    for (const device of devices) {
      const deviceId = generateTTNDeviceId(device.dev_eui);
      if (!deviceId) {
        deviceResults.push({
          dev_eui: device.dev_eui,
          device_id: 'invalid',
          name: device.name,
          registered: false,
          error: 'Invalid DevEUI format',
        });
        continue;
      }

      console.log(`[preflight] Checking device: ${deviceId}`);
      const deviceCheck = await checkDeviceExists(cluster, application_id, deviceId, api_key);
      
      deviceResults.push({
        dev_eui: device.dev_eui,
        device_id: deviceId,
        name: device.name,
        registered: deviceCheck.exists,
        error: deviceCheck.error,
        hint: deviceCheck.exists ? undefined : `Register this device in TTN with device_id: ${deviceId}`,
      });
    }

    const unregisteredCount = deviceResults.filter(d => !d.registered).length;
    const allRegistered = unregisteredCount === 0;

    console.log(`[preflight] Complete: app=${appCheck.exists}, devices=${deviceResults.length}, unregistered=${unregisteredCount}`);

    const result: PreflightResult = {
      ok: appCheck.exists && allRegistered && !clusterMismatch,
      cluster,
      host,
      application: {
        id: application_id,
        exists: true,
      },
      devices: deviceResults,
      all_registered: allRegistered,
      unregistered_count: unregisteredCount,
      cluster_mismatch: clusterMismatch,
      request_id: requestId,
      settings_source: settingsSource,
    };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ttn-preflight] Error:', error);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Preflight check failed: ${errorMessage}`,
        request_id: requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
