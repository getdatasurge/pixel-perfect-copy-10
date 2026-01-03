-- Migration: Create lora_gateways table for persistent gateway storage
-- This mirrors the lora_sensors pattern for device provisioning

-- Create gateway status enum
DO $$ BEGIN
    CREATE TYPE public.gateway_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create lora_gateways table
CREATE TABLE IF NOT EXISTS public.lora_gateways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    site_id UUID,
    eui TEXT NOT NULL,
    name TEXT,
    ttn_gateway_id TEXT,
    status gateway_status DEFAULT 'pending',
    cluster TEXT DEFAULT 'eu1',
    frequency_plan TEXT,
    gateway_server_address TEXT,
    is_online BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    provisioned_at TIMESTAMPTZ,
    provision_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Ensure unique EUI per organization
    CONSTRAINT unique_org_gateway_eui UNIQUE(org_id, eui)
);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_lora_gateways_org_id ON public.lora_gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_lora_gateways_eui ON public.lora_gateways(eui);
CREATE INDEX IF NOT EXISTS idx_lora_gateways_status ON public.lora_gateways(status);

-- Enable RLS
ALTER TABLE public.lora_gateways ENABLE ROW LEVEL SECURITY;

-- RLS Policies: org members can read their own gateways
CREATE POLICY "Users can view gateways in their organization"
    ON public.lora_gateways
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_members.org_id = lora_gateways.org_id
            AND org_members.user_id = auth.uid()
        )
    );

-- RLS Policies: org admins/owners can insert gateways
CREATE POLICY "Admins can insert gateways in their organization"
    ON public.lora_gateways
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_members.org_id = lora_gateways.org_id
            AND org_members.user_id = auth.uid()
            AND org_members.role IN ('admin', 'owner')
        )
    );

-- RLS Policies: org admins/owners can update gateways
CREATE POLICY "Admins can update gateways in their organization"
    ON public.lora_gateways
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_members.org_id = lora_gateways.org_id
            AND org_members.user_id = auth.uid()
            AND org_members.role IN ('admin', 'owner')
        )
    );

-- RLS Policies: org admins/owners can delete gateways
CREATE POLICY "Admins can delete gateways in their organization"
    ON public.lora_gateways
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_members.org_id = lora_gateways.org_id
            AND org_members.user_id = auth.uid()
            AND org_members.role IN ('admin', 'owner')
        )
    );

-- Service role bypass for edge functions
CREATE POLICY "Service role has full access to gateways"
    ON public.lora_gateways
    FOR ALL
    USING (auth.role() = 'service_role');

-- Add comment for documentation
COMMENT ON TABLE public.lora_gateways IS 'LoRaWAN gateways provisioned to TTN, mirroring lora_sensors pattern for devices';
COMMENT ON COLUMN public.lora_gateways.eui IS 'Gateway EUI - 16 hex characters (8 bytes)';
COMMENT ON COLUMN public.lora_gateways.ttn_gateway_id IS 'Canonical TTN gateway ID in format: emu-gw-{eui_lowercase}';
COMMENT ON COLUMN public.lora_gateways.status IS 'pending=not yet provisioned, active=successfully provisioned to TTN, disabled=manually disabled';
