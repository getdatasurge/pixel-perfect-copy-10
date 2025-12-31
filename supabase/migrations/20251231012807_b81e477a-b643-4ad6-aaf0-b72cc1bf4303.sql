-- Create users_cache table for storing synced user data from FrostGuard
CREATE TABLE IF NOT EXISTS public.users_cache (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  organization_id TEXT,
  site_id TEXT,
  unit_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_users_cache_email ON public.users_cache(email);
CREATE INDEX IF NOT EXISTS idx_users_cache_full_name ON public.users_cache(full_name);
CREATE INDEX IF NOT EXISTS idx_users_cache_updated_at ON public.users_cache(updated_at DESC);

-- Enable RLS
ALTER TABLE public.users_cache ENABLE ROW LEVEL SECURITY;

-- Allow read access for all users (the search feature needs this)
CREATE POLICY "Allow read access for users_cache"
  ON public.users_cache
  FOR SELECT
  USING (true);