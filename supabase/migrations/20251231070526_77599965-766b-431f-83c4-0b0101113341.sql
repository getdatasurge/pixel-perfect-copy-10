-- Enable RLS on ttn_settings table
ALTER TABLE ttn_settings ENABLE ROW LEVEL SECURITY;

-- Allow org members to view their TTN settings
CREATE POLICY "Org members can view their TTN settings"
ON ttn_settings FOR SELECT
USING (is_org_member(auth.uid(), org_id));

-- Allow org members to insert their TTN settings
CREATE POLICY "Org members can insert their TTN settings"
ON ttn_settings FOR INSERT
WITH CHECK (is_org_member(auth.uid(), org_id));

-- Allow org members to update their TTN settings
CREATE POLICY "Org members can update their TTN settings"
ON ttn_settings FOR UPDATE
USING (is_org_member(auth.uid(), org_id));

-- Allow org members to delete their TTN settings
CREATE POLICY "Org members can delete their TTN settings"
ON ttn_settings FOR DELETE
USING (is_org_member(auth.uid(), org_id));

-- Also allow webhook/edge function access (service role bypasses RLS anyway, but add explicit policy for clarity)
CREATE POLICY "Allow webhook select on ttn_settings"
ON ttn_settings FOR SELECT
USING (true);

CREATE POLICY "Allow webhook insert on ttn_settings"
ON ttn_settings FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow webhook update on ttn_settings"
ON ttn_settings FOR UPDATE
USING (true);