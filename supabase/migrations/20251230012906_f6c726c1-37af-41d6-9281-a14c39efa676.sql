-- Create sensor_readings table for temperature/humidity data
CREATE TABLE public.sensor_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_serial TEXT NOT NULL,
  temperature NUMERIC,
  humidity NUMERIC,
  battery_level INTEGER,
  signal_strength INTEGER,
  unit_id TEXT,
  reading_type TEXT DEFAULT 'scheduled',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create door_events table for door sensor data
CREATE TABLE public.door_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_serial TEXT NOT NULL,
  door_status TEXT NOT NULL CHECK (door_status IN ('open', 'closed')),
  battery_level INTEGER,
  signal_strength INTEGER,
  unit_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_sensor_readings_device_serial ON public.sensor_readings(device_serial);
CREATE INDEX idx_sensor_readings_created_at ON public.sensor_readings(created_at DESC);
CREATE INDEX idx_sensor_readings_unit_id ON public.sensor_readings(unit_id);
CREATE INDEX idx_door_events_device_serial ON public.door_events(device_serial);
CREATE INDEX idx_door_events_created_at ON public.door_events(created_at DESC);
CREATE INDEX idx_door_events_unit_id ON public.door_events(unit_id);

-- Enable RLS but allow public access for testing
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_events ENABLE ROW LEVEL SECURITY;

-- Create policies to allow public read/write for testing purposes
CREATE POLICY "Allow public read on sensor_readings" 
ON public.sensor_readings 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert on sensor_readings" 
ON public.sensor_readings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public read on door_events" 
ON public.door_events 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert on door_events" 
ON public.door_events 
FOR INSERT 
WITH CHECK (true);

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.door_events;