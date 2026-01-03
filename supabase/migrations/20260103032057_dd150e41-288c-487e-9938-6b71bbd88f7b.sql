-- Create function for updated_at first (if it doesn't exist)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create lora_gateways table for gateway provisioning
CREATE TABLE IF NOT EXISTS public.lora_gateways (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL,
  site_id UUID,
  eui TEXT NOT NULL,
  name TEXT,
  ttn_gateway_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'provisioned', 'error', 'disabled')),
  cluster TEXT DEFAULT 'nam1',
  frequency_plan TEXT,
  gateway_server_address TEXT,
  is_online BOOLEAN DEFAULT true,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  provisioned_at TIMESTAMP WITH TIME ZONE,
  provision_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(org_id, eui)
);

-- Add gateway_api_key column to ttn_settings for separate gateway API key
ALTER TABLE public.ttn_settings 
ADD COLUMN IF NOT EXISTS gateway_api_key TEXT;

COMMENT ON COLUMN public.ttn_settings.gateway_api_key IS 
  'Personal or Organization API key with gateways:read and gateways:write permissions. Required for gateway provisioning.';

-- Enable Row Level Security on lora_gateways
ALTER TABLE public.lora_gateways ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lora_gateways

-- Allow webhook/edge functions to insert (for provisioning)
CREATE POLICY "Allow webhook insert on lora_gateways"
ON public.lora_gateways
FOR INSERT
WITH CHECK (true);

-- Allow webhook/edge functions to select
CREATE POLICY "Allow webhook select on lora_gateways"
ON public.lora_gateways
FOR SELECT
USING (true);

-- Allow webhook/edge functions to update (for status changes)
CREATE POLICY "Allow webhook update on lora_gateways"
ON public.lora_gateways
FOR UPDATE
USING (true);

-- Org members can view their gateways
CREATE POLICY "Org members can view their gateways"
ON public.lora_gateways
FOR SELECT
USING (is_org_member(auth.uid(), org_id));

-- Org members can insert gateways
CREATE POLICY "Org members can insert gateways"
ON public.lora_gateways
FOR INSERT
WITH CHECK (is_org_member(auth.uid(), org_id));

-- Org members can update their gateways
CREATE POLICY "Org members can update their gateways"
ON public.lora_gateways
FOR UPDATE
USING (is_org_member(auth.uid(), org_id));

-- Org members can delete their gateways
CREATE POLICY "Org members can delete their gateways"
ON public.lora_gateways
FOR DELETE
USING (is_org_member(auth.uid(), org_id));

-- Trigger for automatic timestamp updates
CREATE TRIGGER update_lora_gateways_updated_at
BEFORE UPDATE ON public.lora_gateways
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_lora_gateways_org_id ON public.lora_gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_lora_gateways_eui ON public.lora_gateways(eui);