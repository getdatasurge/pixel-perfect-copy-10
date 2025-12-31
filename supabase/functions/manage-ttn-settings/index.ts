import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supported TTN clusters - simplified to main regions
const VALID_CLUSTERS = ['eu1', 'nam1'] as const;
type TTNCluster = typeof VALID_CLUSTERS[number];

// Required permissions for display (informational only)
const REQUIRED_PERMISSIONS = ['applications:read', 'devices:read', 'devices:write'];

interface TTNSettingsRequest {
  action: 'load' | 'save' | 'test' | 'test_stored' | 'check_device' | 'check_gateway';
  org_id?: string;
  site_id?: string; // NEW: optional site_id for site-scoped settings
  enabled?: boolean;
  cluster?: TTNCluster;
  application_id?: string;
  api_key?: string;
  webhook_secret?: string;
  device_id?: string;
  gateway_id?: string;
}

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
    return new Response(null, { headers: corsHeaders });
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

    const { action, org_id, site_id } = body;
    console.log(`[${requestId}] Action: ${action}, org_id: ${org_id || 'none'}, site_id: ${site_id || 'none'}`);

    // Process action
    switch (action) {
      case 'load':
        return await handleLoad(supabaseAdmin, org_id, site_id, requestId);

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

// Load TTN settings for org (with optional site-level override)
async function handleLoad(
  supabase: any,
  org_id: string | undefined,
  site_id: string | undefined,
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
        webhook_secret_preview: null,
        webhook_secret_set: false,
      },
      scope: 'none',
    }, 200, requestId);
  }

  console.log(`[${requestId}] Loading settings for org ${org_id}, site ${site_id || 'none'}`);

  let data: any = null;
  let scope = 'org';

  // Step 1: Try to load site-specific settings if site_id provided
  if (site_id) {
    console.log(`[${requestId}] Checking for site-specific settings...`);
    const { data: siteData, error: siteError } = await supabase
      .from('ttn_settings')
      .select('enabled, cluster, application_id, api_key, webhook_secret, updated_at, last_test_at, last_test_success, site_id')
      .eq('org_id', org_id)
      .eq('site_id', site_id)
      .maybeSingle();

    if (!siteError && siteData) {
      console.log(`[${requestId}] Found site-specific settings`);
      data = siteData;
      scope = 'site';
    }
  }

  // Step 2: Fall back to org-level settings if no site-specific found
  if (!data) {
    console.log(`[${requestId}] Loading org-level settings...`);
    const { data: orgData, error: orgError } = await supabase
      .from('ttn_settings')
      .select('enabled, cluster, application_id, api_key, webhook_secret, updated_at, last_test_at, last_test_success, site_id')
      .eq('org_id', org_id)
      .is('site_id', null)
      .maybeSingle();

    if (orgError) {
      console.error(`[${requestId}] Load error:`, orgError.message);
      return errorResponse('Failed to load settings', 'DB_ERROR', 500, requestId);
    }

    data = orgData;
    scope = 'org';
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
        webhook_secret_preview: null,
        webhook_secret_set: false,
        last_test_at: null,
        last_test_success: null,
      },
      scope: 'none',
    }, 200, requestId);
  }

  const hasApiKey = !!(data.api_key && data.api_key.length > 0);
  const hasWebhookSecret = !!(data.webhook_secret && data.webhook_secret.length > 0);

  console.log(`[${requestId}] Returning settings from scope: ${scope}`);

  return buildResponse({
    ok: true,
    settings: {
      enabled: data.enabled,
      cluster: data.cluster,
      application_id: data.application_id,
      api_key_preview: maskSecret(data.api_key),
      api_key_set: hasApiKey,
      webhook_secret_preview: maskSecret(data.webhook_secret),
      webhook_secret_set: hasWebhookSecret,
      updated_at: data.updated_at,
      last_test_at: data.last_test_at,
      last_test_success: data.last_test_success,
    },
    scope,
  }, 200, requestId);
}

