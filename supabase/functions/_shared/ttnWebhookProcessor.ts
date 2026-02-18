import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface TTNUplinkPayload {
  end_device_ids: {
    device_id: string;
    dev_eui?: string;
    application_ids: {
      application_id: string;
    };
  };
  received_at: string;
  uplink_message: {
    decoded_payload: Record<string, unknown>;
    rx_metadata: Array<{
      gateway_ids: {
        gateway_id: string;
        eui: string;
      };
      rssi: number;
      snr: number;
    }>;
    f_port: number;
    frm_payload: string;
  };
}

interface SensorRecord {
  id: string;
  org_id: string;
  site_id: string | null;
  unit_id: string;
  sensor_kind: 'temp' | 'door' | 'combo';
  status: 'pending' | 'active' | 'disabled';
}

interface ProcessResult {
  status: number;
  body: Record<string, unknown>;
}

type LogFn = (level: string, msg: string, data?: Record<string, unknown>) => void;

export async function processTTNUplink(
  payload: TTNUplinkPayload,
  supabase: SupabaseClient,
  log: LogFn
): Promise<ProcessResult> {
  log('info', 'Received TTN webhook', {
    device_id: payload.end_device_ids?.device_id,
    dev_eui: payload.end_device_ids?.dev_eui,
    f_port: payload.uplink_message?.f_port,
    application_id: payload.end_device_ids?.application_ids?.application_id,
  });

  // Resolve dev_eui: use it directly if present, otherwise extract from device_id.
  // TTN's SimulateUplink API omits dev_eui/join_eui/dev_addr from the forwarded
  // webhook event, so we fall back to the device_id which follows the pattern
  // "sensor-{hex}" or "eui-{hex}".
  const endDeviceIds = payload.end_device_ids || {};
  let resolvedDevEui = endDeviceIds.dev_eui;

  if (!resolvedDevEui && endDeviceIds.device_id) {
    const match = endDeviceIds.device_id.match(/^(?:sensor-|eui-)([0-9a-fA-F]+)$/);
    if (match) {
      resolvedDevEui = match[1].toUpperCase();
      log('info', 'Extracted dev_eui from device_id (simulated uplink fallback)', {
        device_id: endDeviceIds.device_id,
        resolved_dev_eui: resolvedDevEui,
      });
    }
  }

  if (!resolvedDevEui) {
    log('info', 'No dev_eui in uplink, will use ttn_device_id fallback', {
      device_id: endDeviceIds.device_id,
    });
  }

  let devEui = resolvedDevEui ? resolvedDevEui.toUpperCase() : null;
  const applicationId = payload.end_device_ids.application_ids?.application_id;
  const decodedPayload = payload.uplink_message?.decoded_payload || {};
  const fPort = payload.uplink_message?.f_port || 0;
  const rxMetadata = payload.uplink_message?.rx_metadata?.[0];

  // Extract telemetry from rx_metadata
  const rssiDbm = rxMetadata?.rssi ?? (decodedPayload.signal_strength as number) ?? null;
  const snrDb = rxMetadata?.snr ?? null;
  const batteryPct = (decodedPayload.battery_level ?? decodedPayload.battery ?? decodedPayload.batt ?? decodedPayload.vbat) as number | null;

  log('info', 'Processing uplink', { devEui, fPort, applicationId });

  // Step 1: Look up sensor in lora_sensors to get org_id and unit_id
  let sensor: SensorRecord | null = null;
  let orgId: string | null = null;
  let unitId: string | null = null;
  let siteId: string | null = null;

  if (devEui) {
    const { data: sensorData, error: sensorError } = await supabase
      .from('lora_sensors')
      .select('id, org_id, site_id, unit_id, sensor_kind, status')
      .eq('dev_eui', devEui)
      .neq('status', 'disabled')
      .limit(1)
      .maybeSingle();

    if (sensorError) {
      log('error', 'Error looking up sensor by dev_eui', { error: sensorError.message });
    } else if (sensorData) {
      sensor = sensorData as SensorRecord;
      orgId = sensor.org_id;
      unitId = sensor.unit_id;
      siteId = sensor.site_id;
      log('info', 'Found registered sensor by dev_eui', { sensor_id: sensor.id, org_id: orgId, unit_id: unitId });
    }
  }

  // Fallback: look up by ttn_device_id when dev_eui is missing or dev_eui lookup found nothing
  if (!sensor && endDeviceIds.device_id) {
    const { data: sensorByDeviceId, error: deviceIdError } = await supabase
      .from('lora_sensors')
      .select('id, org_id, site_id, unit_id, sensor_kind, status, dev_eui')
      .eq('ttn_device_id', endDeviceIds.device_id)
      .neq('status', 'disabled')
      .limit(1)
      .maybeSingle();

    if (deviceIdError) {
      log('error', 'Error looking up sensor by ttn_device_id', { error: deviceIdError.message });
    } else if (sensorByDeviceId) {
      sensor = sensorByDeviceId as SensorRecord;
      orgId = sensor.org_id;
      unitId = sensor.unit_id;
      siteId = sensor.site_id;
      // Use the dev_eui from the sensor record if we didn't have one
      if (!devEui && sensorByDeviceId.dev_eui) {
        devEui = sensorByDeviceId.dev_eui;
      }
      log('info', 'Found sensor by ttn_device_id', {
        sensor_id: sensor.id,
        ttn_device_id: endDeviceIds.device_id,
        org_id: orgId,
        unit_id: unitId,
      });
    }
  }

  // Fallback: try to get org_id from application_id mapping in ttn_settings
  if (!orgId && applicationId) {
    const { data: ttnSettings } = await supabase
      .from('ttn_settings')
      .select('org_id')
      .eq('application_id', applicationId)
      .limit(1)
      .maybeSingle();

    if (ttnSettings) {
      orgId = ttnSettings.org_id;
      log('info', 'Resolved org from ttn_settings', { org_id: orgId, application_id: applicationId });
    }
  }

  // Final fallback: use org_id from payload (emulator sends this)
  if (!orgId) {
    orgId = decodedPayload.org_id as string | null;
    siteId = siteId || (decodedPayload.site_id as string | null);
    unitId = unitId || (decodedPayload.unit_id as string | null);
  }

  // Step 2: Always insert raw uplink into sensor_uplinks for history
  const uplinkRecord = {
    org_id: orgId,
    unit_id: unitId,
    dev_eui: devEui,
    f_port: fPort,
    payload_json: decodedPayload,
    rssi_dbm: rssiDbm,
    snr_db: snrDb,
    battery_pct: batteryPct,
    received_at: payload.received_at || new Date().toISOString(),
  };

  const { error: uplinkError } = await supabase
    .from('sensor_uplinks')
    .insert(uplinkRecord);

  if (uplinkError) {
    log('warn', 'Failed to insert sensor_uplinks', { error: uplinkError.message });
  } else {
    log('info', 'Inserted raw uplink record');
  }

  // If we don't have org_id, accept the uplink but log it as unassigned
  if (!orgId) {
    log('warn', 'No org_id resolved - uplink stored as unassigned', { devEui });
    return {
      status: 202,
      body: { ok: true, status: 'unassigned', message: 'DevEUI not registered - uplink logged for later assignment' },
    };
  }

  // Field-presence detection: detect payload type from field names instead of
  // fPort, since different manufacturers use different fPorts (Dragino: 2,
  // Milesight: 85, Elsys: 5). Hoisted here so both telemetry + legacy writes
  // can reference the resolved values.
  const tempC = (decodedPayload.temperature ?? decodedPayload.TempC_SHT ?? decodedPayload.TempC_DS ?? decodedPayload.ext_temperature ?? decodedPayload.soil_temperature) as number | undefined;
  const tempF = decodedPayload.temp_f as number | undefined ?? (tempC !== undefined ? tempC * 9 / 5 + 32 : undefined);
  const humidity = (decodedPayload.humidity ?? decodedPayload.Hum_SHT) as number | undefined;
  const doorStatus = (decodedPayload.door_status ?? decodedPayload.DOOR_OPEN_STATUS ?? decodedPayload.door ?? decodedPayload.open ?? decodedPayload.contact) as string | boolean | undefined;

  // Step 3: Update unit_telemetry if we have a unit_id
  if (unitId) {
    const now = new Date().toISOString();

    const telemetryUpdate: Record<string, unknown> = {
      org_id: orgId,
      battery_pct: batteryPct,
      rssi_dbm: rssiDbm,
      snr_db: snrDb,
      last_uplink_at: now,
      updated_at: now,
    };

    if (tempF !== undefined) telemetryUpdate.last_temp_f = tempF;
    if (humidity !== undefined) telemetryUpdate.last_humidity = humidity;

    if (doorStatus !== undefined) {
      // Normalize door state
      let doorState: 'open' | 'closed' = 'unknown' as never;
      if (typeof doorStatus === 'boolean') {
        doorState = doorStatus ? 'open' : 'closed';
      } else if (typeof doorStatus === 'string') {
        doorState = doorStatus.toLowerCase() === 'open' ? 'open' : 'closed';
      }

      telemetryUpdate.door_state = doorState;
      telemetryUpdate.last_door_event_at = now;
    }

    // Upsert into unit_telemetry
    const { error: telemetryError } = await supabase
      .from('unit_telemetry')
      .upsert(
        { unit_id: unitId, ...telemetryUpdate },
        { onConflict: 'unit_id' }
      );

    if (telemetryError) {
      log('error', 'Failed to upsert unit_telemetry', { error: telemetryError.message });
    } else {
      log('info', 'Updated unit_telemetry', { unit_id: unitId, f_port: fPort });
    }
  }

  // Step 4: Also insert into legacy tables for backward compatibility
  // Use field-presence detection (same as telemetry above) instead of fPort gating
  if (tempC !== undefined) {
    const sensorData = {
      device_serial: devEui,
      temperature: tempC,
      humidity: humidity ?? null,
      battery_level: batteryPct,
      signal_strength: rssiDbm,
      unit_id: unitId || (decodedPayload.unit_id as string | null),
      reading_type: (decodedPayload.reading_type as string) ?? 'scheduled',
    };

    const { error } = await supabase
      .from('sensor_readings')
      .insert(sensorData);

    if (error) {
      log('warn', 'Failed to insert legacy sensor_readings', { error: error.message });
    }
  }

  if (doorStatus !== undefined) {
    const normalizedDoor = typeof doorStatus === 'boolean'
      ? (doorStatus ? 'open' : 'closed')
      : String(doorStatus);
    const doorData = {
      device_serial: devEui,
      door_status: normalizedDoor,
      battery_level: batteryPct,
      signal_strength: rssiDbm,
      unit_id: unitId || (decodedPayload.unit_id as string | null),
    };

    const { error } = await supabase
      .from('door_events')
      .insert(doorData);

    if (error) {
      log('warn', 'Failed to insert legacy door_events', { error: error.message });
    }
  }

  log('info', 'Webhook processing complete', { org_id: orgId, unit_id: unitId, f_port: fPort });

  return {
    status: 200,
    body: {
      ok: true,
      org_id: orgId,
      unit_id: unitId,
      f_port: fPort,
      sensor_registered: !!sensor,
    },
  };
}
