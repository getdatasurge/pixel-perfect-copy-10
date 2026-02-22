
# Apply alarm_test_scenarios Migration

## Problem
The `alarm_test_scenarios` table doesn't exist in the database. The migration file at `supabase/migrations/20260221000000_alarm_scenario_seeds.sql` was created locally but never applied, so the Alarms tab shows "0 scenarios loaded".

## Solution
Apply the existing migration SQL using the database migration tool. This will:

1. Create the `alarm_test_scenarios` table with columns: `id`, `scenario_id`, `tier`, `name`, `description`, `equipment_type`, `sensor_model`, `payload_sequence`, `expected_alarm_type`, `expected_severity`, `tags`, `created_at`
2. Enable RLS with a read policy for authenticated users
3. Insert all 36 seed scenarios across 5 tiers:
   - T1 (16 scenarios): Threshold breach -- cooler/freezer/prep/display/dry storage temp and humidity thresholds
   - T2 (4 scenarios): Rate of change -- rapid rise, rapid drop, gradual drift
   - T3 (6 scenarios): Duration/persistence -- door open duration, sustained temp, door flapping, sustained humidity
   - T4 (4 scenarios): Pattern/correlation -- multi-sensor drift, single sensor spike, door+temp correlation, night spike
   - T5 (6 scenarios): Equipment lifecycle -- battery drain, signal degradation, sensor offline, firmware glitch, defrost cycle, power outage

## Technical Details
- Run the full contents of `supabase/migrations/20260221000000_alarm_scenario_seeds.sql` as a database migration
- No code changes needed -- the `AlarmScenarioRunner` component already queries this table
- After applying, verify with: `SELECT tier, count(*) FROM alarm_test_scenarios GROUP BY tier ORDER BY tier`
- Expected result: T1=16, T2=4, T3=6, T4=4, T5=6 (36 total)
