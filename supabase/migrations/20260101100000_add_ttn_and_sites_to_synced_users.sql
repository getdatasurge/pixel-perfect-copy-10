-- Add TTN and user_sites support to synced_users table

-- Add new columns for FreshTrack Pro sync payload
ALTER TABLE public.synced_users
  ADD COLUMN IF NOT EXISTS default_site_id uuid,
  ADD COLUMN IF NOT EXISTS user_sites jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ttn jsonb;

-- Update RLS: Remove public read, add service role only
DROP POLICY IF EXISTS "Allow public read on synced_users" ON public.synced_users;

-- Service role can do everything
CREATE POLICY "Service role full access on synced_users"
  ON public.synced_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add index for TTN-enabled users
CREATE INDEX IF NOT EXISTS idx_synced_users_ttn_enabled
  ON public.synced_users ((ttn->>'enabled'))
  WHERE (ttn->>'enabled')::boolean = true;

-- Add index for organization lookups
CREATE INDEX IF NOT EXISTS idx_synced_users_org_id
  ON public.synced_users(source_organization_id);

-- Add comment explaining TTN structure
COMMENT ON COLUMN public.synced_users.ttn IS
'TTN credentials from FreshTrack Pro. Structure: { enabled: boolean, cluster: string, application_id: string, api_key: string (FULL KEY), api_key_last4: string }';
