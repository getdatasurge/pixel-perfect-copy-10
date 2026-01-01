-- Add TTN JSONB column to synced_users table
ALTER TABLE public.synced_users 
ADD COLUMN IF NOT EXISTS ttn jsonb DEFAULT NULL;

COMMENT ON COLUMN public.synced_users.ttn IS 
'TTN integration settings synced from Project 1 (FrostGuard)';