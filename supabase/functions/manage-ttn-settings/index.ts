import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Supported TTN clusters - simplified to main regions
const VALID_CLUSTERS = ['eu1', 'nam1'] as const;
type TTNCluster = typeof VALID_CLUSTERS[number];

// Required permissions for display (informational only)
const REQUIRED_PERMISSIONS = ['applications:read', 'devices:read', 'devices:write'];

interface TTNSettingsRequest {
  action: 'load' | 'save' | 'test' | 'test_stored' | 'check_device' | 'check_gateway' | 'check_gateway_permissions' | 'check_app_permissions' | 'discover_gateway_owner';
  org_id?: string;
  selected_user_id?: string; // For testing specific user's TTN settings
  enabled?: boolean;
  cluster?: TTNCluster;
  application_id?: string;
  api_key?: string;
  gateway_api_key?: string; // Personal/Org API key with gateway permissions
  webhook_secret?: string;
  device_id?: string;
  gateway_id?: string;
  gateway_owner_type?: 'user' | 'organization';
  gateway_owner_id?: string;
}

// TTN Rights that we check for
const TTN_RIGHTS = {
  APP_INFO_READ: 'RIGHT_APPLICATION_INFO',
  APP_DEVICES_READ: 'RIGHT_APPLICATION_DEVICES_READ',
  APP_DEVICES_WRITE: 'RIGHT_APPLICATION_DEVICES_WRITE',
  APP_TRAFFIC_DOWN_WRITE: 'RIGHT_APPLICATION_TRAFFIC_DOWN_WRITE',
} as const;

// Generate correlation ID for debugging
function generateRequestId(): string {
  return crypto.randomUUID();
}

// Mask sensitive values for display
function maskSecret(value: string | null): string | null {
  if (!value || value.length < 8) return value ? '****' : null;
  return `****${value.slice(-4)}`;
}

// Build cluster base URL
function getBaseUrl(cluster: string): string {
  return `https://${cluster}.cloud.thethings.network`;
}

// Build response with correlation ID
function buildResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string
): Response {
  return new Response(
    JSON.stringify({ ...body, requestId }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

// Error response helper - always returns 200 with ok:false for client parsing
function errorResponse(
  error: string,
  code: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>
): Response {
  return buildResponse(
    { ok: false, error, code, status, ...details },
    status,
    requestId
  );
}

Deno.serve(async (req) => {
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    let body: TTNSettingsRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400, requestId);
    }

    const { action, org_id } = body;
    console.log(`[${requestId}] Action: ${action}, org_id: ${org_id || 'none'}`);

    // Process action
    switch (action) {
      case 'load':
        return await handleLoad(supabaseAdmin, org_id, requestId);

      case 'save':
        return await handleSave(supabaseAdmin, body, requestId);

      case 'test':
        return await handleTest(body, requestId);

      case 'test_stored':
        return await handleTestStored(supabaseAdmin, body, requestId);

      case 'check_device':
        return await handleCheckDevice(body, requestId);

      case 'check_gateway':
        return await handleCheckGateway(supabaseAdmin, body, requestId);

      case 'check_gateway_permissions':
        return await handleCheckGatewayPermissions(supabaseAdmin, body, requestId);

      case 'check_app_permissions':
        return await handleCheckAppPermissions(body, requestId);

      case 'discover_gateway_owner':
        return await handleDiscoverGatewayOwner(supabaseAdmin, body, requestId);

      default:
        return errorResponse(`Unknown action: ${action}`, 'VALIDATION_ERROR', 400, requestId);
    }
  } catch (err) {
    // Catch-all: never throw, always return JSON
    console.error(`[${requestId}] Unhandled error:`, err);
    return errorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      500,
      requestId,
      { hint: 'Check edge function logs for details' }
    );
  }
});

