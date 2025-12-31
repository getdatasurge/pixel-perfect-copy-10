-- Add columns to track TTN connection test results
ALTER TABLE public.ttn_settings
ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_test_success BOOLEAN;