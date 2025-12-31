-- Phase 1: LoRaWAN Door Sensor Architecture
-- Create enum types for sensor management

-- Sensor kind enum
DO $$ BEGIN
  CREATE TYPE sensor_kind AS ENUM ('temp', 'door', 'combo');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Sensor status enum
DO $$ BEGIN
  CREATE TYPE sensor_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Door state enum
DO $$ BEGIN
  CREATE TYPE door_state AS ENUM ('open', 'closed', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. Create lora_sensors table (device registry)
CREATE TABLE IF NOT EXISTS public.lora_sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  site_id UUID,
  unit_id UUID NOT NULL,
  dev_eui TEXT NOT NULL,
  sensor_kind sensor_kind NOT NULL DEFAULT 'temp',
  join_eui TEXT,
  app_key TEXT,
  ttn_application_id TEXT,
  ttn_region TEXT DEFAULT 'nam1',
  status sensor_status DEFAULT 'pending',
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_org_dev_eui UNIQUE(org_id, dev_eui)
);

-- 2. Create unit_telemetry table (live state per unit)
CREATE TABLE IF NOT EXISTS public.unit_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL UNIQUE,
  org_id UUID NOT NULL,
  last_temp_f NUMERIC,
  last_humidity NUMERIC,
  door_state door_state DEFAULT 'unknown',
  last_door_event_at TIMESTAMPTZ,
  battery_pct INTEGER,
  rssi_dbm INTEGER,
  snr_db NUMERIC,
  last_uplink_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Alert configuration
  expected_checkin_minutes INTEGER DEFAULT 5,
  warn_after_missed INTEGER DEFAULT 1,
  critical_after_missed INTEGER DEFAULT 5
);

-- 3. Create sensor_uplinks table (raw history)
CREATE TABLE IF NOT EXISTS public.sensor_uplinks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  unit_id UUID,
  dev_eui TEXT NOT NULL,
  f_port INTEGER,
  payload_json JSONB,
  rssi_dbm INTEGER,
  snr_db NUMERIC,
  battery_pct INTEGER,
  received_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lora_sensors_org_id ON public.lora_sensors(org_id);
CREATE INDEX IF NOT EXISTS idx_lora_sensors_dev_eui ON public.lora_sensors(dev_eui);
CREATE INDEX IF NOT EXISTS idx_unit_telemetry_org_id ON public.unit_telemetry(org_id);
CREATE INDEX IF NOT EXISTS idx_sensor_uplinks_org_id ON public.sensor_uplinks(org_id);
CREATE INDEX IF NOT EXISTS idx_sensor_uplinks_dev_eui ON public.sensor_uplinks(dev_eui);
CREATE INDEX IF NOT EXISTS idx_sensor_uplinks_received_at ON public.sensor_uplinks(received_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.lora_sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_uplinks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lora_sensors
CREATE POLICY "Org members can view their sensors"
  ON public.lora_sensors FOR SELECT
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can insert sensors"
  ON public.lora_sensors FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can update their sensors"
  ON public.lora_sensors FOR UPDATE
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can delete their sensors"
  ON public.lora_sensors FOR DELETE
  USING (public.is_org_member(auth.uid(), org_id));

-- RLS Policies for unit_telemetry
CREATE POLICY "Org members can view their telemetry"
  ON public.unit_telemetry FOR SELECT
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can insert telemetry"
  ON public.unit_telemetry FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can update their telemetry"
  ON public.unit_telemetry FOR UPDATE
  USING (public.is_org_member(auth.uid(), org_id));

-- RLS Policies for sensor_uplinks
CREATE POLICY "Org members can view their uplinks"
  ON public.sensor_uplinks FOR SELECT
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can insert uplinks"
  ON public.sensor_uplinks FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

-- Also allow service role / anon for webhook ingestion (edge function uses service role)
CREATE POLICY "Allow webhook insert on lora_sensors"
  ON public.lora_sensors FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow webhook select on lora_sensors"
  ON public.lora_sensors FOR SELECT
  USING (true);

CREATE POLICY "Allow webhook insert on unit_telemetry"
  ON public.unit_telemetry FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow webhook update on unit_telemetry"
  ON public.unit_telemetry FOR UPDATE
  USING (true);

CREATE POLICY "Allow webhook select on unit_telemetry"
  ON public.unit_telemetry FOR SELECT
  USING (true);

CREATE POLICY "Allow webhook insert on sensor_uplinks"
  ON public.sensor_uplinks FOR INSERT
  WITH CHECK (true);

-- Enable realtime for unit_telemetry (for dashboard updates)
ALTER TABLE public.unit_telemetry REPLICA IDENTITY FULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_lora_sensors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_lora_sensors_updated_at
  BEFORE UPDATE ON public.lora_sensors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lora_sensors_updated_at();

CREATE OR REPLACE FUNCTION public.update_unit_telemetry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_unit_telemetry_updated_at
  BEFORE UPDATE ON public.unit_telemetry
  FOR EACH ROW
  EXECUTE FUNCTION public.update_unit_telemetry_updated_at();