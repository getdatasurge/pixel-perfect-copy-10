-- Add site_id column to ttn_settings for per-site TTN configurations
ALTER TABLE public.ttn_settings ADD COLUMN site_id uuid DEFAULT NULL;

-- Create unique index for (org_id, site_id) to allow one row per org+site combo
-- NULL site_id means org-level settings
CREATE UNIQUE INDEX ttn_settings_org_site_unique ON public.ttn_settings (org_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Add comment for clarity
COMMENT ON COLUMN public.ttn_settings.site_id IS 'NULL = org-level settings, UUID = site-specific settings';