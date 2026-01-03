-- Migration: Add separate gateway API key field to ttn_settings
--
-- Background:
-- TTN has different API key types with different permission scopes:
-- - Application API keys: Can only have RIGHT_APPLICATION_* rights
-- - Personal/Organization API keys: Can have gateways:read, gateways:write rights
--
-- The existing api_key field is typically an Application API key used for device provisioning.
-- Gateway provisioning requires a Personal or Organization API key with gateway rights.
-- This migration adds a separate field for the gateway-specific API key.

-- Add gateway_api_key column
ALTER TABLE public.ttn_settings
ADD COLUMN IF NOT EXISTS gateway_api_key TEXT;

-- Add gateway_api_key_last4 for display purposes (like api_key_last4)
ALTER TABLE public.ttn_settings
ADD COLUMN IF NOT EXISTS gateway_api_key_last4 TEXT;

-- Add column to track if gateway key has been validated
ALTER TABLE public.ttn_settings
ADD COLUMN IF NOT EXISTS gateway_key_validated_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN public.ttn_settings.gateway_api_key IS 'Personal or Organization API key with gateways:read and gateways:write rights. Required for gateway provisioning. Must NOT be an Application API key.';
COMMENT ON COLUMN public.ttn_settings.gateway_api_key_last4 IS 'Last 4 characters of gateway API key for display purposes';
COMMENT ON COLUMN public.ttn_settings.gateway_key_validated_at IS 'Timestamp when gateway permissions were last validated successfully';
