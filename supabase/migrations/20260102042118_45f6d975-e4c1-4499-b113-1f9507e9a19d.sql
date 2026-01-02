-- Add gateway owner configuration to ttn_settings
-- Gateways in TTN are owned by users or organizations, not applications
-- This allows configuring the owner scope for gateway provisioning

ALTER TABLE public.ttn_settings 
ADD COLUMN gateway_owner_type TEXT DEFAULT 'user' CHECK (gateway_owner_type IN ('user', 'organization'));

ALTER TABLE public.ttn_settings 
ADD COLUMN gateway_owner_id TEXT;