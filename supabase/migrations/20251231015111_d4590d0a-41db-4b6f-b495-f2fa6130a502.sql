-- Create table to store synced users from Project 1
CREATE TABLE public.synced_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text,
  source_organization_id uuid,
  source_site_id uuid,
  source_unit_id uuid,
  synced_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.synced_users ENABLE ROW LEVEL SECURITY;

-- Allow public read (for search functionality)
CREATE POLICY "Allow public read on synced_users" 
  ON public.synced_users FOR SELECT USING (true);

-- Indexes for lookups
CREATE INDEX idx_synced_users_source_user_id ON public.synced_users(source_user_id);
CREATE INDEX idx_synced_users_email ON public.synced_users(email);