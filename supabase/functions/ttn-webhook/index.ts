import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ttn-webhook-secret',
};

interface TTNUplinkPayload {
  end_device_ids: {
    device_id: string;
    dev_eui: string;
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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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

    const payload: TTNUplinkPayload = await req.json();
    
    log('info', 'Received TTN webhook', {
      device_id: payload.end_device_ids?.device_id,
      dev_eui: payload.end_device_ids?.dev_eui,
      f_port: payload.uplink_message?.f_port,
      application_id: payload.end_device_ids?.application_ids?.application_id,
    });

    // Validate required fields
    if (!payload.end_device_ids?.dev_eui) {
      log('warn', 'Missing dev_eui in payload');
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing device EUI' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const devEui = payload.end_device_ids.dev_eui.toUpperCase();
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

    const { data: sensorData, error: sensorError } = await supabase
      .from('lora_sensors')
      .select('id, org_id, site_id, unit_id, sensor_kind, status')
      .eq('dev_eui', devEui)
      .neq('status', 'disabled')
      .limit(1)
      .maybeSingle();

    if (sensorError) {
      log('error', 'Error looking up sensor', { error: sensorError.message });
    } else if (sensorData) {
      sensor = sensorData as SensorRecord;
      orgId = sensor.org_id;
      unitId = sensor.unit_id;
      siteId = sensor.site_id;
      log('info', 'Found registered sensor', { sensor_id: sensor.id, org_id: orgId, unit_id: unitId });
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
      return new Response(
        JSON.stringify({ ok: true, status: 'unassigned', message: 'DevEUI not registered - uplink logged for later assignment' }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Update unit_telemetry if we have a unit_id
    if (unitId) {
      const now = new Date().toISOString();
      
      // Build the telemetry update based on f_port
      const telemetryUpdate: Record<string, unknown> = {
        org_id: orgId,
        battery_pct: batteryPct,
        rssi_dbm: rssiDbm,
        snr_db: snrDb,
        last_uplink_at: now,
        updated_at: now,
      };

      // f_port 1 = temperature sensor
      if (fPort === 1) {
        const tempC = decodedPayload.temperature as number | undefined;
        const tempF = decodedPayload.temp_f as number | undefined ?? (tempC !== undefined ? tempC * 9/5 + 32 : undefined);
        const humidity = decodedPayload.humidity as number | undefined;

        if (tempF !== undefined) telemetryUpdate.last_temp_f = tempF;
        if (humidity !== undefined) telemetryUpdate.last_humidity = humidity;
      }

      // f_port 2 = door sensor
      if (fPort === 2) {
        const doorStatus = (decodedPayload.door_status ?? decodedPayload.door ?? decodedPayload.open) as string | boolean | undefined;
        
        if (doorStatus !== undefined) {
          // Normalize door state
          let doorState: 'open' | 'closed' = 'unknown' as any;
          if (typeof doorStatus === 'boolean') {
            doorState = doorStatus ? 'open' : 'closed';
          } else if (typeof doorStatus === 'string') {
            doorState = doorStatus.toLowerCase() === 'open' ? 'open' : 'closed';
          }
          
          telemetryUpdate.door_state = doorState;
          telemetryUpdate.last_door_event_at = now;
        }
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
    if (fPort === 1) {
      const sensorData = {
        device_serial: devEui,
        temperature: decodedPayload.temperature as number | null,
        humidity: decodedPayload.humidity as number | null,
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
    } else if (fPort === 2) {
      const doorData = {
        device_serial: devEui,
        door_status: String(decodedPayload.door_status ?? decodedPayload.door ?? 'unknown'),
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

    return new Response(
      JSON.stringify({ 
        ok: true, 
        org_id: orgId,
        unit_id: unitId,
        f_port: fPort,
        sensor_registered: !!sensor,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log('error', 'Unexpected error', { error: errorMessage });
    
    // Never return raw 500 - always return structured error
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal processing error', hint: 'Check server logs for details' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
