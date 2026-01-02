// Push TTN Settings to FrostGuard
// Forwards TTN config changes from Emulator to FrostGuard (canonical source)
// Uses PROJECT2_SYNC_API_KEY for API-key-only auth

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushTTNSettingsRequest {
  org_id: string;
  user_id?: string; // Selected user ID to also update synced_users.ttn
  enabled?: boolean;
  cluster?: string;
  application_id?: string;
  api_key?: string;
  webhook_secret?: string;
  gateway_owner_type?: 'user' | 'organization';
  gateway_owner_id?: string;
}

interface PushResult {
  ok: boolean;
  request_id: string;
  frostguard_response?: {
    ok: boolean;
    api_key_last4?: string;
    updated_at?: string;
    message?: string;
  };
  local_updated?: boolean;
  user_ttn_updated?: boolean;
  error?: string;
  hint?: string;
  step?: string;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log(`[push-ttn-settings][${requestId}] Request received`);

  try {
    const body: PushTTNSettingsRequest = await req.json();
    const { org_id, user_id, enabled, cluster, application_id, api_key, webhook_secret, gateway_owner_type, gateway_owner_id } = body;

    // Validate required fields
    if (!org_id) {
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'org_id is required',
        step: 'validation',
      }, 400);
    }

    // Log the push request (redacted)
    console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_REQUEST`, {
      org_id,
      user_id: user_id || null,
      enabled,
      cluster,
      application_id,
      has_api_key: !!api_key,
      api_key_last4: api_key ? `****${api_key.slice(-4)}` : null,
      has_webhook_secret: !!webhook_secret,
    });

    // Get FrostGuard URL and API key from environment
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');

    if (!frostguardUrl) {
      console.error(`[push-ttn-settings][${requestId}] Missing FROSTGUARD_SUPABASE_URL`);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'FrostGuard URL not configured',
        hint: 'FROSTGUARD_SUPABASE_URL environment variable is missing',
        step: 'config',
      }, 500);
    }

    if (!syncApiKey) {
      console.error(`[push-ttn-settings][${requestId}] Missing PROJECT2_SYNC_API_KEY`);
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: 'Sync API key not configured',
        hint: 'PROJECT2_SYNC_API_KEY environment variable is missing',
        step: 'config',
      }, 500);
    }

    // Step 1: Push settings to FrostGuard
    const frostguardEndpoint = `${frostguardUrl}/functions/v1/manage-ttn-settings`;
    console.log(`[push-ttn-settings][${requestId}] Pushing to FrostGuard: ${frostguardEndpoint}`);

    const pushPayload = {
      action: 'save',
      org_id,
      enabled,
      cluster,
      application_id,
      api_key: api_key || undefined, // Only include if provided
      webhook_secret: webhook_secret || undefined,
      gateway_owner_type,
      gateway_owner_id: gateway_owner_id || undefined,
    };

    const fgResponse = await fetch(frostguardEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncApiKey}`,
      },
      body: JSON.stringify(pushPayload),
    });

    const fgData = await fgResponse.json().catch(() => null);

    console.log(`[push-ttn-settings][${requestId}] FrostGuard response: ${fgResponse.status}`, {
      ok: fgData?.ok,
      api_key_last4: fgData?.api_key_last4 ? `****${fgData.api_key_last4}` : null,
      updated_at: fgData?.updated_at,
      error: fgData?.error,
    });

    if (!fgResponse.ok || !fgData?.ok) {
      return buildResponse({
        ok: false,
        request_id: requestId,
        error: fgData?.error || `FrostGuard returned ${fgResponse.status}`,
        hint: fgData?.hint || 'Failed to save settings to FrostGuard',
        step: 'push_to_frostguard',
        frostguard_response: {
          ok: false,
          message: fgData?.error,
        },
      }, fgResponse.status >= 400 && fgResponse.status < 500 ? fgResponse.status : 502);
    }

    // Step 2: Also update local ttn_settings AND synced_users.ttn for consistency
    let localUpdated = false;
    let userTtnUpdated = false;
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Upsert local ttn_settings (org-level canonical source)
        const updateData: Record<string, unknown> = {
          org_id,
          enabled: enabled ?? true,
          cluster: cluster || 'eu1',
          application_id,
          updated_at: new Date().toISOString(),
        };

        // Only update secrets if provided
        if (api_key) {
          updateData.api_key = api_key;
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
          console.warn(`[push-ttn-settings][${requestId}] Local ttn_settings upsert warning:`, upsertError.message);
        } else {
          localUpdated = true;
          console.log(`[push-ttn-settings][${requestId}] Local ttn_settings updated`);
        }

        // Also update synced_users.ttn for the selected user (used by ttn-simulate)
        if (user_id) {
          const ttnJsonData: Record<string, unknown> = {
            enabled: enabled ?? true,
            cluster: cluster || 'eu1',
            application_id,
            api_key_last4: api_key ? api_key.slice(-4) : fgData?.api_key_last4,
            webhook_secret_last4: webhook_secret ? webhook_secret.slice(-4) : null,
            updated_at: new Date().toISOString(),
          };

          // Include full API key if provided (ttn-simulate reads from here)
          if (api_key) {
            ttnJsonData.api_key = api_key;
          }
          if (webhook_secret) {
            ttnJsonData.webhook_secret = webhook_secret;
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
      }
    } catch (localErr) {
      console.warn(`[push-ttn-settings][${requestId}] Local update skipped:`, localErr);
    }

    // Success response
    console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_SUCCESS`, {
      api_key_last4: fgData.api_key_last4 ? `****${fgData.api_key_last4}` : null,
      updated_at: fgData.updated_at,
      local_updated: localUpdated,
      user_ttn_updated: userTtnUpdated,
    });

    return buildResponse({
      ok: true,
      request_id: requestId,
      frostguard_response: {
        ok: true,
        api_key_last4: fgData.api_key_last4,
        updated_at: fgData.updated_at,
        message: fgData.message || 'Settings saved',
      },
      local_updated: localUpdated,
      user_ttn_updated: userTtnUpdated,
    }, 200);

  } catch (err) {
    console.error(`[push-ttn-settings][${requestId}] Error:`, err);
    return buildResponse({
      ok: false,
      request_id: requestId,
      error: err instanceof Error ? err.message : 'Unknown error',
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
