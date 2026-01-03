// Push TTN Settings - Local-Only Save
// FrostGuard's manage-ttn-settings requires JWT auth which is incompatible with cross-project sync
// So we only save to local ttn_settings and synced_users.ttn tables
// Auth: verify_jwt=false, uses API key validation

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PushTTNSettingsRequest {
  org_id: string;
  user_id?: string; // Selected user ID to also update synced_users.ttn
  enabled?: boolean;
  cluster?: string;
  application_id?: string;
  api_key?: string;  // Application API key for device operations
  gateway_api_key?: string;  // Personal/Organization API key for gateway operations
  webhook_secret?: string;
  gateway_owner_type?: 'user' | 'organization';
  gateway_owner_id?: string;
}

interface PushResult {
  ok: boolean;
  request_id: string;
  local_updated?: boolean;
  user_ttn_updated?: boolean;
  api_key_last4?: string | null;
  gateway_api_key_last4?: string | null;
  updated_at?: string;
  error?: string;
  error_code?: string;
  hint?: string;
  step?: string;
  frostguard_skipped?: boolean;
  frostguard_skip_reason?: string;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log(`[push-ttn-settings][${requestId}] Request received`);

  try {
    const body: PushTTNSettingsRequest = await req.json();
    const { org_id, user_id, enabled, cluster, application_id, api_key, gateway_api_key, webhook_secret, gateway_owner_type, gateway_owner_id } = body;

    // Validate required fields
    if (!org_id) {
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'org_id is required',
        error_code: 'MISSING_ORG_ID',
        step: 'validation',
      }, 400);
    }

    // Log the push request (redacted)
    const apiKeyLast4 = api_key ? api_key.slice(-4) : null;
    const gatewayApiKeyLast4 = gateway_api_key ? gateway_api_key.slice(-4) : null;
    console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_REQUEST`, {
      org_id,
      user_id: user_id || null,
      enabled,
      cluster,
      application_id,
      has_api_key: !!api_key,
      api_key_last4: apiKeyLast4 ? `****${apiKeyLast4}` : null,
      has_gateway_api_key: !!gateway_api_key,
      gateway_api_key_last4: gatewayApiKeyLast4 ? `****${gatewayApiKeyLast4}` : null,
      has_webhook_secret: !!webhook_secret,
    });

    // NOTE: FrostGuard push is SKIPPED because FrostGuard's manage-ttn-settings
    // requires JWT auth, but this is a cross-project sync using API key auth
    console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_SKIPPED_NO_FG_SUPPORT`, {
      reason: 'FrostGuard manage-ttn-settings requires JWT auth, incompatible with cross-project sync',
    });

    // Save to local ttn_settings and synced_users.ttn tables only
    let localUpdated = false;
    let userTtnUpdated = false;
    let savedApiKeyLast4: string | null = null;
    let savedGatewayApiKeyLast4: string | null = null;
    const updatedAt = new Date().toISOString();

    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (!supabaseUrl || !supabaseKey) {
        console.error(`[push-ttn-settings][${requestId}] Missing Supabase credentials`);
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: 'Supabase credentials not configured',
          error_code: 'MISSING_SUPABASE_CONFIG',
          hint: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing',
          step: 'config',
        }, 500);
      }

      const supabase = createClient(supabaseUrl, supabaseKey);

      // Upsert local ttn_settings (org-level canonical source)
      const updateData: Record<string, unknown> = {
        org_id,
        enabled: enabled ?? true,
        cluster: cluster || 'eu1',
        application_id,
        updated_at: updatedAt,
      };

      // Only update secrets if provided
      if (api_key) {
        updateData.api_key = api_key;
        savedApiKeyLast4 = api_key.slice(-4);
      }
      // Gateway API key (Personal/Organization key for gateway operations)
      if (gateway_api_key) {
        updateData.gateway_api_key = gateway_api_key;
        updateData.gateway_api_key_last4 = gateway_api_key.slice(-4);
        savedGatewayApiKeyLast4 = gateway_api_key.slice(-4);
      }
      if (webhook_secret) {
        updateData.webhook_secret = webhook_secret;
      }
      if (gateway_owner_type) {
        updateData.gateway_owner_type = gateway_owner_type;
      }
      if (gateway_owner_id) {
        updateData.gateway_owner_id = gateway_owner_id;
      }

      const { error: upsertError } = await supabase
        .from('ttn_settings')
        .upsert(updateData, { onConflict: 'org_id' });

      if (upsertError) {
        console.error(`[push-ttn-settings][${requestId}] ttn_settings upsert error:`, upsertError.message);
        return buildResponse({
          ok: false,
          request_id: requestId,
          error: `Failed to save TTN settings: ${upsertError.message}`,
          error_code: 'DB_UPSERT_ERROR',
          hint: 'Database upsert to ttn_settings failed',
          step: 'local_save',
        }, 500);
      }

      localUpdated = true;
      console.log(`[push-ttn-settings][${requestId}] ttn_settings updated`, {
        api_key_last4: savedApiKeyLast4 ? `****${savedApiKeyLast4}` : null,
      });

      // Also update synced_users.ttn for the selected user (used by ttn-simulate)
      if (user_id) {
        // First get existing ttn data to merge
        const { data: existingUser, error: fetchError } = await supabase
          .from('synced_users')
          .select('ttn')
          .eq('id', user_id)
          .maybeSingle();

        if (fetchError) {
          console.warn(`[push-ttn-settings][${requestId}] synced_users fetch warning:`, fetchError.message);
        }

        const existingTtn = (existingUser?.ttn as Record<string, unknown>) || {};
        
        const ttnJsonData: Record<string, unknown> = {
          ...existingTtn,
          enabled: enabled ?? true,
          cluster: cluster || 'eu1',
          application_id,
          updated_at: updatedAt,
        };

        // Include full API key if provided (ttn-simulate reads from here)
        if (api_key) {
          ttnJsonData.api_key = api_key;
          ttnJsonData.api_key_last4 = api_key.slice(-4);
        }
        if (webhook_secret) {
          ttnJsonData.webhook_secret = webhook_secret;
          ttnJsonData.webhook_secret_last4 = webhook_secret.slice(-4);
        }

        const { error: userUpdateError } = await supabase
          .from('synced_users')
          .update({ ttn: ttnJsonData })
          .eq('id', user_id);

        if (userUpdateError) {
          console.warn(`[push-ttn-settings][${requestId}] synced_users.ttn update warning:`, userUpdateError.message);
        } else {
          userTtnUpdated = true;
          console.log(`[push-ttn-settings][${requestId}] synced_users.ttn updated for user ${user_id}`);
        }
      }
    } catch (localErr) {
      console.error(`[push-ttn-settings][${requestId}] Local save error:`, localErr);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: localErr instanceof Error ? localErr.message : 'Unknown error',
        error_code: 'LOCAL_SAVE_ERROR',
        step: 'local_save',
      }, 500);
    }

    // Success response
    console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_SUCCESS`, {
      api_key_last4: savedApiKeyLast4 ? `****${savedApiKeyLast4}` : null,
      gateway_api_key_last4: savedGatewayApiKeyLast4 ? `****${savedGatewayApiKeyLast4}` : null,
      updated_at: updatedAt,
      local_updated: localUpdated,
      user_ttn_updated: userTtnUpdated,
      frostguard_skipped: true,
    });

    return buildResponse({
      ok: true,
      request_id: requestId,
      local_updated: localUpdated,
      user_ttn_updated: userTtnUpdated,
      api_key_last4: savedApiKeyLast4,
      gateway_api_key_last4: savedGatewayApiKeyLast4,
      updated_at: updatedAt,
      frostguard_skipped: true,
      frostguard_skip_reason: 'FrostGuard requires JWT auth, incompatible with cross-project sync',
    }, 200);

  } catch (err) {
    console.error(`[push-ttn-settings][${requestId}] Error:`, err);
    return buildResponse({
      ok: false,
      request_id: requestId,
      error: err instanceof Error ? err.message : 'Unknown error',
      error_code: 'UNKNOWN_ERROR',
      step: 'processing',
    }, 500);
  }
});

function buildResponse(data: PushResult, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
