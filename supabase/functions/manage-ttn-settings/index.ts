import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Required TTN rights for full functionality
const REQUIRED_RIGHTS = [
  'RIGHT_APPLICATION_INFO',
  'RIGHT_APPLICATION_DEVICES_READ',
  'RIGHT_APPLICATION_DEVICES_WRITE',
];

interface TTNSettingsRequest {
  action: 'load' | 'save' | 'test';
  org_id: string;
  enabled?: boolean;
  cluster?: 'eu1' | 'nam1' | 'au1' | 'as1';
  application_id?: string;
  api_key?: string;
  webhook_secret?: string;
}

interface TTNSettings {
  enabled: boolean;
  cluster: string;
  application_id: string | null;
  api_key_preview: string | null; // Last 4 chars only
  webhook_secret_preview: string | null;
  updated_at: string;
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

// Error response helper
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
    // 1. Validate Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log(`[${requestId}] Missing Authorization header`);
      return errorResponse(
        'Authorization header required',
        'AUTH_MISSING',
        401,
        requestId
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      console.log(`[${requestId}] Empty bearer token`);
      return errorResponse(
        'Invalid authorization token',
        'AUTH_INVALID',
        401,
        requestId
      );
    }

    // 2. Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Verify user token
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.log(`[${requestId}] Invalid token: ${userError?.message || 'No user'}`);
      return errorResponse(
        'Invalid or expired token',
        'AUTH_INVALID',
        401,
        requestId
      );
    }

    console.log(`[${requestId}] Authenticated user: ${user.id}`);

    // 4. Parse request body
    let body: TTNSettingsRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse(
        'Invalid JSON body',
        'VALIDATION_ERROR',
        400,
        requestId
      );
    }

    const { action, org_id } = body;

    // 5. Validate org_id
    if (!org_id) {
      return errorResponse(
        'org_id is required',
        'VALIDATION_ERROR',
        400,
        requestId
      );
    }

    // 6. Check user is member of org
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', org_id)
      .maybeSingle();

    if (memberError) {
      console.error(`[${requestId}] Membership check error:`, memberError.message);
      return errorResponse(
        'Failed to verify organization membership',
        'DB_ERROR',
        500,
        requestId
      );
    }

    if (!membership) {
      console.log(`[${requestId}] User ${user.id} not member of org ${org_id}`);
      return errorResponse(
        'You are not a member of this organization',
        'NOT_MEMBER',
        403,
        requestId
      );
    }

    console.log(`[${requestId}] User ${user.id} has role '${membership.role}' in org ${org_id}`);

    // 7. Process action
    switch (action) {
      case 'load':
        return await handleLoad(supabaseAdmin, org_id, requestId);

      case 'save':
        return await handleSave(supabaseAdmin, org_id, body, requestId);

      case 'test':
        return await handleTest(body, requestId);

      default:
        return errorResponse(
          `Unknown action: ${action}`,
          'VALIDATION_ERROR',
          400,
          requestId
        );
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
  org_id: string,
  requestId: string
): Promise<Response> {
  console.log(`[${requestId}] Loading settings for org ${org_id}`);

  const { data, error } = await supabase
    .from('ttn_settings')
    .select('enabled, cluster, application_id, api_key, webhook_secret, updated_at')
    .eq('org_id', org_id)
    .maybeSingle();

  if (error) {
    console.error(`[${requestId}] Load error:`, error.message);
    return errorResponse(
      'Failed to load settings',
      'DB_ERROR',
      500,
      requestId
    );
  }

  if (!data) {
    // No settings exist yet, return defaults
    const settings: TTNSettings = {
      enabled: false,
      cluster: 'eu1',
      application_id: null,
      api_key_preview: null,
      webhook_secret_preview: null,
      updated_at: new Date().toISOString(),
    };
    return buildResponse({ ok: true, settings }, 200, requestId);
  }

  const settings: TTNSettings = {
    enabled: data.enabled,
    cluster: data.cluster,
    application_id: data.application_id,
    api_key_preview: maskSecret(data.api_key),
    webhook_secret_preview: maskSecret(data.webhook_secret),
    updated_at: data.updated_at,
  };

  return buildResponse({ ok: true, settings }, 200, requestId);
}

// Save TTN settings for org
async function handleSave(
  supabase: any,
  org_id: string,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { enabled, cluster, application_id, api_key, webhook_secret } = body;

  console.log(`[${requestId}] Saving settings for org ${org_id}, enabled=${enabled}, cluster=${cluster}, app=${application_id}`);

  // Validate required fields when enabled
  if (enabled) {
    if (!application_id) {
      return errorResponse(
        'Application ID is required when TTN is enabled',
        'VALIDATION_ERROR',
        400,
        requestId
      );
    }
    if (!api_key) {
      return errorResponse(
        'API key is required when TTN is enabled',
        'VALIDATION_ERROR',
        400,
        requestId
      );
    }
    if (!cluster) {
      return errorResponse(
        'Cluster is required when TTN is enabled',
        'VALIDATION_ERROR',
        400,
        requestId
      );
    }
  }

  const upsertData = {
    org_id,
    enabled: enabled ?? false,
    cluster: cluster ?? 'eu1',
    application_id: application_id ?? null,
    api_key: api_key ?? null,
    webhook_secret: webhook_secret ?? null,
  };

  const { error } = await supabase
    .from('ttn_settings')
    .upsert(upsertData, { onConflict: 'org_id' });

  if (error) {
    console.error(`[${requestId}] Save error:`, error.message);
    return errorResponse(
      'Failed to save settings',
      'DB_ERROR',
      500,
      requestId
    );
  }

  console.log(`[${requestId}] Settings saved successfully`);
  return buildResponse({ ok: true, message: 'Settings saved' }, 200, requestId);
}

