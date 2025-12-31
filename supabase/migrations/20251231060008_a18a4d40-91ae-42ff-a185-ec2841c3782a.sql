-- Create app_role enum for organization roles
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'member');

-- Create org_members table for organization membership verification
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Enable RLS on org_members
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- Users can read their own memberships
CREATE POLICY "Users can read their own memberships"
  ON public.org_members FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _org_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE user_id = _user_id
      AND org_id = _org_id
      AND role = _role
  )
$$;

-- Create function to check if user is member of org (any role)
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members
    WHERE user_id = _user_id
      AND org_id = _org_id
  )
$$;

-- Create ttn_settings table for per-org TTN configuration
CREATE TABLE public.ttn_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  cluster TEXT NOT NULL DEFAULT 'eu1' CHECK (cluster IN ('eu1', 'nam1', 'au1', 'as1')),
  application_id TEXT,
  api_key TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on ttn_settings - only service role can access
ALTER TABLE public.ttn_settings ENABLE ROW LEVEL SECURITY;

-- No direct access policies - only edge function with service role can access
-- This ensures API keys are never exposed to client

-- Create updated_at trigger for ttn_settings
CREATE OR REPLACE FUNCTION public.update_ttn_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_ttn_settings_updated_at
  BEFORE UPDATE ON public.ttn_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ttn_settings_updated_at();