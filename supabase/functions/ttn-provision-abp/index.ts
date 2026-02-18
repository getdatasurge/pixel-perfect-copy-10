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
 * Convert a TTN device from OTAA to ABP by setting supports_join: false
 * and injecting a pre-configured session with dummy keys.
 *
 * ABP devices have an "active session" from the moment they are configured,
 * which causes TTN's SimulateUplink to include dev_eui in the forwarded
 * webhook payload — fixing the issue where simulated uplinks are dropped
 * by FrostGuard due to missing dev_eui.
 *
 * Three TTN API calls:
 *   1. Identity Server (IS): Set supports_join: false
 *   2. Network Server (NS): Set session (dev_addr, NwkSKey) + mac_state
 *   3. Application Server (AS): Set session (dev_addr, AppSKey)
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

    const baseUrl = `https://${cluster}.cloud.thethings.network/api/v3`;
    const authHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const frequencyPlan = cluster === 'nam1' ? 'US_902_928_FSB_2' :
                          cluster === 'au1' ? 'AU_915_928_FSB_2' : 'EU_863_870_TTN';

    const steps: { is: StepResult; ns: StepResult; as: StepResult } = {
      is: { status: 0, ok: false, body: '' },
      ns: { status: 0, ok: false, body: '' },
      as: { status: 0, ok: false, body: '' },
    };

    // =============================================
    // STEP 1: Identity Server — Set supports_join: false
    // =============================================
    console.log(`[ttn-provision-abp][${requestId}] Step 1/3: Updating Identity Server...`);
    const isUrl = `${baseUrl}/applications/${applicationId}/devices/${deviceId}`;
    const isPayload = {
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
        ...(deviceName && { name: deviceName }),
      },
      field_mask: {
        paths: [
          'supports_join',
          'multicast',
          'ids.dev_eui',
          'lorawan_version',
          'lorawan_phy_version',
          'frequency_plan_id',
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
        error: `Identity Server update failed (${steps.is.status}): ${steps.is.body}`,
        hint: steps.is.status === 403
          ? 'API key lacks permission to update devices on Identity Server. Ensure the key has "Edit application devices" rights.'
          : steps.is.status === 404
          ? `Device "${deviceId}" not found in application "${applicationId}". Provision the device first using the Provisioning Wizard.`
          : undefined,
        steps,
        request_id: requestId,
      });
    }

    // =============================================
    // STEP 2: Network Server — Set session + MAC state
    // =============================================
    console.log(`[ttn-provision-abp][${requestId}] Step 2/3: Updating Network Server...`);
    const nsUrl = `${baseUrl}/ns/applications/${applicationId}/devices/${deviceId}`;
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
    console.log(`[ttn-provision-abp][${requestId}] Step 3/3: Updating Application Server...`);
    const asUrl = `${baseUrl}/as/applications/${applicationId}/devices/${deviceId}`;
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