// Test TTN connection
async function handleTest(
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { cluster, application_id, api_key } = body;

  console.log(`[${requestId}] Testing TTN connection: cluster=${cluster}, app=${application_id}`);

  // Validate required fields
  if (!cluster) {
    return errorResponse(
      'Cluster is required for testing',
      'VALIDATION_ERROR',
      400,
      requestId
    );
  }
  if (!application_id) {
    return errorResponse(
      'Application ID is required for testing',
      'VALIDATION_ERROR',
      400,
      requestId
    );
  }
  if (!api_key) {
    return errorResponse(
      'API key is required for testing',
      'VALIDATION_ERROR',
      400,
      requestId
    );
  }

  const baseUrl = `https://${cluster}.cloud.thethings.network`;

  // Step 1: Fetch application info
  console.log(`[${requestId}] Step 1: Fetching application info`);
  let appResponse: Response;
  try {
    appResponse = await fetch(
      `${baseUrl}/api/v3/applications/${application_id}`,
      {
        headers: {
          'Authorization': `Bearer ${api_key}`,
          'Accept': 'application/json',
        },
      }
    );
  } catch (fetchError) {
    console.error(`[${requestId}] Network error fetching application:`, fetchError);
    return buildResponse(
      {
        ok: false,
        step: 'fetch_application',
        ttn_status: 0,
        ttn_message: 'Network error connecting to TTN',
        hint: `Could not reach ${baseUrl}. Check your internet connection and cluster selection.`,
      },
      200, // Return 200 so UI can parse the JSON
      requestId
    );
  }

  if (!appResponse.ok) {
    const ttnStatus = appResponse.status;
    let ttnMessage = appResponse.statusText;
    let hint = '';

    try {
      const errorBody = await appResponse.json();
      ttnMessage = errorBody.message || errorBody.error || ttnMessage;
    } catch {
      // Ignore parse error
    }

    if (ttnStatus === 401) {
      hint = 'API key is invalid or expired. Generate a new key in TTN Console → API keys.';
    } else if (ttnStatus === 403) {
      hint = 'API key lacks permission to read this application. Check key rights in TTN Console.';
    } else if (ttnStatus === 404) {
      hint = `Application "${application_id}" not found. Verify the Application ID in TTN Console.`;
    } else {
      hint = 'Check TTN Console for more details.';
    }

    console.log(`[${requestId}] TTN returned ${ttnStatus}: ${ttnMessage}`);

    return buildResponse(
      {
        ok: false,
        step: 'fetch_application',
        ttn_status: ttnStatus,
        ttn_message: ttnMessage,
        hint,
        baseUrl,
        application_id,
      },
      200,
      requestId
    );
  }

  console.log(`[${requestId}] Application found successfully`);

  // Step 2: Check application rights
  console.log(`[${requestId}] Step 2: Checking application rights`);
  let rightsResponse: Response;
  try {
    rightsResponse = await fetch(
      `${baseUrl}/api/v3/applications/${application_id}/rights`,
      {
        headers: {
          'Authorization': `Bearer ${api_key}`,
          'Accept': 'application/json',
        },
      }
    );
  } catch (fetchError) {
    console.error(`[${requestId}] Network error fetching rights:`, fetchError);
    // Application exists but couldn't check rights - still a success with warning
    return buildResponse(
      {
        ok: true,
        baseUrl,
        application_id,
        rights_ok: false,
        rights_check_failed: true,
        hint: 'Application found but could not verify rights. Connection should work.',
      },
      200,
      requestId
    );
  }

  if (!rightsResponse.ok) {
    // Rights endpoint may not be accessible, treat as partial success
    console.log(`[${requestId}] Could not fetch rights: ${rightsResponse.status}`);
    return buildResponse(
      {
        ok: true,
        baseUrl,
        application_id,
        rights_ok: false,
        rights_check_failed: true,
        hint: 'Application found but rights endpoint not accessible. This may still work.',
      },
      200,
      requestId
    );
  }

  let rights: string[] = [];
  try {
    const rightsData = await rightsResponse.json();
    rights = rightsData.rights || [];
  } catch {
    console.log(`[${requestId}] Could not parse rights response`);
  }

  console.log(`[${requestId}] Rights found:`, rights);

  // Check for required rights
  const missingRights = REQUIRED_RIGHTS.filter(r => !rights.includes(r));
  const rightsOk = missingRights.length === 0;

  const nextSteps: string[] = [];
  if (!rightsOk) {
    nextSteps.push('Go to TTN Console → Applications → API keys');
    nextSteps.push('Edit your API key or create a new one');
    nextSteps.push(`Grant the following rights: ${missingRights.join(', ')}`);
    nextSteps.push('Or select "Grant all current and future rights" for full access');
  }

  return buildResponse(
    {
      ok: true,
      baseUrl,
      application_id,
      rights_ok: rightsOk,
      granted_rights: rights,
      missing_rights: missingRights,
      next_steps: nextSteps,
    },
    200,
    requestId
  );
}
