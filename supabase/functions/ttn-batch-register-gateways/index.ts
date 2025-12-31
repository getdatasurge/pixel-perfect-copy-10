import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Process each gateway
    for (const gateway of gateways) {
      const { eui, name } = gateway;

      // Validate and normalize Gateway EUI
      const normalizedEui = normalizeGatewayEui(eui);
      if (!normalizedEui) {
        console.error(`[${requestId}] Invalid Gateway EUI: ${eui}`);
        results.push({
          eui,
          ttn_gateway_id: 'invalid',
          status: 'failed',
          error: 'Invalid Gateway EUI format. Must be 16 hex characters.',
        });
        summary.failed++;
        continue;
      }

      const gatewayId = generateTTNGatewayId(normalizedEui);
      console.log(`[${requestId}] Provisioning gateway: ${name} -> ${gatewayId}`);

      try {
        // Build TTN Gateway Registry API URL (using PUT for idempotent registration)
        const ttnUrl = `https://${cluster}.cloud.thethings.network/api/v3/users/admin/gateways`;

        // Build the gateway registration payload
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

        // Try to create the gateway
        const response = await fetch(ttnUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gatewayPayload),
        });

        const responseText = await response.text();

        if (response.status === 409) {
          // Gateway already exists - treat as success
          console.log(`[${requestId}] Gateway ${gatewayId} already exists`);
          results.push({
            eui,
            ttn_gateway_id: gatewayId,
            status: 'already_exists',
          });
          summary.already_exists++;
          continue;
        }

        if (!response.ok) {
          let errorMessage = `TTN API error: ${response.status}`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            }
            // Check for specific error codes
            if (response.status === 403) {
              errorMessage = 'API key lacks permission to register gateways';
            } else if (response.status === 401) {
              errorMessage = 'Invalid or expired TTN API key';
            }
          } catch {
            // Use raw response
          }
          
          console.error(`[${requestId}] TTN error for ${gatewayId}: ${errorMessage}`);
          results.push({
            eui,
            ttn_gateway_id: gatewayId,
            status: 'failed',
            error: errorMessage,
          });
          summary.failed++;
          continue;
        }

        console.log(`[${requestId}] Gateway ${gatewayId} registered successfully`);
        results.push({
          eui,
          ttn_gateway_id: gatewayId,
          status: 'created',
        });
        summary.created++;

      } catch (err: any) {
        console.error(`[${requestId}] Error provisioning ${gatewayId}:`, err.message);
        results.push({
          eui,
          ttn_gateway_id: gatewayId,
          status: 'failed',
          error: err.message || 'Unknown error',
        });
        summary.failed++;
      }

      // Small delay to avoid rate limiting
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
