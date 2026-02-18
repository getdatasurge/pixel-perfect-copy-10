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
 * Set ABP session keys on an EXISTING TTN device (provisioned by FrostGuard).
 *
 * The device MUST already exist on the Identity Server — FrostGuard creates it.
 * We do NOT delete or touch IS. We ONLY write session info to NS and AS so TTN
 * treats the device as having joined (ABP), which makes SimulateUplink include
 * dev_eui in the forwarded webhook payload.
 *
 * Two TTN API calls:
 *   0. Pre-check: GET device on IS to confirm it exists
 *   1. Network Server (NS): PUT LoRaWAN config + session (dev_addr, NwkSKey) + mac_state
 *   2. Application Server (AS): PUT session (dev_addr, AppSKey)
 */
serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: ProvisionABPRequest = await req.json();
    const { deviceId, devEui, applicationId, cluster: requestCluster, selected_user_id, org_id } = body;

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

    const steps: { preflight: StepResult; ns: StepResult; as: StepResult } = {
      preflight: { status: 0, ok: false, body: '' },
      ns: { status: 0, ok: false, body: '' },
      as: { status: 0, ok: false, body: '' },
    };

    // =============================================
    // PRE-CHECK: Verify device exists on Identity Server (eu1)
    // FrostGuard should have created it. If a previous run deleted it,
    // the user needs to re-provision in FrostGuard first.
    // =============================================
    const isCheckUrl = `${isBaseUrl}/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Pre-check: GET ${isCheckUrl}`);

    try {
      const checkResp = await fetch(isCheckUrl, {
        method: 'GET',
        headers: authHeaders,
      });
      const checkBody = await checkResp.text();
      steps.preflight = { status: checkResp.status, ok: checkResp.ok, body: checkBody.slice(0, 500) };
      console.log(`[ttn-provision-abp][${requestId}] Pre-check response: ${checkResp.status} ${checkBody.slice(0, 300)}`);
    } catch (err) {
      steps.preflight = { status: 0, ok: false, body: `Fetch error: ${(err as Error).message}` };
      console.error(`[ttn-provision-abp][${requestId}] Pre-check fetch error:`, err);
    }

    if (!steps.preflight.ok) {
      const isNotFound = steps.preflight.status === 404;
      return jsonResponse(200, {
        success: false,
        error: isNotFound
          ? `Device "${deviceId}" does not exist on TTN Identity Server. It may have been deleted by a previous provisioning attempt.`
          : `Failed to verify device on Identity Server (${steps.preflight.status}): ${steps.preflight.body}`,
        hint: isNotFound
          ? 'Re-provision the device in FrostGuard first, then retry ABP session setup.'
          : steps.preflight.status === 403
          ? 'API key lacks permission to read devices on Identity Server.'
          : undefined,
        steps,
        request_id: requestId,
      });
    }

    console.log(`[ttn-provision-abp][${requestId}] Device exists on IS. Proceeding to set session keys on NS and AS.`);

    // =============================================
    // STEP 1: Network Server — Set LoRaWAN config + session + MAC state
    // =============================================
    const nsUrl = `${clusterBaseUrl}/ns/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Step 1/2: PUT ${nsUrl}`);
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
            rx1_delay: { value: 'RX_DELAY_1' },
          },
          desired_parameters: {
            adr_ack_delay_exponent: { value: 'ADR_ACK_DELAY_32' },
            adr_ack_limit_exponent: { value: 'ADR_ACK_LIMIT_64' },
            rx1_delay: { value: 'RX_DELAY_1' },
          },
        },
      },
      field_mask: {
        paths: [
          'supports_join',
          'multicast',
          'lorawan_version',
          'lorawan_phy_version',
          'frequency_plan_id',
          'session',
          'mac_state',
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
    // STEP 2: Application Server — Set app session key
    // =============================================
    const asUrl = `${clusterBaseUrl}/as/applications/${applicationId}/devices/${deviceId}`;
    console.log(`[ttn-provision-abp][${requestId}] Step 2/2: PUT ${asUrl}`);
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
        paths: ['session'],
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

    console.log(`[ttn-provision-abp][${requestId}] ABP session setup complete for ${deviceId} (dev_addr: ${devAddr})`);
    return jsonResponse(200, {
      success: true,
      deviceId,
      devAddr,
      message: 'Session keys set on NS and AS. Device is now ABP-active.',
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
