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
  action: 'load' | 'save' | 'test';
  org_id?: string;
  enabled?: boolean;
  cluster?: TTNCluster;
  application_id?: string;
  api_key?: string;
  webhook_secret?: string;
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
        webhook_secret_preview: null,
      }
    }, 200, requestId);
  }

  console.log(`[${requestId}] Loading settings for org ${org_id}`);

  const { data, error } = await supabase
    .from('ttn_settings')
    .select('enabled, cluster, application_id, api_key, webhook_secret, updated_at')
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
        webhook_secret_preview: null,
      }
    }, 200, requestId);
  }

  return buildResponse({
    ok: true,
    settings: {
      enabled: data.enabled,
      cluster: data.cluster,
      application_id: data.application_id,
      api_key_preview: maskSecret(data.api_key),
      webhook_secret_preview: maskSecret(data.webhook_secret),
      updated_at: data.updated_at,
    }
  }, 200, requestId);
}

// Save TTN settings for org
async function handleSave(
  supabase: any,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, enabled, cluster, application_id, api_key, webhook_secret } = body;

  if (!org_id) {
    return errorResponse('org_id is required to save settings', 'VALIDATION_ERROR', 400, requestId);
  }

  console.log(`[${requestId}] Saving settings for org ${org_id}, enabled=${enabled}, cluster=${cluster}, app=${application_id}`);

  // Validate required fields when enabled
  if (enabled) {
    if (!application_id) {
      return errorResponse('Application ID is required when TTN is enabled', 'VALIDATION_ERROR', 400, requestId);
    }
    if (!api_key) {
      return errorResponse('API key is required when TTN is enabled', 'VALIDATION_ERROR', 400, requestId);
    }
    if (!cluster || !VALID_CLUSTERS.includes(cluster as TTNCluster)) {
      return errorResponse('Valid cluster (eu1 or nam1) is required', 'VALIDATION_ERROR', 400, requestId);
    }
  }

  const upsertData = {
    org_id,
    enabled: enabled ?? false,
    cluster: cluster ?? 'nam1',
    application_id: application_id ?? null,
    api_key: api_key ?? null,
    webhook_secret: webhook_secret ?? null,
  };

  const { error } = await supabase
    .from('ttn_settings')
    .upsert(upsertData, { onConflict: 'org_id' });

  if (error) {
    console.error(`[${requestId}] Save error:`, error.message);
    return errorResponse('Failed to save settings', 'DB_ERROR', 500, requestId);
  }

  console.log(`[${requestId}] Settings saved successfully`);
  return buildResponse({ ok: true, message: 'Settings saved' }, 200, requestId);
}

// Test TTN connection - SIMPLIFIED to only check application access
async function handleTest(
  body: TTNSettingsRequest,
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
