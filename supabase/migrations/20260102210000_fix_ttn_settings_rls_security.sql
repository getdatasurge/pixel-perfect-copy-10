-- Fix RLS Security Hole on ttn_settings table
-- Problem: The "webhook" policies with USING (true) bypass org membership checks,
-- allowing any authenticated user to read/modify any organization's TTN API keys.
--
-- Solution: Remove these overly permissive policies. Edge functions use service role
-- which bypasses RLS anyway, so these policies are unnecessary and dangerous.

-- Drop the permissive "webhook" policies that bypass security
DROP POLICY IF EXISTS "Allow webhook select on ttn_settings" ON ttn_settings;
DROP POLICY IF EXISTS "Allow webhook insert on ttn_settings" ON ttn_settings;
DROP POLICY IF EXISTS "Allow webhook update on ttn_settings" ON ttn_settings;

-- The proper org member policies remain in place:
-- - "Org members can view their TTN settings"
-- - "Org members can insert their TTN settings"
-- - "Org members can update their TTN settings"
-- - "Org members can delete their TTN settings"
