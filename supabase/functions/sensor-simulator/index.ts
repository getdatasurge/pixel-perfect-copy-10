import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * sensor-simulator — Direct database injection for alarm scenario testing.
 *
 * Unlike ttn-simulate (which routes through the TTN API), this function
 * writes sensor readings directly to the Supabase tables that FrostGuard
 * monitors. This lets the AlarmScenarioRunner test alert logic without
 * needing a live TTN connection.
 *
 * Expected body:
 * {
 *   action: "inject",
 *   unit_id: "<uuid>",
 *   temperature?: number,   // Fahrenheit
 *   humidity?: number,
 *   door_open?: boolean,
 *   door_open_times?: number,
 *   door_open_duration?: number,
 *   battery_voltage?: number,
 *   battery_percentage?: number,
 *   rx_metadata?: { rssi: number; snr: number },
 * }
 */

interface InjectRequest {
  action: string;
  unit_id: string;
  temperature?: number; // Fahrenheit
  humidity?: number;
  door_open?: boolean;
  door_open_times?: number;
  door_open_duration?: number;
  battery_voltage?: number;
  battery_percentage?: number;
  rx_metadata?: { rssi: number; snr: number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[sensor-simulator][${requestId}] ${req.method} request`);

  try {
    const body: InjectRequest = await req.json();
    const { unit_id, temperature, humidity, door_open, battery_voltage, battery_percentage, rx_metadata } = body;

    if (!unit_id) {
      return new Response(
        JSON.stringify({ success: false, error: "unit_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();

    // Look up sensors assigned to this unit so we have a dev_eui and org_id
    const { data: sensorRow, error: sensorErr } = await supabase
      .from("lora_sensors")
      .select("dev_eui, org_id")
      .eq("unit_id", unit_id)
      .limit(1)
      .maybeSingle();

    if (sensorErr) {
      console.warn(`[sensor-simulator][${requestId}] sensor lookup error:`, sensorErr.message);
    }

    const devEui = sensorRow?.dev_eui ?? "unknown";
    const orgId = sensorRow?.org_id ?? null;

    // Resolve battery percentage from voltage or direct percentage
    let batteryPct: number | null = battery_percentage ?? null;
    if (batteryPct === null && battery_voltage !== undefined) {
      // Li-SOCl2 approximation: 3.6V = 100%, 2.0V = 0%
      batteryPct = Math.max(0, Math.min(100, Math.round(((battery_voltage - 2.0) / 1.6) * 100)));
    }

    const rssi = rx_metadata?.rssi ?? -70;
    const hasDoor = door_open !== undefined;
    const hasTemp = temperature !== undefined;

    // Convert F → C for database storage
    const tempC = hasTemp ? ((temperature! - 32) * 5) / 9 : undefined;

    console.log(`[sensor-simulator][${requestId}] Injecting for unit=${unit_id}, dev_eui=${devEui}, temp=${temperature}F, humidity=${humidity}, door=${door_open}`);

    // 1. sensor_uplinks — raw uplink history
    const payloadJson: Record<string, unknown> = {};
    if (tempC !== undefined) payloadJson.temperature = tempC;
    if (humidity !== undefined) payloadJson.humidity = humidity;
    if (hasDoor) payloadJson.door_open = door_open;
    if (battery_voltage !== undefined) payloadJson.BatV = battery_voltage;
    if (battery_percentage !== undefined) payloadJson.battery = battery_percentage;

    const { error: uplinkErr } = await supabase.from("sensor_uplinks").insert({
      org_id: orgId,
      dev_eui: devEui,
      f_port: 2,
      payload_json: payloadJson,
      rssi_dbm: rssi,
      battery_pct: batteryPct,
      received_at: now,
      unit_id,
    });
    if (uplinkErr) {
      console.warn(`[sensor-simulator][${requestId}] sensor_uplinks insert failed:`, uplinkErr.message);
    }

    // 2. unit_telemetry — real-time state (upsert)
    const telemetry: Record<string, unknown> = {
      unit_id,
      org_id: orgId,
      battery_pct: batteryPct,
      rssi_dbm: rssi,
      last_uplink_at: now,
      updated_at: now,
    };
    if (hasTemp) {
      telemetry.last_temp_f = temperature;
      if (humidity !== undefined) telemetry.last_humidity = humidity;
    }
    if (hasDoor) {
      telemetry.door_state = door_open ? "open" : "closed";
      telemetry.last_door_event_at = now;
    }

    const { error: telemetryErr } = await supabase
      .from("unit_telemetry")
      .upsert(telemetry, { onConflict: "unit_id" });
    if (telemetryErr) {
      console.warn(`[sensor-simulator][${requestId}] unit_telemetry upsert failed:`, telemetryErr.message);
    }

    // 3. sensor_readings — legacy temperature table
    if (hasTemp) {
      const { error: readingErr } = await supabase.from("sensor_readings").insert({
        device_serial: devEui,
        temperature: tempC,
        humidity: humidity ?? null,
        battery_level: batteryPct,
        signal_strength: rssi,
        unit_id,
        reading_type: "scenario",
      });
      if (readingErr) {
        console.warn(`[sensor-simulator][${requestId}] sensor_readings insert failed:`, readingErr.message);
      }
    }

    // 4. door_events — legacy door table
    if (hasDoor) {
      const { error: doorErr } = await supabase.from("door_events").insert({
        device_serial: devEui,
        door_status: door_open ? "open" : "closed",
        battery_level: batteryPct,
        signal_strength: rssi,
        unit_id,
      });
      if (doorErr) {
        console.warn(`[sensor-simulator][${requestId}] door_events insert failed:`, doorErr.message);
      }
    }

    console.log(`[sensor-simulator][${requestId}] Injection complete`);

    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        unit_id,
        dev_eui: devEui,
        server_timestamp: now,
        db_writes: {
          sensor_uplinks: !uplinkErr,
          unit_telemetry: !telemetryErr,
          sensor_readings: hasTemp ? true : "skipped",
          door_events: hasDoor ? true : "skipped",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[sensor-simulator][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