// Load TTN settings for org
async function handleLoad(
  supabase: any,
  org_id: string | undefined,
  requestId: string
): Promise<Response> {
  if (!org_id) {
    // Return defaults if no org
    return buildResponse({
      ok: true,
      settings: {
        enabled: false,
        cluster: 'nam1',
        application_id: null,
        api_key_preview: null,
        api_key_set: false,
        api_key_last4: null,
        gateway_api_key_preview: null,
        gateway_api_key_set: false,
        gateway_api_key_last4: null,
        webhook_secret_preview: null,
        webhook_secret_set: false,
        webhook_secret_last4: null,
        gateway_owner_type: 'user',
        gateway_owner_id: null,
      }
    }, 200, requestId);
  }

  console.log(`[${requestId}] Loading settings for org ${org_id}`);

  const { data, error } = await supabase
    .from('ttn_settings')
    .select('enabled, cluster, application_id, api_key, gateway_api_key, webhook_secret, updated_at, last_test_at, last_test_success, gateway_owner_type, gateway_owner_id')
    .eq('org_id', org_id)
    .maybeSingle();

  if (error) {
    console.error(`[${requestId}] Load error:`, error.message);
    return errorResponse('Failed to load settings', 'DB_ERROR', 500, requestId);
  }

  if (!data) {
    return buildResponse({
      ok: true,
      settings: {
        enabled: false,
        cluster: 'nam1',
        application_id: null,
        api_key_preview: null,
        api_key_set: false,
        api_key_last4: null,
        gateway_api_key_preview: null,
        gateway_api_key_set: false,
        gateway_api_key_last4: null,
        webhook_secret_preview: null,
        webhook_secret_set: false,
        webhook_secret_last4: null,
        last_test_at: null,
        last_test_success: null,
        gateway_owner_type: 'user',
        gateway_owner_id: null,
      }
    }, 200, requestId);
  }

  const hasApiKey = !!(data.api_key && data.api_key.length > 0);
  const hasGatewayApiKey = !!(data.gateway_api_key && data.gateway_api_key.length > 0);
  const hasWebhookSecret = !!(data.webhook_secret && data.webhook_secret.length > 0);

  return buildResponse({
    ok: true,
    settings: {
      enabled: data.enabled,
      cluster: data.cluster,
      application_id: data.application_id,
      api_key_preview: maskSecret(data.api_key),
      api_key_set: hasApiKey,
      api_key_last4: hasApiKey ? data.api_key.slice(-4) : null,
      gateway_api_key_preview: maskSecret(data.gateway_api_key),
      gateway_api_key_set: hasGatewayApiKey,
      gateway_api_key_last4: hasGatewayApiKey ? data.gateway_api_key.slice(-4) : null,
      webhook_secret_preview: maskSecret(data.webhook_secret),
      webhook_secret_set: hasWebhookSecret,
      webhook_secret_last4: hasWebhookSecret ? data.webhook_secret.slice(-4) : null,
      updated_at: data.updated_at,
      last_test_at: data.last_test_at,
      last_test_success: data.last_test_success,
      gateway_owner_type: data.gateway_owner_type || 'user',
      gateway_owner_id: data.gateway_owner_id || null,
    }
  }, 200, requestId);
}

// Save TTN settings for org
async function handleSave(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, enabled, cluster, application_id, api_key, gateway_api_key, webhook_secret, gateway_owner_type, gateway_owner_id } = body;

  if (!org_id) {
    return errorResponse('org_id is required to save settings', 'VALIDATION_ERROR', 400, requestId);
  }

  console.log(`[${requestId}] Saving settings for org ${org_id}, enabled=${enabled}, cluster=${cluster}, app=${application_id}, gateway_owner=${gateway_owner_type}/${gateway_owner_id}`);

  // Check if we have an existing API key stored
  const { data: existingSettings } = await supabase
    .from('ttn_settings')
    .select('api_key, gateway_api_key')
    .eq('org_id', org_id)
    .maybeSingle();

  const hasExistingKey = !!(existingSettings?.api_key && existingSettings.api_key.length > 0);

  // Validate required fields when enabled
  if (enabled) {
    if (!application_id) {
      return errorResponse('Application ID is required when TTN is enabled', 'VALIDATION_ERROR', 400, requestId);
    }
    // Only require API key if not already stored AND no new key provided
    if (!api_key && !hasExistingKey) {
      return errorResponse('API key is required when enabling TTN', 'VALIDATION_ERROR', 400, requestId);
    }
    if (!cluster || !VALID_CLUSTERS.includes(cluster as TTNCluster)) {
      return errorResponse('Valid cluster (eu1 or nam1) is required', 'VALIDATION_ERROR', 400, requestId);
    }
  }

  // Build upsert data - only include api_key/webhook_secret if provided
  const upsertData: Record<string, any> = {
    org_id,
    enabled: enabled ?? false,
    cluster: cluster ?? 'nam1',
    application_id: application_id ?? null,
  };

  // Only update secrets if new values provided
  if (api_key) {
    upsertData.api_key = api_key;
  }
  if (gateway_api_key) {
    upsertData.gateway_api_key = gateway_api_key;
  }
  if (webhook_secret) {
    upsertData.webhook_secret = webhook_secret;
  }
  
  // Update gateway owner settings if provided
  if (gateway_owner_type !== undefined) {
    upsertData.gateway_owner_type = gateway_owner_type;
  }
  if (gateway_owner_id !== undefined) {
    upsertData.gateway_owner_id = gateway_owner_id;
  }

  const { error } = await supabase
    .from('ttn_settings')
    .upsert(upsertData, { onConflict: 'org_id' });

  if (error) {
    console.error(`[${requestId}] Save error:`, error.message);
    return errorResponse('Failed to save settings', 'DB_ERROR', 500, requestId);
  }

  // Reload settings to get the current state including updated_at
  const { data: savedSettings } = await supabase
    .from('ttn_settings')
    .select('api_key, gateway_api_key, webhook_secret, updated_at, gateway_owner_type, gateway_owner_id')
    .eq('org_id', org_id)
    .maybeSingle();

  const apiKeySet = !!(savedSettings?.api_key && savedSettings.api_key.length > 0);
  const gatewayApiKeySet = !!(savedSettings?.gateway_api_key && savedSettings.gateway_api_key.length > 0);
  const webhookSecretSet = !!(savedSettings?.webhook_secret && savedSettings.webhook_secret.length > 0);
  const apiKeyLast4 = savedSettings?.api_key?.slice(-4) || null;
  const gatewayApiKeyLast4 = savedSettings?.gateway_api_key?.slice(-4) || null;

  console.log(`[${requestId}] Settings saved successfully, api_key_set=${apiKeySet}, api_key_last4=****${apiKeyLast4 || 'none'}, gateway_api_key_set=${gatewayApiKeySet}, gateway_owner=${savedSettings?.gateway_owner_type}/${savedSettings?.gateway_owner_id}`);
  
  return buildResponse({ 
    ok: true, 
    message: 'Settings saved',
    api_key_set: apiKeySet,
    api_key_preview: maskSecret(savedSettings?.api_key),
    api_key_last4: apiKeyLast4,
    gateway_api_key_set: gatewayApiKeySet,
    gateway_api_key_preview: maskSecret(savedSettings?.gateway_api_key),
    gateway_api_key_last4: gatewayApiKeyLast4,
    webhook_secret_set: webhookSecretSet,
    webhook_secret_preview: maskSecret(savedSettings?.webhook_secret),
    updated_at: savedSettings?.updated_at,
    gateway_owner_type: savedSettings?.gateway_owner_type || 'user',
    gateway_owner_id: savedSettings?.gateway_owner_id || null,
  }, 200, requestId);
}

