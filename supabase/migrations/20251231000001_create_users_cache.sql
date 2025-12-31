-- Create users_cache table for storing mirrored user data from Project 1 (FrostGuard)
-- This table is READ-ONLY from the client perspective - only populated via sync API

CREATE TABLE public.users_cache (
  user_id UUID NOT NULL PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  organization_id UUID,
  site_id UUID,
  unit_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient search queries
CREATE INDEX idx_users_cache_email ON public.users_cache(email);
CREATE INDEX idx_users_cache_full_name ON public.users_cache(full_name);
CREATE INDEX idx_users_cache_organization_id ON public.users_cache(organization_id);
CREATE INDEX idx_users_cache_updated_at ON public.users_cache(updated_at DESC);

-- Enable RLS
ALTER TABLE public.users_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for search functionality)
CREATE POLICY "Allow public read on users_cache"
ON public.users_cache
FOR SELECT
USING (true);

-- No INSERT/UPDATE/DELETE policies for client-side access
-- Data can only be modified via service role (Edge Functions)

-- Add comment explaining the table's purpose
COMMENT ON TABLE public.users_cache IS 'Read-only mirror of user data from FrostGuard (Project 1). Populated exclusively via user-sync API endpoint.';
