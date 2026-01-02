import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOrgSettings, loadTTNSettings } from "../_shared/settings.ts";
import { processTTNUplink, TTNUplinkPayload } from "../_shared/ttnWebhookProcessor.ts";
import { loadWebhookSecretForApplication, verifyWebhookSecret } from "../_shared/ttnWebhookAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ttn-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EmulatorForwardRequest {
  org_id?: string;
  selected_user_id?: string;
  applicationId: string;
  deviceId: string;
  devEui: string;
  decodedPayload: Record<string, unknown>;
  fPort: number;
}

function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID().slice(0, 8);
  const log = (level: string, msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ correlationId, level, msg, ...data }));
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: EmulatorForwardRequest = await req.json();

    if (!payload.applicationId || !payload.deviceId || !payload.devEui) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required emulator payload fields', errorType: 'validation_error' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedDevEui = normalizeDevEui(payload.devEui);
    if (!normalizedDevEui) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid DevEUI format', errorType: 'validation_error' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const settingsResult = payload.selected_user_id
      ? await loadTTNSettings(payload.selected_user_id, payload.org_id)
      : { settings: payload.org_id ? await loadOrgSettings(payload.org_id) : null, source: payload.org_id ? 'org' : null };

    const expectedSecret = await loadWebhookSecretForApplication(supabase, payload.applicationId);
    const providedSecret = req.headers.get('x-ttn-webhook-secret');
    const secretCheck = verifyWebhookSecret(providedSecret, expectedSecret);
    if (!secretCheck.ok) {
      log('warn', 'Webhook secret validation failed', {
        applicationId: payload.applicationId,
        settingsSource: settingsResult.source,
      });
      return new Response(
        JSON.stringify({ ok: false, error: secretCheck.error, errorType: 'auth_error' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ttnPayload: TTNUplinkPayload = {
      end_device_ids: {
        device_id: payload.deviceId,
        dev_eui: normalizedDevEui,
        application_ids: {
          application_id: payload.applicationId,
        },
      },
      received_at: new Date().toISOString(),
      uplink_message: {
        decoded_payload: payload.decodedPayload,
        rx_metadata: [],
        f_port: payload.fPort,
        frm_payload: '',
      },
    };

    log('info', 'Forwarding emulator uplink', {
      device_id: payload.deviceId,
      dev_eui: normalizedDevEui,
      application_id: payload.applicationId,
      f_port: payload.fPort,
      settings_source: settingsResult.source,
    });

    const result = await processTTNUplink(ttnPayload, supabase, log);
    const responseBody = {
      ...result.body,
      settingsSource: settingsResult.source,
      applicationId: payload.applicationId,
    };

    return new Response(
      JSON.stringify(responseBody),
      { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log('error', 'Unexpected error', { error: errorMessage });

    return new Response(
      JSON.stringify({ ok: false, error: 'Internal processing error', hint: 'Check server logs for details' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
