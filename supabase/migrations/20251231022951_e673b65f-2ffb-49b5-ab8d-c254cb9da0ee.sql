-- Migration: Align synced_users schema for test context

-- 1. Enforce organization_id is always present
ALTER TABLE public.synced_users 
  ALTER COLUMN source_organization_id SET NOT NULL;

-- 2. Drop deprecated users_cache table and its policy
DROP POLICY IF EXISTS "Allow read access for users_cache" ON public.users_cache;
DROP TABLE IF EXISTS public.users_cache;