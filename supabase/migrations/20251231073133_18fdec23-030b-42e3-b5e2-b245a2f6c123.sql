-- Add ttn_device_id column to lora_sensors table
-- This stores the canonical TTN device_id in format: sensor-{normalized_deveui}
ALTER TABLE lora_sensors 
ADD COLUMN IF NOT EXISTS ttn_device_id text;

-- Add comment explaining the format
COMMENT ON COLUMN lora_sensors.ttn_device_id IS 'Canonical TTN device_id in format sensor-{normalized_deveui}';