// Test TTN connection using stored API key from database
async function handleTestStored(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, selected_user_id, cluster, application_id } = body;

  if (!org_id) {
    return buildResponse({
      ok: false,
      error: 'org_id is required to test stored settings',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  console.log(`[${requestId}] Testing stored TTN settings for org ${org_id}, user ${selected_user_id || 'none'}`);

  // Load settings from database
  // If cluster and application_id are provided (from user selection), use them directly
  // Otherwise, load from database
  let settings: any = null;
  let error: any = null;

  if (selected_user_id && cluster && application_id) {
    // Use TTN settings provided in request (from frontend, already has user's TTN data)
    console.log(`[${requestId}] Using TTN settings from request for user ${selected_user_id}: app=${application_id}, cluster=${cluster}`);
    settings = {
      enabled: true,
      cluster: cluster,
      application_id: application_id,
      api_key: null, // Will fetch from org settings below
    };
  } else if (selected_user_id) {
    // Fallback: try to load from synced_users (if TTN data was synced)
    // Use source_user_id since that's the FrostGuard user id the frontend passes
    console.log(`[${requestId}] Loading TTN settings from synced_users for user ${selected_user_id}`);
    const { data, error: fetchError } = await supabase
      .from('synced_users')
      .select('ttn')
      .eq('source_user_id', selected_user_id)
      .maybeSingle();

    error = fetchError;
    if (data?.ttn) {
      // Map synced_users.ttn structure to expected settings structure
      const ttn = data.ttn as any;
      settings = {
        enabled: ttn.enabled || false,
        cluster: ttn.cluster || 'eu1',
        application_id: ttn.application_id || null,
        api_key: null, // API key is not stored in synced_users, only last4
      };
    }

    // If user TTN settings not found in synced_users, fall back to org settings
    if (!settings) {
      console.log(`[${requestId}] User TTN settings not found, falling back to org settings`);
      const { data: orgData, error: orgError } = await supabase
        .from('ttn_settings')
        .select('enabled, cluster, application_id, api_key')
        .eq('org_id', org_id)
        .maybeSingle();

      error = orgError;
      settings = orgData;
    }
  } else {
    console.log(`[${requestId}] Loading TTN settings from ttn_settings for org ${org_id}`);
    const { data, error: fetchError } = await supabase
      .from('ttn_settings')
      .select('enabled, cluster, application_id, api_key')
      .eq('org_id', org_id)
      .maybeSingle();

    error = fetchError;
    settings = data;
  }

  if (error) {
    console.error(`[${requestId}] Failed to load settings:`, error.message);
    return buildResponse({
      ok: false,
      error: 'Failed to load TTN settings from database',
      code: 'DB_ERROR',
    }, 200, requestId);
  }

  if (!settings) {
    return buildResponse({
      ok: false,
      error: selected_user_id
        ? 'No TTN settings found for this user'
        : 'No TTN settings found for this organization',
      code: 'NOT_CONFIGURED',
      hint: 'Save TTN settings first before testing',
    }, 200, requestId);
  }

  if (!settings.enabled) {
    return buildResponse({
      ok: false,
      error: 'TTN integration is disabled',
      code: 'DISABLED',
      hint: 'Enable TTN integration and save settings',
    }, 200, requestId);
  }

  // If testing user's TTN settings but API key is not in synced_users,
  // try to get the API key from organization's ttn_settings
  let apiKey = settings.api_key;
  if (selected_user_id && !apiKey) {
    console.log(`[${requestId}] User TTN settings don't have API key, trying org ttn_settings`);
    const { data: orgSettings } = await supabase
      .from('ttn_settings')
      .select('api_key')
      .eq('org_id', org_id)
      .maybeSingle();

    apiKey = orgSettings?.api_key || null;
  }

  if (!apiKey) {
    return buildResponse({
      ok: false,
      error: 'No API key saved',
      code: 'NO_API_KEY',
      hint: selected_user_id
        ? 'User TTN settings are synced from FrostGuard without the full API key. Save API key in organization TTN settings to test.'
        : 'Enter an API key and save settings first',
    }, 200, requestId);
  }

  // Now test with the stored credentials
  const result = await handleTest({
    cluster: settings.cluster,
    application_id: settings.application_id,
    api_key: apiKey,
  }, requestId);

  // Save test result to database (only for org settings, not user settings)
  const resultBody = await result.clone().json();
  const testSuccess = resultBody.ok && resultBody.connected === true;

  if (!selected_user_id) {
    // Only update ttn_settings when testing org's own TTN settings
    await supabase
      .from('ttn_settings')
      .update({
        last_test_at: new Date().toISOString(),
        last_test_success: testSuccess,
      })
      .eq('org_id', org_id);

    console.log(`[${requestId}] Saved test result to ttn_settings: success=${testSuccess}`);
  } else {
    console.log(`[${requestId}] Tested user's TTN settings (not saving to ttn_settings): success=${testSuccess}`);
  }

  return result;
}

// Test TTN connection - SIMPLIFIED to only check application access
async function handleTest(
  body: Partial<TTNSettingsRequest>,
  requestId: string
): Promise<Response> {
  const { cluster, application_id, api_key } = body;

  console.log(`[${requestId}] Testing TTN connection: cluster=${cluster}, app=${application_id}`);

  // Validate required fields
  if (!cluster) {
    return buildResponse({
      ok: false,
      error: 'Cluster is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  if (!VALID_CLUSTERS.includes(cluster as TTNCluster)) {
    return buildResponse({
      ok: false,
      error: `Invalid cluster. Use: ${VALID_CLUSTERS.join(' or ')}`,
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  if (!application_id) {
    return buildResponse({
      ok: false,
      error: 'Application ID is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  if (!api_key) {
    return buildResponse({
      ok: false,
      error: 'API Key is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  const baseUrl = getBaseUrl(cluster);

  // ONLY call GET /api/v3/applications/{application_id}
  // This is the ONLY validation we perform
  console.log(`[${requestId}] Fetching application: ${baseUrl}/api/v3/applications/${application_id}`);
  
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v3/applications/${application_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Accept': 'application/json',
      },
    });
  } catch (fetchError: unknown) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown network error';
    console.error(`[${requestId}] Network error:`, errorMsg);
    return buildResponse({
      ok: false,
      error: 'Network error connecting to TTN',
      code: 'NETWORK_ERROR',
      hint: `Could not reach ${baseUrl}. Check internet connection.`,
      baseUrl,
    }, 200, requestId);
  }

  const status = response.status;
  console.log(`[${requestId}] TTN response status: ${status}`);

  // Parse response body for error details
  let ttnMessage = '';
  let ttnCode = '';
  try {
    const responseBody = await response.json();
    ttnMessage = responseBody.message || responseBody.error || '';
    ttnCode = responseBody.code || '';
    console.log(`[${requestId}] TTN response:`, { message: ttnMessage, code: ttnCode });
  } catch {
    console.log(`[${requestId}] Could not parse TTN response body`);
  }

  // Handle response codes
  if (status === 200) {
    // SUCCESS
    console.log(`[${requestId}] TTN connection successful`);
    return buildResponse({
      ok: true,
      connected: true,
      baseUrl,
      application_id,
      cluster,
      message: 'Connected to The Things Network',
      required_permissions: REQUIRED_PERMISSIONS,
    }, 200, requestId);
  }

  if (status === 401) {
    // Invalid or expired API key
    return buildResponse({
      ok: false,
      error: 'Invalid or expired API key',
      code: 'AUTH_INVALID',
      hint: 'Generate a new API key in TTN Console → Applications → API keys',
      ttn_status: status,
      ttn_message: ttnMessage,
      baseUrl,
    }, 200, requestId);
  }

  if (status === 403) {
    // API key lacks permissions
    return buildResponse({
      ok: false,
      error: 'API key missing required permissions',
      code: 'PERMISSION_DENIED',
      hint: `Your API key needs these permissions: ${REQUIRED_PERMISSIONS.join(', ')}. Edit the key in TTN Console.`,
      ttn_status: status,
      ttn_message: ttnMessage,
      baseUrl,
    }, 200, requestId);
  }

  if (status === 404) {
    // Application not found - could be wrong cluster
    return buildResponse({
      ok: false,
      error: `Application "${application_id}" not found in ${cluster} cluster`,
      code: 'NOT_FOUND',
      hint: 'Check the Application ID in TTN Console. If correct, verify you selected the right cluster region.',
      cluster_hint: `Application may exist in a different region. Try switching cluster.`,
      ttn_status: status,
      ttn_message: ttnMessage,
      baseUrl,
    }, 200, requestId);
  }

  // Unknown error
  return buildResponse({
    ok: false,
    error: `TTN returned status ${status}`,
    code: 'TTN_ERROR',
    hint: ttnMessage || 'Check TTN Console for more details',
    ttn_status: status,
    ttn_message: ttnMessage,
    baseUrl,
  }, 200, requestId);
}

// Check application permissions by calling the rights endpoint
async function handleCheckAppPermissions(
  body: Partial<TTNSettingsRequest>,
  requestId: string
): Promise<Response> {
  const { cluster, application_id, api_key } = body;

  console.log(`[${requestId}] Checking app permissions: cluster=${cluster}, app=${application_id}`);

  // Validate required fields
  if (!cluster || !VALID_CLUSTERS.includes(cluster as TTNCluster)) {
    return buildResponse({
      ok: false,
      error: 'Valid cluster is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  if (!application_id) {
    return buildResponse({
      ok: false,
      error: 'Application ID is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  if (!api_key) {
    return buildResponse({
      ok: false,
      error: 'API Key is required',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  const baseUrl = getBaseUrl(cluster);
  const rightsUrl = `${baseUrl}/api/v3/applications/${application_id}/rights`;

  console.log(`[${requestId}] Fetching rights: ${rightsUrl}`);

  let response: Response;
  try {
    response = await fetch(rightsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Accept': 'application/json',
      },
    });
  } catch (fetchError: unknown) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown network error';
    console.error(`[${requestId}] Network error:`, errorMsg);
    return buildResponse({
      ok: false,
      error: 'Network error connecting to TTN',
      code: 'NETWORK_ERROR',
      hint: `Could not reach ${baseUrl}. Check internet connection.`,
    }, 200, requestId);
  }

  const status = response.status;
  console.log(`[${requestId}] TTN rights response status: ${status}`);

  if (status !== 200) {
    // Handle error cases
    let ttnMessage = '';
    try {
      const errorBody = await response.json();
      ttnMessage = errorBody.message || errorBody.error || '';
    } catch { /* ignore */ }

    if (status === 401) {
      return buildResponse({
        ok: false,
        error: 'Invalid or expired API key',
        code: 'AUTH_INVALID',
        hint: 'Generate a new API key in TTN Console',
      }, 200, requestId);
    }

    if (status === 403) {
      return buildResponse({
        ok: false,
        error: 'API key cannot access this application',
        code: 'PERMISSION_DENIED',
        hint: 'Ensure the API key is scoped to this application',
      }, 200, requestId);
    }

    return buildResponse({
      ok: false,
      error: `TTN returned status ${status}`,
      code: 'TTN_ERROR',
      hint: ttnMessage || 'Check TTN Console',
    }, 200, requestId);
  }

  // Parse the rights response
  let rightsData: { rights?: string[] } = {};
  try {
    rightsData = await response.json();
  } catch (parseErr) {
    console.error(`[${requestId}] Failed to parse rights response:`, parseErr);
    return buildResponse({
      ok: false,
      error: 'Failed to parse TTN response',
      code: 'PARSE_ERROR',
    }, 200, requestId);
  }

  const rights = rightsData.rights || [];
  console.log(`[${requestId}] Rights granted: ${rights.length}`, rights);

  // Define required permissions with user-friendly labels
  const requiredPermissions = [
    { 
      key: TTN_RIGHTS.APP_INFO_READ, 
      label: 'Read application info', 
      required: true,
      description: 'View application settings'
    },
    { 
      key: TTN_RIGHTS.APP_DEVICES_READ, 
      label: 'Read devices', 
      required: true,
      description: 'List and view device information'
    },
    { 
      key: TTN_RIGHTS.APP_DEVICES_WRITE, 
      label: 'Write devices', 
      required: true,
      description: 'Register and configure devices'
    },
    { 
      key: TTN_RIGHTS.APP_TRAFFIC_DOWN_WRITE, 
      label: 'Write downlink traffic', 
      required: true,
      description: 'Required for simulation (simulate uplinks)'
    },
  ];

  // Check each permission
  const permissions = requiredPermissions.map(perm => ({
    key: perm.key,
    label: perm.label,
    description: perm.description,
    required: perm.required,
    granted: rights.includes(perm.key),
  }));

  const missingPermissions = permissions.filter(p => p.required && !p.granted);
  const allPermissionsOk = missingPermissions.length === 0;

  console.log(`[${requestId}] Permission check: all_ok=${allPermissionsOk}, missing=${missingPermissions.length}`);

  return buildResponse({
    ok: allPermissionsOk,
    connected: true,
    permissions,
    missing: missingPermissions.map(p => p.label),
    rights_count: rights.length,
    can_simulate: permissions.find(p => p.key === TTN_RIGHTS.APP_TRAFFIC_DOWN_WRITE)?.granted || false,
    hint: allPermissionsOk 
      ? undefined 
      : `Missing permissions: ${missingPermissions.map(p => p.label).join(', ')}. Edit your API key in TTN Console to add these permissions.`,
    cluster,
    application_id,
  }, 200, requestId);
}

// Check if device exists in TTN
async function handleCheckDevice(
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { cluster, application_id, api_key, device_id } = body;

  console.log(`[${requestId}] Checking device: cluster=${cluster}, app=${application_id}, device=${device_id}`);

  if (!cluster || !application_id || !api_key || !device_id) {
    return buildResponse({
      ok: false,
      error: 'Missing required fields: cluster, application_id, api_key, device_id',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  const baseUrl = getBaseUrl(cluster);
  const checkUrl = `${baseUrl}/api/v3/applications/${application_id}/devices/${device_id}`;

  try {
    const response = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Accept': 'application/json',
      },
    });

    const exists = response.status === 200;
    console.log(`[${requestId}] Device check result: status=${response.status}, exists=${exists}`);

    return buildResponse({
      ok: true,
      exists,
      device_id,
      status: response.status,
    }, 200, requestId);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[${requestId}] Device check error:`, errorMsg);
    return buildResponse({
      ok: false,
      error: `Network error: ${errorMsg}`,
      code: 'NETWORK_ERROR',
      exists: false,
      device_id,
    }, 200, requestId);
  }
}

// Check if gateway exists in TTN
async function handleCheckGateway(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { cluster, gateway_id, org_id } = body;

  console.log(`[${requestId}] Checking gateway: cluster=${cluster}, gateway=${gateway_id}`);

  if (!cluster || !gateway_id) {
    return buildResponse({
      ok: false,
      error: 'Missing required fields: cluster, gateway_id',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  // Load API key from settings
  let apiKey: string | null = null;
  if (org_id) {
    const { data } = await supabase
      .from('ttn_settings')
      .select('api_key')
      .eq('org_id', org_id)
      .maybeSingle();
    apiKey = data?.api_key || null;
  }
  apiKey = apiKey || Deno.env.get('TTN_API_KEY') || null;

  if (!apiKey) {
    return buildResponse({
      ok: false,
      error: 'No API key configured',
      code: 'NO_API_KEY',
    }, 200, requestId);
  }

  const baseUrl = getBaseUrl(cluster);
  const checkUrl = `${baseUrl}/api/v3/gateways/${gateway_id}`;

  try {
    const response = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    const exists = response.status === 200;
    console.log(`[${requestId}] Gateway check result: status=${response.status}, exists=${exists}`);

    return buildResponse({
      ok: true,
      exists,
      gateway_id,
      status: response.status,
    }, 200, requestId);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[${requestId}] Gateway check error:`, errorMsg);
    return buildResponse({
      ok: false,
      error: `Network error: ${errorMsg}`,
      code: 'NETWORK_ERROR',
      exists: false,
      gateway_id,
    }, 200, requestId);
  }
}

// Helper function to check if owner ID looks like an invalid internal ID
function looksLikeInternalId(ownerId: string | null): boolean {
  if (!ownerId) return false;
  // FrostGuard internal IDs look like: fg-org-7873654e-wu0 or full UUIDs
  return ownerId.includes('fg-org-') || 
         ownerId.includes('fg-user-') || 
         /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ownerId);
}

// Discover gateway owner from TTN API (organizations or users the API key can access)
async function discoverGatewayOwnerInternal(
  apiKey: string,
  cluster: string,
  requestId: string
): Promise<{ ok: boolean; owner_type?: 'user' | 'organization'; owner_id?: string; all_organizations?: string[]; hint?: string }> {
  // Identity Server endpoints are ALWAYS on eu1, regardless of regional cluster
  const identityBaseUrl = 'https://eu1.cloud.thethings.network';

  // Try organizations first - most common for gateway management
  try {
    const orgsUrl = `${identityBaseUrl}/api/v3/organizations?limit=10`;
    console.log(`[${requestId}] Discovery: Checking organizations at ${orgsUrl}`);
    const orgsResponse = await fetch(orgsUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });

    if (orgsResponse.ok) {
      const orgsData = await orgsResponse.json();
      if (orgsData.organizations?.length > 0) {
        const orgIds = orgsData.organizations.map((o: any) => o.ids?.organization_id).filter(Boolean);
        console.log(`[${requestId}] Discovery: Found ${orgIds.length} organizations: ${orgIds.join(', ')}`);
        return {
          ok: true,
          owner_type: 'organization',
          owner_id: orgIds[0],
          all_organizations: orgIds,
        };
      }
    } else {
      console.log(`[${requestId}] Discovery: Organizations check returned ${orgsResponse.status}`);
    }
  } catch (e) {
    console.log(`[${requestId}] Discovery: Organizations check failed:`, e);
  }

  // Try user info for personal API keys, or org info for org API keys
  try {
    // The /api/v3/auth_info endpoint returns info about the current auth context
    const authInfoUrl = `${identityBaseUrl}/api/v3/auth_info`;
    console.log(`[${requestId}] Discovery: Checking auth info at ${authInfoUrl}`);
    const authInfoResponse = await fetch(authInfoUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });

    if (authInfoResponse.ok) {
      const authInfo = await authInfoResponse.json();
      console.log(`[${requestId}] Discovery: Auth info response:`, JSON.stringify(authInfo));
      
      // Check for organization API key (entity_ids.organization_ids.organization_id)
      const orgId = authInfo.api_key?.entity_ids?.organization_ids?.organization_id;
      if (orgId) {
        console.log(`[${requestId}] Discovery: Found organization ID from API key: ${orgId}`);
        return {
          ok: true,
          owner_type: 'organization',
          owner_id: orgId,
        };
      }
      
      // Check for user API key
      const userId = authInfo.oauth_access_token?.user_ids?.user_id || 
                     authInfo.user?.ids?.user_id ||
                     authInfo.api_key?.entity_ids?.user_ids?.user_id ||
                     authInfo.user_id;
      
      if (userId) {
        console.log(`[${requestId}] Discovery: Found user ID: ${userId}`);
        return {
          ok: true,
          owner_type: 'user',
          owner_id: userId,
        };
      }
    } else {
      console.log(`[${requestId}] Discovery: Auth info returned ${authInfoResponse.status}`);
    }
  } catch (e) {
    console.log(`[${requestId}] Discovery: Auth info check failed:`, e);
  }

  return {
    ok: false,
    hint: 'Could not determine API key owner. Enter your TTN username or organization ID manually.',
  };
}

// Handle explicit discover_gateway_owner action
async function handleDiscoverGatewayOwner(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, cluster, gateway_api_key } = body;

  console.log(`[${requestId}] Discover gateway owner for org ${org_id || 'none'}`);

  // Get the API key (from request or stored)
  let apiKey = gateway_api_key;
  if (!apiKey && org_id) {
    const { data } = await supabase
      .from('ttn_settings')
      .select('gateway_api_key, api_key')
      .eq('org_id', org_id)
      .maybeSingle();
    apiKey = data?.gateway_api_key || data?.api_key;
  }

  if (!apiKey) {
    return buildResponse({ 
      ok: false, 
      error: 'No API key provided',
      code: 'NO_API_KEY',
    }, 200, requestId);
  }

  const ttnCluster = cluster || 'nam1';
  const result = await discoverGatewayOwnerInternal(apiKey, ttnCluster, requestId);

  return buildResponse({
    ok: result.ok,
    discovered: result.ok,
    owner_type: result.owner_type,
    owner_id: result.owner_id,
    all_organizations: result.all_organizations,
    hint: result.hint,
    cluster: ttnCluster,
  }, 200, requestId);
}

// Check gateway-specific permissions (gateways:read, gateways:write)
// Uses the ACTUAL owner-scoped endpoint that provisioning will use
async function handleCheckGatewayPermissions(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, cluster } = body;

  console.log(`[${requestId}] Checking gateway permissions for org ${org_id || 'none'}`);

  // Load settings including gateway owner config AND gateway-specific API key
  let gatewayApiKey: string | null = null;
  let appApiKey: string | null = null;
  let ttnCluster = cluster || 'nam1';
  let gatewayOwnerType: 'user' | 'organization' = 'user';
  let gatewayOwnerId: string | null = null;

  if (org_id) {
    const { data } = await supabase
      .from('ttn_settings')
      .select('api_key, gateway_api_key, cluster, gateway_owner_type, gateway_owner_id')
      .eq('org_id', org_id)
      .maybeSingle();

    gatewayApiKey = data?.gateway_api_key || null;
    appApiKey = data?.api_key || null;
    ttnCluster = cluster || data?.cluster || 'nam1';
    gatewayOwnerType = data?.gateway_owner_type || 'user';
    gatewayOwnerId = data?.gateway_owner_id || null;
  }

  // Prefer gateway-specific API key over application API key
  const apiKey = gatewayApiKey || appApiKey;
  const usingGatewayKey = !!gatewayApiKey;

  if (!apiKey) {
    return buildResponse({
      ok: false,
      error: 'No API key configured',
      code: 'NO_API_KEY',
      hint: 'Configure a Gateway API Key (Personal or Organization API key) with gateways:read and gateways:write permissions.',
      permissions: { gateway_read: false, gateway_write: false },
    }, 200, requestId);
  }

  // If no gateway-specific key is configured, warn the user
  if (!usingGatewayKey) {
    console.log(`[${requestId}] No gateway-specific API key configured, using application API key`);
  }

  // Auto-discovery: If owner ID is missing or looks like an internal FrostGuard ID, discover it
  let discoveredOwner: { ok: boolean; owner_type?: 'user' | 'organization'; owner_id?: string; all_organizations?: string[] } | null = null;
  
  if (!gatewayOwnerId || looksLikeInternalId(gatewayOwnerId)) {
    console.log(`[${requestId}] Owner ID missing or looks invalid (${gatewayOwnerId}), attempting auto-discovery`);
    discoveredOwner = await discoverGatewayOwnerInternal(apiKey, ttnCluster, requestId);
    
    if (discoveredOwner.ok && discoveredOwner.owner_id) {
      console.log(`[${requestId}] Auto-discovered owner: ${discoveredOwner.owner_type}/${discoveredOwner.owner_id}`);
      gatewayOwnerType = discoveredOwner.owner_type!;
      gatewayOwnerId = discoveredOwner.owner_id!;
    }
  }

  // Check if gateway owner is configured (after potential discovery)
  if (!gatewayOwnerId) {
    return buildResponse({
      ok: false,
      error: 'Gateway owner not configured and could not be auto-discovered',
      code: 'CONFIG_MISSING',
      hint: 'Set your TTN username or organization ID in Webhook Settings → Gateway Owner section',
      permissions: { gateway_read: false, gateway_write: false },
      diagnostics: {
        cluster: ttnCluster,
        gateway_owner_type: gatewayOwnerType,
        gateway_owner_id: null,
        fix_required: 'Configure gateway_owner_id',
      },
    }, 200, requestId);
  }

  const baseUrl = getBaseUrl(ttnCluster);
  
  // Build the owner-scoped endpoint path (same path that provisioning will use)
  const ownerPath = gatewayOwnerType === 'organization'
    ? `organizations/${gatewayOwnerId}`
    : `users/${gatewayOwnerId}`;

  console.log(`[${requestId}] Testing gateway permissions for ${gatewayOwnerType}/${gatewayOwnerId}`);

  // Test 1: Gateway list access (gateways:read) using owner-scoped endpoint
  let canReadGateways = false;
  let readError = '';
  let readStatus = 0;
  try {
    const readUrl = `${baseUrl}/api/v3/${ownerPath}/gateways?limit=1`;
    console.log(`[${requestId}] Testing gateway read: ${readUrl}`);
    const listResponse = await fetch(readUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    readStatus = listResponse.status;
    canReadGateways = listResponse.status === 200;
    
    if (listResponse.status === 403) {
      const body = await listResponse.json().catch(() => ({}));
      // Check if it's an application-scoped key
      if (body.message?.includes('no rights') || body.message?.includes('permission')) {
        readError = 'API key lacks gateways:read permission. You may be using an Application API key instead of a Personal/Organization API key.';
      } else {
        readError = 'API key lacks gateways:read permission';
      }
    } else if (listResponse.status === 401) {
      readError = 'API key invalid or expired';
    } else if (listResponse.status === 404) {
      readError = `User/Organization "${gatewayOwnerId}" not found. Check your Gateway Owner ID.`;
    }
    console.log(`[${requestId}] Gateway read check: status=${listResponse.status}, passed=${canReadGateways}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    readError = `Network error: ${msg}`;
    console.error(`[${requestId}] Gateway read check failed:`, msg);
  }

  // Test 2: Gateway write access using the SAME owner-scoped endpoint provisioning will use
  let canWriteGateways = false;
  let writeError = '';
  let writeStatus = 0;
  try {
    const writeUrl = `${baseUrl}/api/v3/${ownerPath}/gateways`;
    console.log(`[${requestId}] Testing gateway write: ${writeUrl}`);
    
    // POST with a test gateway ID - we expect:
    // - 400 = bad request (missing required fields) but HAS permission
    // - 403 = forbidden (NO permission)
    // - 409 = conflict (gateway exists) = HAS permission
    const testGatewayId = `permission-check-${Date.now()}`;
    const writeTestResponse = await fetch(writeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gateway: {
          ids: { gateway_id: testGatewayId },
          // Missing required fields like frequency_plan_id, gateway_server_address
          // This should trigger a 400 if we have permission, 403 if not
        }
      }),
    });
    
    writeStatus = writeTestResponse.status;

    // 400 = bad request means we have permission but invalid payload
    // 409 = conflict means gateway exists (so we have permission)
    // 403 = forbidden means no write permission
    // 401 = invalid auth
    if (writeTestResponse.status === 400 || writeTestResponse.status === 409) {
      canWriteGateways = true;
    } else if (writeTestResponse.status === 403) {
      const body = await writeTestResponse.json().catch(() => ({}));
      if (body.message?.includes('no rights') || body.message?.includes('permission')) {
        writeError = 'API key lacks gateways:write permission. You may be using an Application API key instead of a Personal/Organization API key.';
      } else {
        writeError = 'API key lacks gateways:write permission';
      }
    } else if (writeTestResponse.status === 401) {
      writeError = 'API key invalid or expired';
    } else if (writeTestResponse.status === 404) {
      writeError = `User/Organization "${gatewayOwnerId}" not found. Check your Gateway Owner ID.`;
    } else if (writeTestResponse.status === 200 || writeTestResponse.status === 201) {
      // Shouldn't happen but treat as success
      canWriteGateways = true;
    }
    console.log(`[${requestId}] Gateway write check: status=${writeTestResponse.status}, passed=${canWriteGateways}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    writeError = `Network error: ${msg}`;
    console.error(`[${requestId}] Gateway write check failed:`, msg);
  }

  const allPermissionsOk = canReadGateways && canWriteGateways;

  console.log(`[${requestId}] Gateway permissions: read=${canReadGateways}, write=${canWriteGateways}, overall=${allPermissionsOk}, using_gateway_key=${usingGatewayKey}`);

  // Build hint based on failure type
  let hint = undefined;
  if (!allPermissionsOk) {
    if (!usingGatewayKey) {
      // No gateway-specific key configured - this is the most likely cause
      hint = 'You are using an Application API key which cannot have gateway permissions. Configure a separate Gateway API Key in Webhook Settings → Gateway Configuration. Use a Personal or Organization API key from TTN Console with gateways:read and gateways:write rights.';
    } else if (readError.includes('Application API key') || writeError.includes('Application API key')) {
      hint = 'The Gateway API Key appears to be an Application key. Use a Personal API Key (TTN Console → User Settings → API Keys) or Organization API Key with gateways:read and gateways:write permissions.';
    } else if (readError.includes('not found') || writeError.includes('not found')) {
      hint = `The Gateway Owner ID "${gatewayOwnerId}" was not found. Verify your TTN username or organization ID in Webhook Settings.`;
    } else {
      hint = 'The Gateway API Key is missing gateways:read and gateways:write permissions. Update the key in TTN Console or create a new one with these rights.';
    }
  }

  return buildResponse({
    ok: allPermissionsOk,
    connected: true,
    permissions: {
      gateway_read: canReadGateways,
      gateway_write: canWriteGateways,
    },
    error: allPermissionsOk ? undefined : 'Missing gateway permissions',
    hint,
    using_gateway_key: usingGatewayKey,
    // Include discovered owner info if auto-discovery was performed
    discovered: !!discoveredOwner?.ok,
    discovered_owner_type: discoveredOwner?.ok ? discoveredOwner.owner_type : undefined,
    discovered_owner_id: discoveredOwner?.ok ? discoveredOwner.owner_id : undefined,
    all_discovered_organizations: discoveredOwner?.all_organizations,
    diagnostics: {
      cluster: ttnCluster,
      gateway_owner_type: gatewayOwnerType,
      gateway_owner_id: gatewayOwnerId,
      gateway_read_status: readStatus,
      gateway_read_passed: canReadGateways,
      gateway_read_error: readError || undefined,
      gateway_write_status: writeStatus,
      gateway_write_passed: canWriteGateways,
      gateway_write_error: writeError || undefined,
      api_key_type: usingGatewayKey ? 'gateway_api_key' : 'application_api_key',
      api_key_last4: apiKey.slice(-4),
      auto_discovered: !!discoveredOwner?.ok,
    },
  }, 200, requestId);
}
