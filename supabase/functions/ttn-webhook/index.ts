import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: TTNUplinkPayload = await req.json();
    
    console.log('Received TTN webhook payload:', JSON.stringify({
      device_id: payload.end_device_ids?.device_id,
      dev_eui: payload.end_device_ids?.dev_eui,
      f_port: payload.uplink_message?.f_port,
      application_id: payload.end_device_ids?.application_ids?.application_id,
    }));

    // Validate required fields
    if (!payload.end_device_ids?.dev_eui) {
      console.error('Missing dev_eui in payload');
      return new Response(
        JSON.stringify({ error: 'Missing device EUI' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.uplink_message?.decoded_payload) {
      console.error('Missing decoded_payload in payload');
      return new Response(
        JSON.stringify({ error: 'Missing decoded payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const devEui = payload.end_device_ids.dev_eui;
    const decodedPayload = payload.uplink_message.decoded_payload;
    const fPort = payload.uplink_message.f_port;
    const rxMetadata = payload.uplink_message.rx_metadata?.[0];

    console.log('Processing uplink:', { devEui, fPort, decodedPayload });

    // f_port 1 = temperature sensor, f_port 2 = door sensor
    if (fPort === 1) {
      // Temperature sensor reading
      const sensorData = {
        device_serial: devEui,
        temperature: decodedPayload.temperature as number | null,
        humidity: decodedPayload.humidity as number | null,
        battery_level: decodedPayload.battery_level as number | null,
        signal_strength: rxMetadata?.rssi ?? (decodedPayload.signal_strength as number | null),
        unit_id: decodedPayload.unit_id as string | null,
        reading_type: (decodedPayload.reading_type as string) ?? 'scheduled',
      };

      console.log('Inserting sensor reading:', sensorData);

      const { data, error } = await supabase
        .from('sensor_readings')
        .insert(sensorData)
        .select();

      if (error) {
        console.error('Database error inserting sensor reading:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Sensor reading inserted:', data);
      return new Response(
        JSON.stringify({ success: true, type: 'sensor_reading', data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (fPort === 2) {
      // Door sensor event
      const doorData = {
        device_serial: devEui,
        door_status: decodedPayload.door_status as string,
        battery_level: decodedPayload.battery_level as number | null,
        signal_strength: rxMetadata?.rssi ?? (decodedPayload.signal_strength as number | null),
        unit_id: decodedPayload.unit_id as string | null,
      };

      if (!doorData.door_status) {
        console.error('Missing door_status in payload');
        return new Response(
          JSON.stringify({ error: 'Missing door_status' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Inserting door event:', doorData);

      const { data, error } = await supabase
        .from('door_events')
        .insert(doorData)
        .select();

      if (error) {
        console.error('Database error inserting door event:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Door event inserted:', data);
      return new Response(
        JSON.stringify({ success: true, type: 'door_event', data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      console.log('Unknown f_port:', fPort, '- storing as generic reading');
      // For unknown ports, try to store as sensor reading
      const genericData = {
        device_serial: devEui,
        temperature: decodedPayload.temperature as number | null,
        humidity: decodedPayload.humidity as number | null,
        battery_level: decodedPayload.battery_level as number | null,
        signal_strength: rxMetadata?.rssi ?? (decodedPayload.signal_strength as number | null),
        unit_id: decodedPayload.unit_id as string | null,
        reading_type: `port_${fPort}`,
      };

      const { data, error } = await supabase
        .from('sensor_readings')
        .insert(genericData)
        .select();

      if (error) {
        console.error('Database error:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, type: 'generic', data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unexpected error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
