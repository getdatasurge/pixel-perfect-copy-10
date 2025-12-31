-- Create user_site_memberships table to store multi-site relationships
CREATE TABLE IF NOT EXISTS public.user_site_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_user_id uuid NOT NULL,
  site_id uuid NOT NULL,
  site_name text,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(source_user_id, site_id)
);

-- Add default_site_id column to synced_users for quick access
ALTER TABLE public.synced_users 
ADD COLUMN IF NOT EXISTS default_site_id uuid;

-- Enable RLS
ALTER TABLE public.user_site_memberships ENABLE ROW LEVEL SECURITY;

-- Allow public read access (matching synced_users pattern)
CREATE POLICY "Allow public read on user_site_memberships" 
ON public.user_site_memberships FOR SELECT 
USING (true);

-- Allow insert from edge functions (service role)
CREATE POLICY "Allow service role insert on user_site_memberships"
ON public.user_site_memberships FOR INSERT
WITH CHECK (true);

-- Allow delete from edge functions (service role)
CREATE POLICY "Allow service role delete on user_site_memberships"
ON public.user_site_memberships FOR DELETE
USING (true);