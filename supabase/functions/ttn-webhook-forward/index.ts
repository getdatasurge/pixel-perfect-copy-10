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

interface NormalizedEmulatorPayload {
  source?: string;
  orgId?: string;
  selectedUserId?: string;
  applicationId?: string;
  deviceId?: string;
  devEui?: string;
  decodedPayload?: Record<string, unknown>;
  fPort?: number;
  receivedAt?: string;
}

function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeEmulatorPayload(raw: unknown): NormalizedEmulatorPayload {
  const data = toRecord(raw);
  if (!data) {
    return {};
  }

  const endDeviceIds = toRecord(data.end_device_ids);
  const applicationIds = endDeviceIds ? toRecord(endDeviceIds.application_ids) : null;
  const uplinkMessage = toRecord(data.uplink_message);

  const source = readString(data.source);
  const applicationId = readString(
    data.applicationId ?? data.application_id ?? applicationIds?.application_id
  );
  const deviceId = readString(
    data.deviceId ?? data.device_id ?? endDeviceIds?.device_id
  );
  const devEui = readString(
    data.devEui ?? data.dev_eui ?? endDeviceIds?.dev_eui
  );
  const decodedPayload = toRecord(
    data.decodedPayload ?? data.decoded_payload ?? uplinkMessage?.decoded_payload
  ) ?? undefined;
  const fPort = readNumber(
    data.fPort ?? data.f_port ?? uplinkMessage?.f_port
  );
  const orgId = readString(data.org_id ?? data.orgId);
  const selectedUserId = readString(data.selected_user_id ?? data.selectedUserId);
  const receivedAt = readString(data.received_at);

  return {
    source,
    orgId,
    selectedUserId,
    applicationId,
    deviceId,
    devEui,
    decodedPayload,
    fPort,
    receivedAt,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID().slice(0, 8);
  const log = (level: string, msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ correlationId, level, msg, ...data }));
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const rawPayload = await req.json();
    const payload = normalizeEmulatorPayload(rawPayload);

    const missingFields: string[] = [];
    if (!payload.applicationId) missingFields.push('applicationId');
    if (!payload.deviceId) missingFields.push('deviceId');
    if (!payload.devEui) missingFields.push('devEui');
    if (!payload.decodedPayload) missingFields.push('decodedPayload');
    if (payload.fPort === undefined) missingFields.push('fPort');

    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing required emulator payload fields',
          errorType: 'validation_error',
          missingFields,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Type guard: All required fields are now guaranteed to be present
    const applicationId = payload.applicationId!;
    const deviceId = payload.deviceId!;
    const devEui = payload.devEui!;
    const decodedPayload = payload.decodedPayload!;
    const fPort = payload.fPort!;

    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid DevEUI format', errorType: 'validation_error' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const settingsResult = payload.selectedUserId
      ? await loadTTNSettings(payload.selectedUserId, payload.orgId)
      : { settings: payload.orgId ? await loadOrgSettings(payload.orgId) : null, source: payload.orgId ? 'org' : null };

    // Skip webhook secret check for emulator requests (identified by source or org context)
    const isEmulatorRequest = payload.source === 'emulator' || (payload.orgId && payload.selectedUserId);
    if (!isEmulatorRequest) {
      const expectedSecret = await loadWebhookSecretForApplication(supabase, applicationId);
      const providedSecret = req.headers.get('x-ttn-webhook-secret');
      const secretCheck = verifyWebhookSecret(providedSecret, expectedSecret);
      if (!secretCheck.ok) {
        log('warn', 'Webhook secret validation failed', {
          applicationId,
          settingsSource: settingsResult.source,
        });
        return new Response(
          JSON.stringify({ ok: false, error: secretCheck.error, errorType: 'auth_error', request_id: correlationId }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const ttnPayload: TTNUplinkPayload = {
      end_device_ids: {
        device_id: deviceId,
        dev_eui: normalizedDevEui,
        application_ids: {
          application_id: applicationId,
        },
      },
      received_at: payload.receivedAt ?? new Date().toISOString(),
      uplink_message: {
        decoded_payload: decodedPayload,
        rx_metadata: [],
        f_port: fPort,
        frm_payload: '',
      },
    };

    log('info', 'Forwarding emulator uplink', {
      source: payload.source || 'external',
      device_id: deviceId,
      dev_eui: normalizedDevEui,
      application_id: applicationId,
      f_port: fPort,
      settings_source: settingsResult.source,
    });

    const result = await processTTNUplink(ttnPayload, supabase, log);
    const responseBody = {
      ...result.body,
      settingsSource: settingsResult.source,
      applicationId,
      request_id: correlationId,
    };

    return new Response(
      JSON.stringify(responseBody),
      { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log('error', 'Unexpected error', { error: errorMessage });

    return new Response(
      JSON.stringify({ ok: false, error: 'Internal processing error', hint: 'Check server logs for details', request_id: correlationId }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