// Save TTN settings for org (with optional site-level)
async function handleSave(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, site_id, enabled, cluster, application_id, api_key, webhook_secret } = body;

  if (!org_id) {
    return errorResponse('org_id is required to save settings', 'VALIDATION_ERROR', 400, requestId);
  }

  const scope = site_id ? 'site' : 'org';
  console.log(`[${requestId}] Saving settings for org ${org_id}, site ${site_id || 'none'} (scope: ${scope}), enabled=${enabled}, cluster=${cluster}, app=${application_id}`);

  // Check if we have an existing row for this org+site combo
  let existingQuery = supabase
    .from('ttn_settings')
    .select('id, api_key')
    .eq('org_id', org_id);
  
  if (site_id) {
    existingQuery = existingQuery.eq('site_id', site_id);
  } else {
    existingQuery = existingQuery.is('site_id', null);
  }

  const { data: existingSettings } = await existingQuery.maybeSingle();
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

  // Build upsert data
  const upsertData: Record<string, any> = {
    org_id,
    site_id: site_id || null,
    enabled: enabled ?? false,
    cluster: cluster ?? 'nam1',
    application_id: application_id ?? null,
  };

  // Only update secrets if new values provided
  if (api_key) {
    upsertData.api_key = api_key;
  }
  if (webhook_secret) {
    upsertData.webhook_secret = webhook_secret;
  }

  let error: any;
  
  if (existingSettings?.id) {
    // Update existing row
    const { error: updateError } = await supabase
      .from('ttn_settings')
      .update(upsertData)
      .eq('id', existingSettings.id);
    error = updateError;
  } else {
    // Insert new row
    const { error: insertError } = await supabase
      .from('ttn_settings')
      .insert(upsertData);
    error = insertError;
  }

  if (error) {
    console.error(`[${requestId}] Save error:`, error.message);
    return errorResponse('Failed to save settings', 'DB_ERROR', 500, requestId);
  }

  // Reload settings to get the current state
  let reloadQuery = supabase
    .from('ttn_settings')
    .select('api_key, webhook_secret')
    .eq('org_id', org_id);
  
  if (site_id) {
    reloadQuery = reloadQuery.eq('site_id', site_id);
  } else {
    reloadQuery = reloadQuery.is('site_id', null);
  }

  const { data: savedSettings } = await reloadQuery.maybeSingle();

  const apiKeySet = !!(savedSettings?.api_key && savedSettings.api_key.length > 0);
  const webhookSecretSet = !!(savedSettings?.webhook_secret && savedSettings.webhook_secret.length > 0);

  console.log(`[${requestId}] Settings saved successfully (scope: ${scope}), api_key_set=${apiKeySet}`);
  
  return buildResponse({ 
    ok: true, 
    message: 'Settings saved',
    scope,
    api_key_set: apiKeySet,
    api_key_preview: maskSecret(savedSettings?.api_key),
    webhook_secret_set: webhookSecretSet,
    webhook_secret_preview: maskSecret(savedSettings?.webhook_secret),
  }, 200, requestId);
}

// Test TTN connection using stored API key from database
async function handleTestStored(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, site_id } = body;

  if (!org_id) {
    return buildResponse({
      ok: false,
      error: 'org_id is required to test stored settings',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  console.log(`[${requestId}] Testing stored TTN settings for org ${org_id}, site ${site_id || 'none'}`);

  // Step 1: Try site-specific settings first
  let settings: any = null;
  let scope = 'org';

  if (site_id) {
    const { data: siteSettings } = await supabase
      .from('ttn_settings')
      .select('enabled, cluster, application_id, api_key')
      .eq('org_id', org_id)
      .eq('site_id', site_id)
      .maybeSingle();

    if (siteSettings?.api_key) {
      settings = siteSettings;
      scope = 'site';
      console.log(`[${requestId}] Using site-specific settings`);
    }
  }

  // Step 2: Fall back to org-level settings
  if (!settings) {
    const { data: orgSettings, error } = await supabase
      .from('ttn_settings')
      .select('enabled, cluster, application_id, api_key')
      .eq('org_id', org_id)
      .is('site_id', null)
      .maybeSingle();

    if (error) {
      console.error(`[${requestId}] Failed to load settings:`, error.message);
      return buildResponse({
        ok: false,
        error: 'Failed to load TTN settings from database',
        code: 'DB_ERROR',
      }, 200, requestId);
    }

    settings = orgSettings;
  }

  if (!settings) {
    return buildResponse({
      ok: false,
      error: 'No TTN settings found for this organization',
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

  if (!settings.api_key) {
    return buildResponse({
      ok: false,
      error: 'No API key saved',
      code: 'NO_API_KEY',
      hint: 'Enter an API key and save settings first',
    }, 200, requestId);
  }

  // Now test with the stored credentials
  const result = await handleTest({
    cluster: settings.cluster,
    application_id: settings.application_id,
    api_key: settings.api_key,
  }, requestId);

  // Save test result to database (update the row we tested)
  const resultBody = await result.clone().json();
  const testSuccess = resultBody.ok && resultBody.connected === true;
  
  let updateQuery = supabase
    .from('ttn_settings')
    .update({
      last_test_at: new Date().toISOString(),
      last_test_success: testSuccess,
    })
    .eq('org_id', org_id);

  if (scope === 'site' && site_id) {
    updateQuery = updateQuery.eq('site_id', site_id);
  } else {
    updateQuery = updateQuery.is('site_id', null);
  }

  await updateQuery;

  console.log(`[${requestId}] Saved test result (scope: ${scope}): success=${testSuccess}`);
  
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
  const { cluster, gateway_id, org_id, site_id } = body;

  console.log(`[${requestId}] Checking gateway: cluster=${cluster}, gateway=${gateway_id}`);

  if (!cluster || !gateway_id) {
    return buildResponse({
      ok: false,
      error: 'Missing required fields: cluster, gateway_id',
      code: 'VALIDATION_ERROR',
    }, 200, requestId);
  }

  // Load API key from settings (site first, then org, then global)
  let apiKey: string | null = null;
  
  if (org_id) {
    // Try site-specific first
    if (site_id) {
      const { data: siteData } = await supabase
        .from('ttn_settings')
        .select('api_key')
        .eq('org_id', org_id)
        .eq('site_id', site_id)
        .maybeSingle();
      apiKey = siteData?.api_key || null;
    }
    
    // Fall back to org-level
    if (!apiKey) {
      const { data: orgData } = await supabase
        .from('ttn_settings')
        .select('api_key')
        .eq('org_id', org_id)
        .is('site_id', null)
        .maybeSingle();
      apiKey = orgData?.api_key || null;
    }
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
