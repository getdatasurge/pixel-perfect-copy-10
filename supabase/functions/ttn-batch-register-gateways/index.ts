import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

interface GatewayToProvision {
  eui: string;        // 16 hex chars
  name: string;
  is_online?: boolean;
}

interface BatchGatewayProvisionRequest {
  org_id?: string;
  gateways: GatewayToProvision[];
}

interface GatewayProvisionResult {
  eui: string;
  ttn_gateway_id: string;
  status: 'created' | 'already_exists' | 'failed';
  error?: string;
  error_code?: string;
  retryable?: boolean;
  attempts?: number;
}

// Normalize Gateway EUI: strip colons/spaces/dashes, lowercase, validate 16 hex chars
function normalizeGatewayEui(eui: string): string | null {
  const cleaned = eui.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// Generate canonical TTN gateway_id from EUI
// Format: emu-gw-{normalized_eui}
function generateTTNGatewayId(normalizedEui: string): string {
  return `emu-gw-${normalizedEui}`;
}

// Mask sensitive data for logging
function maskKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// Classify errors as retryable or permanent
function isRetryableError(error?: string, statusCode?: number): boolean {
  if (!error && !statusCode) return false;
  
  // Retryable status codes
  if (statusCode && [429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }
  
  if (error) {
    const retryablePatterns = [
      /timeout/i,
      /rate limit/i,
      /429/,
      /503/,
      /502/,
      /504/,
      /500/,
      /network/i,
      /connection/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /temporarily unavailable/i,
      /service unavailable/i,
      /gateway timeout/i,
    ];
    return retryablePatterns.some(pattern => pattern.test(error));
  }
  
  return false;
}

// Get error code from status or error message
function getErrorCode(statusCode?: number, error?: string): string {
  if (statusCode === 401) return 'AUTH_INVALID';
  if (statusCode === 403) return 'AUTH_FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'ALREADY_EXISTS';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode === 400) return 'INVALID_REQUEST';
  if (statusCode && statusCode >= 500) return 'SERVER_ERROR';
  if (error?.includes('EUI')) return 'INVALID_EUI';
  if (error?.includes('timeout')) return 'TIMEOUT';
  if (error?.includes('network') || error?.includes('connection')) return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

// Register a single gateway with retry logic
async function registerGatewayWithRetry(
  gateway: GatewayToProvision,
  apiKey: string,
  cluster: string,
  frequencyPlan: string,
  requestId: string
): Promise<GatewayProvisionResult> {
  const { eui, name } = gateway;
  
  // Validate and normalize Gateway EUI
  const normalizedEui = normalizeGatewayEui(eui);
  if (!normalizedEui) {
    return {
      eui,
      ttn_gateway_id: 'invalid',
      status: 'failed',
      error: 'Invalid Gateway EUI format. Must be 16 hex characters.',
      error_code: 'INVALID_EUI',
      retryable: false,
      attempts: 1,
    };
  }

  const gatewayId = generateTTNGatewayId(normalizedEui);
  let lastError = '';
  let lastStatusCode = 0;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[${requestId}] Attempt ${attempt}/${MAX_RETRIES} for gateway ${gatewayId}`);
      
      const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/users/admin/gateways`;
      
      const gatewayPayload = {
        gateway: {
          ids: {
            gateway_id: gatewayId,
            eui: normalizedEui.toUpperCase(),
          },
          name: name || gatewayId,
          description: `Emulator gateway provisioned at ${new Date().toISOString()}`,
          gateway_server_address: `${cluster}.cloud.thethings.network`,
          frequency_plan_id: frequencyPlan,
          status_public: false,
          location_public: false,
          enforce_duty_cycle: true,
          require_authenticated_connection: false,
        },
      };

      const response = await fetch(ttnUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gatewayPayload),
      });

      lastStatusCode = response.status;
      const responseText = await response.text();

      // Gateway already exists - treat as success
      if (response.status === 409) {
        console.log(`[${requestId}] Gateway ${gatewayId} already exists`);
        return {
          eui,
          ttn_gateway_id: gatewayId,
          status: 'already_exists',
          attempts: attempt,
        };
      }

      // Success
      if (response.ok) {
        console.log(`[${requestId}] Gateway ${gatewayId} registered successfully on attempt ${attempt}`);
        return {
          eui,
          ttn_gateway_id: gatewayId,
          status: 'created',
          attempts: attempt,
        };
      }

      // Parse error
      let errorMessage = `TTN API error: ${response.status}`;
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.message) {
          errorMessage = errorData.message;
        }
        if (response.status === 403) {
          errorMessage = 'API key lacks permission to register gateways';
        } else if (response.status === 401) {
          errorMessage = 'Invalid or expired TTN API key';
        }
      } catch {
        // Use raw response
      }

      lastError = errorMessage;
      
      // Check if error is retryable
      const retryable = isRetryableError(errorMessage, response.status);
      
      if (!retryable) {
        // Non-retryable error, return immediately
        console.error(`[${requestId}] Non-retryable error for ${gatewayId}: ${errorMessage}`);
        return {
          eui,
          ttn_gateway_id: gatewayId,
          status: 'failed',
          error: errorMessage,
          error_code: getErrorCode(response.status, errorMessage),
          retryable: false,
          attempts: attempt,
        };
      }

      // Wait before retry with exponential backoff
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[${requestId}] Retrying gateway ${gatewayId} in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (err: any) {
      lastError = err.message || 'Network error';
      console.error(`[${requestId}] Error on attempt ${attempt} for ${gatewayId}:`, lastError);
      
      const retryable = isRetryableError(lastError);
      
      if (!retryable || attempt === MAX_RETRIES) {
        return {
          eui,
          ttn_gateway_id: gatewayId,
          status: 'failed',
          error: lastError,
          error_code: getErrorCode(undefined, lastError),
          retryable: retryable && attempt === MAX_RETRIES,
          attempts: attempt,
        };
      }
      
      // Wait before retry
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries exhausted
  console.error(`[${requestId}] All ${MAX_RETRIES} attempts failed for ${gatewayId}: ${lastError}`);
  return {
    eui,
    ttn_gateway_id: gatewayId,
    status: 'failed',
    error: `Failed after ${MAX_RETRIES} attempts: ${lastError}`,
    error_code: getErrorCode(lastStatusCode, lastError),
    retryable: true, // User can retry again manually
    attempts: MAX_RETRIES,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[${requestId}] Batch gateway provision request received`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: BatchGatewayProvisionRequest = await req.json();
    const { org_id, gateways } = body;

    console.log(`[${requestId}] Processing ${gateways?.length || 0} gateways for org ${org_id || 'none'}`);

    if (!gateways || gateways.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          requestId,
          error: 'No gateways provided for provisioning',
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

    console.log(`[${requestId}] Using cluster=${cluster}, apiKey=${maskKey(apiKey)}`);

    const results: GatewayProvisionResult[] = [];
    const summary = { created: 0, already_exists: 0, failed: 0, total: gateways.length };

    // Determine frequency plan based on cluster
    const frequencyPlan = cluster === 'nam1' ? 'US_902_928_FSB_2' :
                         cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN';

    // Process each gateway with retry logic
    for (const gateway of gateways) {
      const result = await registerGatewayWithRetry(gateway, apiKey, cluster, frequencyPlan, requestId);
      results.push(result);
      
      if (result.status === 'created') summary.created++;
      else if (result.status === 'already_exists') summary.already_exists++;
      else summary.failed++;

      // Small delay between gateways to avoid rate limiting
      if (gateways.indexOf(gateway) < gateways.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
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
