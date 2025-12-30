import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SensorReading {
  device_serial: string;
  temperature?: number;
  humidity?: number;
  battery_level?: number;
  signal_strength?: number;
  unit_id?: string;
  reading_type?: string;
}

interface DoorEvent {
  device_serial: string;
  door_status: 'open' | 'closed';
  battery_level?: number;
  signal_strength?: number;
  unit_id?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log('Received payload:', JSON.stringify(body));

    const { type, data } = body;

    if (!type || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing type or data in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'sensor_reading') {
      const reading = data as SensorReading;
      
      if (!reading.device_serial) {
        return new Response(
          JSON.stringify({ error: 'device_serial is required for sensor readings' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: insertedData, error } = await supabase
        .from('sensor_readings')
        .insert({
          device_serial: reading.device_serial,
          temperature: reading.temperature,
          humidity: reading.humidity,
          battery_level: reading.battery_level,
          signal_strength: reading.signal_strength,
          unit_id: reading.unit_id,
          reading_type: reading.reading_type || 'scheduled',
        })
        .select()
        .single();

      if (error) {
        console.error('Error inserting sensor reading:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Inserted sensor reading:', insertedData);
      return new Response(
        JSON.stringify({ success: true, data: insertedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'door_event') {
      const event = data as DoorEvent;
      
      if (!event.device_serial || !event.door_status) {
        return new Response(
          JSON.stringify({ error: 'device_serial and door_status are required for door events' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!['open', 'closed'].includes(event.door_status)) {
        return new Response(
          JSON.stringify({ error: 'door_status must be either "open" or "closed"' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: insertedData, error } = await supabase
        .from('door_events')
        .insert({
          device_serial: event.device_serial,
          door_status: event.door_status,
          battery_level: event.battery_level,
          signal_strength: event.signal_strength,
          unit_id: event.unit_id,
        })
        .select()
        .single();

      if (error) {
        console.error('Error inserting door event:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Inserted door event:', insertedData);
      return new Response(
        JSON.stringify({ success: true, data: insertedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid type. Must be "sensor_reading" or "door_event"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing request:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
