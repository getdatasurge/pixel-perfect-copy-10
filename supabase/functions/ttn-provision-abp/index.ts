import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { loadTTNSettings } from '../_shared/settings.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ProvisionABPRequest {
  deviceId: string;
  devEui: string;
  applicationId: string;
  cluster?: string;
  deviceName?: string;
  // Settings lookup
  selected_user_id?: string;
  org_id?: string;
}

interface StepResult {
  status: number;
  ok: boolean;
  body: string;
}

/**
 * Re-create a TTN device as ABP (supports_join: false) with a pre-configured
 * session. TTN does not allow flipping OTAA→ABP in-place, so we DELETE first
 * then CREATE fresh.
 *
 * ABP devices have an "active session" from the moment they are configured,
 * which causes TTN's SimulateUplink to include dev_eui in the forwarded
 * webhook payload — fixing the issue where simulated uplinks are dropped
 * by FrostGuard due to missing dev_eui.
 *
 * Four TTN API calls:
 *   0. DELETE existing device (404 = OK, device didn't exist)
 *   1. Identity Server (IS): POST new device with supports_join: false
 *   2. Network Server (NS): PUT session (dev_addr, NwkSKey) + mac_state
 *   3. Application Server (AS): PUT session (dev_addr, AppSKey)
 */
serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: ProvisionABPRequest = await req.json();
    const { deviceId, devEui, applicationId, cluster: requestCluster, deviceName, selected_user_id, org_id } = body;

    console.log(`[ttn-provision-abp][${requestId}] Request:`, { deviceId, devEui, applicationId, requestCluster });

    if (!deviceId || !devEui || !applicationId) {
      return jsonResponse(400, {
        success: false,
        error: 'Missing required fields: deviceId, devEui, applicationId',
        request_id: requestId,
      });
    }

    // Resolve API key and cluster
    let apiKey: string | undefined;
    let cluster = requestCluster || 'nam1';

    // Try loading from user/org settings
    if (selected_user_id) {
      const { settings, source } = await loadTTNSettings(selected_user_id, org_id);
      if (settings?.api_key) {
        apiKey = settings.api_key;
        cluster = settings.cluster || cluster;
        console.log(`[ttn-provision-abp][${requestId}] Using API key from ${source} settings`);
      }
    }

    // Fallback to env vars
    if (!apiKey) {
      apiKey = Deno.env.get('TTN_API_KEY') || Deno.env.get('TTN_PROVISION_API_KEY');
      if (apiKey) {
        console.log(`[ttn-provision-abp][${requestId}] Using API key from env var`);
      }
    }

    if (!apiKey) {
      return jsonResponse(400, {
        success: false,
        error: 'No TTN API key available. Configure TTN settings or set TTN_API_KEY / TTN_PROVISION_API_KEY in Supabase secrets.',
        hint: 'Create a TTN API key with full application rights (including "Write Network Server" and "Write Application Server") and add it as TTN_PROVISION_API_KEY in Supabase Edge Function secrets.',
        request_id: requestId,
      });
    }

    const normalizedDevEui = devEui.replace(/[:\s-]/g, '').toUpperCase();

    // Generate unique dev_addr: '260C' + last 4 hex chars of dev_eui
    const devAddr = '260C' + normalizedDevEui.slice(-4);

    // Dummy 16-byte session keys (base64 encoded)
    // These are arbitrary but valid — ABP doesn't use over-the-air key exchange
    const dummyKeyB64 = 'AQEBAQEBAQEBAQEBAQEBAQ==';

    // TTN Cloud: Identity Server ALWAYS lives on eu1, regardless of regional cluster
    const isBaseUrl = 'https://eu1.cloud.thethings.network/api/v3';
    // NS and AS live on the regional cluster
    const clusterBaseUrl = `https://${cluster}.cloud.thethings.network/api/v3`;
    console.log(`[ttn-provision-abp][${requestId}] IS base URL: ${isBaseUrl} | NS/AS base URL: ${clusterBaseUrl}`);
    const authHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const frequencyPlan = cluster === 'nam1' ? 'US_902_928_FSB_2' :
                          cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN';

    const steps: { delete: StepResult; is: StepResult; ns: StepResult; as: StepResult } = {
      delete: { status: 0, ok: false, body: '' },
      is: { status: 0, ok: false, body: '' },
      ns: { status: 0, ok: false, body: '' },
      as: { status: 0, ok: false, body: '' },
    };

    // =============================================
    // STEP 0: DELETE existing device from IS (eu1), NS, and AS (cluster)
    // TTN won't allow OTAA→ABP in-place. IS should cascade, but we
    // explicitly delete from NS and AS as well to be safe.
    // =============================================
    const deleteUrls = [
      { label: 'IS (eu1)', url: `${isBaseUrl}/applications/${applicationId}/devices/${deviceId}` },
      { label: 'NS', url: `${clusterBaseUrl}/ns/applications/${applicationId}/devices/${deviceId}` },
      { label: 'AS', url: `${clusterBaseUrl}/as/applications/${applicationId}/devices/${deviceId}` },
    ];

    for (const { label, url } of deleteUrls) {
      console.log(`[ttn-provision-abp][${requestId}] Step 0: DELETE ${label} ${url}`);
      try {
        const deleteResp = await fetch(url, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const deleteBody = await deleteResp.text();
        const deleteOk = deleteResp.ok || deleteResp.status === 404;
        console.log(`[ttn-provision-abp][${requestId}] DELETE ${label}: ${deleteResp.status} ${deleteResp.status === 404 ? '(not found — OK)' : deleteBody.slice(0, 200)}`);

        // Only track the IS delete as the authoritative result
        if (label.startsWith('IS')) {
          steps.delete = { status: deleteResp.status, ok: deleteOk, body: deleteBody.slice(0, 500) };
        }
      } catch (err) {
        console.error(`[ttn-provision-abp][${requestId}] DELETE ${label} fetch error:`, err);
        if (label.startsWith('IS')) {
          steps.delete = { status: 0, ok: false, body: `Fetch error: ${(err as Error).message}` };
        }
      }
    }

    if (!steps.delete.ok) {
      return jsonResponse(200, {
        success: false,
        error: `Delete existing device failed (${steps.delete.status}): ${steps.delete.body}`,
        hint: steps.delete.status === 403
          ? 'API key lacks permission to delete devices. Ensure the key has full application rights.'
          : undefined,
        steps,
        request_id: requestId,
      });
    }

    // =============================================
    // STEP 1: Identity Server (eu1) — Create device with identity + metadata ONLY
    // IS does NOT handle LoRaWAN fields (supports_join, lorawan_version, etc.)
    // Those belong on the NS (Step 2).
    // =============================================
    const isUrl = `${isBaseUrl}/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Step 1/3: PUT to Identity Server at ${isUrl}`);
    const isPayload = {
      end_device: {
        ids: {
          device_id: deviceId,
          application_ids: { application_id: applicationId },
        },
        ...(deviceName && { name: deviceName }),
      },
      field_mask: {
        paths: [
          ...(deviceName ? ['name'] : []),
        ],
      },
    };

    try {
      const isResp = await fetch(isUrl, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(isPayload),
      });
      const isBody = await isResp.text();
      steps.is = { status: isResp.status, ok: isResp.ok, body: isBody.slice(0, 500) };
      console.log(`[ttn-provision-abp][${requestId}] IS response: ${isResp.status} ${isBody.slice(0, 500)}`);
    } catch (err) {
      steps.is = { status: 0, ok: false, body: `Fetch error: ${(err as Error).message}` };
      console.error(`[ttn-provision-abp][${requestId}] IS fetch error:`, err);
    }

    if (!steps.is.ok) {
      return jsonResponse(200, {
        success: false,
        error: `Identity Server create failed (${steps.is.status}): ${steps.is.body}`,
        hint: steps.is.status === 403
          ? 'API key lacks permission to create devices on Identity Server. Ensure the key has full application rights.'
          : steps.is.status === 409
          ? `Device "${deviceId}" already exists — the DELETE may not have propagated. Retry in a few seconds.`
          : undefined,
        steps,
        request_id: requestId,
      });
    }

    // =============================================
    // STEP 2: Network Server — Set session + MAC state
    // =============================================
    const nsUrl = `${clusterBaseUrl}/ns/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Step 2/3: PUT ${nsUrl}`);
    const nsPayload = {
      end_device: {
        ids: {
          device_id: deviceId,
          dev_eui: normalizedDevEui,
          application_ids: { application_id: applicationId },
        },
        supports_join: false,
        multicast: false,
        lorawan_version: 'MAC_V1_0_3',
        lorawan_phy_version: 'PHY_V1_0_3_REV_A',
        frequency_plan_id: frequencyPlan,
        session: {
          dev_addr: devAddr,
          keys: {
            f_nwk_s_int_key: { key: dummyKeyB64 },
          },
        },
        mac_state: {
          lorawan_version: 'MAC_V1_0_3',
          current_parameters: {
            adr_ack_delay_exponent: { value: 'ADR_ACK_DELAY_32' },
            adr_ack_limit_exponent: { value: 'ADR_ACK_LIMIT_64' },
            rx1_delay: 'RX_DELAY_1',
          },
          desired_parameters: {
            adr_ack_delay_exponent: { value: 'ADR_ACK_DELAY_32' },
            adr_ack_limit_exponent: { value: 'ADR_ACK_LIMIT_64' },
            rx1_delay: 'RX_DELAY_1',
          },
        },
      },
      field_mask: {
        paths: [
          'session',
          'mac_state',
          'supports_join',
          'multicast',
          'ids.dev_eui',
          'lorawan_version',
          'lorawan_phy_version',
          'frequency_plan_id',
        ],
      },
    };

    try {
      const nsResp = await fetch(nsUrl, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(nsPayload),
      });
      const nsBody = await nsResp.text();
      steps.ns = { status: nsResp.status, ok: nsResp.ok, body: nsBody.slice(0, 500) };
      console.log(`[ttn-provision-abp][${requestId}] NS response: ${nsResp.status} ${nsBody.slice(0, 500)}`);
    } catch (err) {
      steps.ns = { status: 0, ok: false, body: `Fetch error: ${(err as Error).message}` };
      console.error(`[ttn-provision-abp][${requestId}] NS fetch error:`, err);
    }

    if (!steps.ns.ok) {
      // Check specifically for permission errors on NS
      const isPermError = steps.ns.status === 403 || steps.ns.status === 401;
      return jsonResponse(200, {
        success: false,
        error: `Network Server update failed (${steps.ns.status}): ${steps.ns.body}`,
        hint: isPermError
          ? 'API key lacks Network Server write permissions. Create a TTN API key with full application rights (including "Write Network Server") and set it as TTN_PROVISION_API_KEY in Supabase secrets.'
          : undefined,
        steps,
        request_id: requestId,
      });
    }

    // =============================================
    // STEP 3: Application Server — Set app session key
    // =============================================
    const asUrl = `${clusterBaseUrl}/as/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Step 3/3: PUT ${asUrl}`);
    const asPayload = {
      end_device: {
        ids: {
          device_id: deviceId,
          dev_eui: normalizedDevEui,
          application_ids: { application_id: applicationId },
        },
        session: {
          dev_addr: devAddr,
          keys: {
            app_s_key: { key: dummyKeyB64 },
          },
        },
      },
      field_mask: {
        paths: [
          'session',
          'ids.dev_eui',
        ],
      },
    };

    try {
      const asResp = await fetch(asUrl, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(asPayload),
      });
      const asBody = await asResp.text();
      steps.as = { status: asResp.status, ok: asResp.ok, body: asBody.slice(0, 500) };
      console.log(`[ttn-provision-abp][${requestId}] AS response: ${asResp.status} ${asBody.slice(0, 500)}`);
    } catch (err) {
      steps.as = { status: 0, ok: false, body: `Fetch error: ${(err as Error).message}` };
      console.error(`[ttn-provision-abp][${requestId}] AS fetch error:`, err);
    }

    if (!steps.as.ok) {
      return jsonResponse(200, {
        success: false,
        error: `Application Server update failed (${steps.as.status}): ${steps.as.body}`,
        steps,
        request_id: requestId,
      });
    }

    console.log(`[ttn-provision-abp][${requestId}] ABP provisioning complete for ${deviceId}`);
    return jsonResponse(200, {
      success: true,
      deviceId,
      devAddr,
      steps,
      request_id: requestId,
    });

  } catch (err) {
    console.error(`[ttn-provision-abp][${requestId}] Error:`, err);
    return jsonResponse(500, {
      success: false,
      error: `Internal error: ${(err as Error).message}`,
      request_id: requestId,
    });
  }
});

function jsonResponse(status: number, data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
