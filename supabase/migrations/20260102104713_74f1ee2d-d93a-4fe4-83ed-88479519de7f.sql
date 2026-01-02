-- Add metadata columns to lora_sensors for device template information
ALTER TABLE lora_sensors 
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS description text;

-- Add index for better query performance on sensor_kind
CREATE INDEX IF NOT EXISTS idx_lora_sensors_sensor_kind ON lora_sensors(sensor_kind);

-- Add index for org_id + dev_eui uniqueness (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_sensors_org_dev_eui ON lora_sensors(org_id, dev_eui);