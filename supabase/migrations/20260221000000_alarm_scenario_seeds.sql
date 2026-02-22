-- ────────────────────────────────────────────────────────────
-- Alarm Test Scenarios — Seed Data
-- Provides predefined alarm scenario payloads for the emulator
-- to exercise every alarm tier (T1–T5) and equipment type.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alarm_test_scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('T1','T2','T3','T4','T5')),
  name TEXT NOT NULL,
  description TEXT,
  equipment_type TEXT NOT NULL,
  sensor_model TEXT NOT NULL,
  payload_sequence JSONB NOT NULL,
  expected_alarm_type TEXT,
  expected_severity TEXT CHECK (expected_severity IN ('info','warning','critical')),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE alarm_test_scenarios ENABLE ROW LEVEL SECURITY;

-- Allow all users (including anon) to read scenarios
CREATE POLICY "Anyone can read alarm test scenarios"
  ON alarm_test_scenarios FOR SELECT
  USING (true);

-- ════════════════════════════════════════════════════════════
-- T1 — THRESHOLD BREACH SCENARIOS (16 scenarios)
-- ════════════════════════════════════════════════════════════

-- T1-COOLER-HIGH-WARN: Walk-in cooler warning high (40°F / 4.44°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-COOLER-HIGH-WARN', 'T1',
  'Cooler High Warning',
  'Walk-in cooler temperature exceeds warning threshold (40°F / 4.44°C)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal baseline",                    "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Still normal, slight rise",          "decoded_payload": {"TempC_SHT": 3.33, "Hum_SHT": 46.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Crosses warning threshold (40.5°F)", "decoded_payload": {"TempC_SHT": 4.72, "Hum_SHT": 48.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_excursion_warning', 'warning',
  '{temperature,threshold,cooler}'
);

-- T1-COOLER-HIGH-CRIT: Walk-in cooler critical high (41°F / 5.0°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-COOLER-HIGH-CRIT', 'T1',
  'Cooler High Critical',
  'Walk-in cooler temperature exceeds critical threshold (41°F / 5.0°C)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal baseline",           "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "At warning threshold",      "decoded_payload": {"TempC_SHT": 4.44, "Hum_SHT": 47.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Crosses critical (42°F)",   "decoded_payload": {"TempC_SHT": 5.56, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Well above critical (45°F)","decoded_payload": {"TempC_SHT": 7.22, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_excursion_critical', 'critical',
  '{temperature,threshold,cooler}'
);

-- T1-COOLER-LOW-WARN: Walk-in cooler low warning (28°F / -2.22°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-COOLER-LOW-WARN', 'T1',
  'Cooler Low Warning',
  'Walk-in cooler temperature drops below warning low threshold (28°F / -2.22°C)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal baseline",             "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Dropping",                    "decoded_payload": {"TempC_SHT": 0.00, "Hum_SHT": 42.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below warning low (27°F)",    "decoded_payload": {"TempC_SHT": -2.78, "Hum_SHT": 38.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_low_warning', 'warning',
  '{temperature,threshold,cooler,low}'
);

-- T1-COOLER-LOW-CRIT: Walk-in cooler critical low (25°F / -3.89°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-COOLER-LOW-CRIT', 'T1',
  'Cooler Low Critical',
  'Walk-in cooler temperature drops below critical low threshold (25°F / -3.89°C)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal baseline",             "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "At warning low (28°F)",       "decoded_payload": {"TempC_SHT": -2.22, "Hum_SHT": 40.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below critical low (24°F)",   "decoded_payload": {"TempC_SHT": -4.44, "Hum_SHT": 35.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_low_critical', 'critical',
  '{temperature,threshold,cooler,low}'
);

-- T1-FREEZER-HIGH-WARN: Walk-in freezer warning high (5°F / -15.0°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-FREEZER-HIGH-WARN', 'T1',
  'Freezer High Warning',
  'Walk-in freezer temperature exceeds warning threshold (5°F / -15.0°C)',
  'walk_in_freezer', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal freezer baseline (-10°F)", "decoded_payload": {"TempC_SHT": -23.33, "Hum_SHT": 30.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Rising (0°F)",                    "decoded_payload": {"TempC_SHT": -17.78, "Hum_SHT": 35.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above warning (6°F)",             "decoded_payload": {"TempC_SHT": -14.44, "Hum_SHT": 40.0, "BatV": 3.0, "Bat_status": 0}}
  ]'::jsonb,
  'temp_excursion_warning', 'warning',
  '{temperature,threshold,freezer}'
);

-- T1-FREEZER-HIGH-CRIT: Walk-in freezer critical high (10°F / -12.22°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-FREEZER-HIGH-CRIT', 'T1',
  'Freezer High Critical',
  'Walk-in freezer temperature exceeds critical threshold (10°F / -12.22°C)',
  'walk_in_freezer', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal freezer baseline (-10°F)", "decoded_payload": {"TempC_SHT": -23.33, "Hum_SHT": 30.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "At warning (5°F)",                "decoded_payload": {"TempC_SHT": -15.00, "Hum_SHT": 35.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above critical (11°F)",           "decoded_payload": {"TempC_SHT": -11.67, "Hum_SHT": 42.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Severe excursion (20°F)",         "decoded_payload": {"TempC_SHT": -6.67,  "Hum_SHT": 50.0, "BatV": 3.0, "Bat_status": 0}}
  ]'::jsonb,
  'temp_excursion_critical', 'critical',
  '{temperature,threshold,freezer}'
);

-- T1-FREEZER-LOW-WARN: Walk-in freezer low warning (-25°F / -31.67°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-FREEZER-LOW-WARN', 'T1',
  'Freezer Low Warning',
  'Walk-in freezer temperature drops below warning low threshold (-25°F / -31.67°C)',
  'walk_in_freezer', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal freezer (-10°F)",    "decoded_payload": {"TempC_SHT": -23.33, "Hum_SHT": 30.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Getting cold (-20°F)",      "decoded_payload": {"TempC_SHT": -28.89, "Hum_SHT": 25.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below warning low (-26°F)", "decoded_payload": {"TempC_SHT": -32.22, "Hum_SHT": 22.0, "BatV": 3.0, "Bat_status": 0}}
  ]'::jsonb,
  'temp_low_warning', 'warning',
  '{temperature,threshold,freezer,low}'
);

-- T1-FREEZER-LOW-CRIT: Walk-in freezer critical low (-30°F / -34.44°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-FREEZER-LOW-CRIT', 'T1',
  'Freezer Low Critical',
  'Walk-in freezer temperature drops below critical low threshold (-30°F / -34.44°C)',
  'walk_in_freezer', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal freezer (-10°F)",      "decoded_payload": {"TempC_SHT": -23.33, "Hum_SHT": 30.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "At warning low (-25°F)",      "decoded_payload": {"TempC_SHT": -31.67, "Hum_SHT": 22.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below critical low (-31°F)",  "decoded_payload": {"TempC_SHT": -35.00, "Hum_SHT": 18.0, "BatV": 3.0, "Bat_status": 0}}
  ]'::jsonb,
  'temp_low_critical', 'critical',
  '{temperature,threshold,freezer,low}'
);

-- T1-PREP-HIGH-CRIT: Prep table critical high (41°F / 5.0°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-PREP-HIGH-CRIT', 'T1',
  'Prep Table High Critical',
  'Prep table temperature exceeds critical threshold (41°F / 5.0°C)',
  'prep_table', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal prep table (36°F)", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Approaching (40°F)",       "decoded_payload": {"TempC_SHT": 4.44, "Hum_SHT": 52.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above critical (43°F)",    "decoded_payload": {"TempC_SHT": 6.11, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_excursion_critical', 'critical',
  '{temperature,threshold,prep_table}'
);

-- T1-DISPLAY-HIGH-CRIT: Display case critical high (41°F / 5.0°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-DISPLAY-HIGH-CRIT', 'T1',
  'Display Case High Critical',
  'Display case temperature exceeds critical threshold (41°F / 5.0°C)',
  'display_case', 'EM300-TH',
  '[
    {"delay_ms": 0,     "f_port": 85, "description": "Normal baseline (36°F)", "decoded_payload": {"temperature": 2.22, "humidity": 50.0, "battery": 95}},
    {"delay_ms": 60000, "f_port": 85, "description": "At threshold (40°F)",    "decoded_payload": {"temperature": 4.44, "humidity": 52.0, "battery": 95}},
    {"delay_ms": 60000, "f_port": 85, "description": "Above critical (44°F)",  "decoded_payload": {"temperature": 6.67, "humidity": 58.0, "battery": 95}}
  ]'::jsonb,
  'temp_excursion_critical', 'critical',
  '{temperature,threshold,display_case}'
);

-- T1-DRY-HIGH-WARN: Dry storage warning high (80°F / 26.67°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-DRY-HIGH-WARN', 'T1',
  'Dry Storage High Warning',
  'Dry storage temperature exceeds warning threshold (80°F / 26.67°C)',
  'dry_storage', 'AM307',
  '[
    {"delay_ms": 0,     "f_port": 85, "description": "Normal dry storage (74°F)", "decoded_payload": {"temperature": 23.33, "humidity": 45.0, "co2": 420, "battery": 90}},
    {"delay_ms": 60000, "f_port": 85, "description": "Rising (78°F)",             "decoded_payload": {"temperature": 25.56, "humidity": 48.0, "co2": 430, "battery": 90}},
    {"delay_ms": 60000, "f_port": 85, "description": "Above warning (81°F)",      "decoded_payload": {"temperature": 27.22, "humidity": 52.0, "co2": 440, "battery": 90}}
  ]'::jsonb,
  'temp_excursion_warning', 'warning',
  '{temperature,threshold,dry_storage}'
);

-- T1-DRY-HIGH-CRIT: Dry storage critical high (90°F / 32.22°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-DRY-HIGH-CRIT', 'T1',
  'Dry Storage High Critical',
  'Dry storage temperature exceeds critical threshold (90°F / 32.22°C)',
  'dry_storage', 'AM307',
  '[
    {"delay_ms": 0,     "f_port": 85, "description": "Normal dry storage (74°F)", "decoded_payload": {"temperature": 23.33, "humidity": 45.0, "co2": 420, "battery": 90}},
    {"delay_ms": 60000, "f_port": 85, "description": "Above warning (84°F)",      "decoded_payload": {"temperature": 28.89, "humidity": 50.0, "co2": 440, "battery": 90}},
    {"delay_ms": 60000, "f_port": 85, "description": "Above critical (92°F)",     "decoded_payload": {"temperature": 33.33, "humidity": 55.0, "co2": 460, "battery": 90}}
  ]'::jsonb,
  'temp_excursion_critical', 'critical',
  '{temperature,threshold,dry_storage}'
);

-- T1-HUMID-HIGH-WARN: Humidity high warning (70%)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-HUMID-HIGH-WARN', 'T1',
  'Humidity High Warning',
  'Humidity exceeds warning threshold (70%)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal humidity",      "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Rising humidity",      "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 65.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above warning (72%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 72.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'humidity_warning', 'warning',
  '{humidity,threshold}'
);

-- T1-HUMID-HIGH-CRIT: Humidity high critical (80%)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-HUMID-HIGH-CRIT', 'T1',
  'Humidity High Critical',
  'Humidity exceeds critical threshold (80%)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal humidity",      "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above warning (75%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 75.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Above critical (85%)", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 85.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'humidity_critical', 'critical',
  '{humidity,threshold}'
);

-- T1-HUMID-LOW-WARN: Humidity low warning (20%)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-HUMID-LOW-WARN', 'T1',
  'Humidity Low Warning',
  'Humidity drops below warning low threshold (20%)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal humidity",         "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Dropping",                "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 28.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below warning low (18%)", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 18.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'humidity_low_warning', 'warning',
  '{humidity,threshold,low}'
);

-- T1-HUMID-LOW-CRIT: Humidity low critical (15%)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T1-HUMID-LOW-CRIT', 'T1',
  'Humidity Low Critical',
  'Humidity drops below critical low threshold (15%)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal humidity",          "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below warning low (18%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 18.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below critical low (12%)", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 12.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'humidity_low_critical', 'critical',
  '{humidity,threshold,low}'
);

-- ════════════════════════════════════════════════════════════
-- T2 — RATE OF CHANGE SCENARIOS (4 scenarios)
-- ════════════════════════════════════════════════════════════

-- T2-COOLER-RAPID-RISE: Compressor failure simulation
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T2-COOLER-RAPID-RISE', 'T2',
  'Cooler Rapid Rise',
  'Rapid temperature rise in cooler — simulates compressor failure (+6°F in 20 min)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Normal baseline (36°F)",    "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Slight rise (37°F)",        "decoded_payload": {"TempC_SHT": 2.78, "Hum_SHT": 46.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Accelerating (38.5°F)",     "decoded_payload": {"TempC_SHT": 3.61, "Hum_SHT": 48.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Rapid rise (40.5°F)",       "decoded_payload": {"TempC_SHT": 4.72, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "+6°F in 20 min — triggers", "decoded_payload": {"TempC_SHT": 5.56, "Hum_SHT": 53.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_rising_fast', 'critical',
  '{temperature,rate_of_change,cooler,compressor}'
);

-- T2-FREEZER-RAPID-RISE: Door left open simulation
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T2-FREEZER-RAPID-RISE', 'T2',
  'Freezer Rapid Rise',
  'Rapid temperature rise in freezer — simulates door left open (+15°F in 15 min)',
  'walk_in_freezer', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Normal freezer (-10°F)",       "decoded_payload": {"TempC_SHT": -23.33, "Hum_SHT": 30.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Rising (-6°F)",                "decoded_payload": {"TempC_SHT": -21.11, "Hum_SHT": 35.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Rising fast (-1°F)",           "decoded_payload": {"TempC_SHT": -18.33, "Hum_SHT": 40.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "+15°F in 15 min (5°F)",        "decoded_payload": {"TempC_SHT": -15.00, "Hum_SHT": 48.0, "BatV": 3.0, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Continuing to rise (11°F)",    "decoded_payload": {"TempC_SHT": -11.67, "Hum_SHT": 55.0, "BatV": 3.0, "Bat_status": 0}}
  ]'::jsonb,
  'temp_rising_fast', 'critical',
  '{temperature,rate_of_change,freezer,door}'
);

-- T2-COOLER-RAPID-DROP: Sensor in wrong location
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T2-COOLER-RAPID-DROP', 'T2',
  'Cooler Rapid Drop',
  'Rapid temperature drop — sensor placed in freezer by mistake (-18°F in 15 min)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Normal cooler (36°F)",          "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Dropping (32°F)",               "decoded_payload": {"TempC_SHT": 0.00, "Hum_SHT": 42.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Dropping fast (26°F)",          "decoded_payload": {"TempC_SHT": -3.33, "Hum_SHT": 38.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "-18°F in 15 min (18°F)",        "decoded_payload": {"TempC_SHT": -7.78, "Hum_SHT": 30.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_dropping_fast', 'warning',
  '{temperature,rate_of_change,cooler,misplaced}'
);

-- T2-COOLER-GRADUAL-DRIFT: Gradual drift over 30 minutes
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T2-COOLER-GRADUAL-DRIFT', 'T2',
  'Cooler Gradual Drift',
  'Gradual temperature drift that crosses threshold over 50 minutes (+5°F over 50 min)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Normal baseline (36°F)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Slow rise (37°F)",        "decoded_payload": {"TempC_SHT": 2.78, "Hum_SHT": 46.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Continuing (38°F)",       "decoded_payload": {"TempC_SHT": 3.33, "Hum_SHT": 47.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Still rising (39°F)",     "decoded_payload": {"TempC_SHT": 3.89, "Hum_SHT": 48.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "At warning (40°F)",       "decoded_payload": {"TempC_SHT": 4.44, "Hum_SHT": 49.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Crosses threshold (41°F)","decoded_payload": {"TempC_SHT": 5.00, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_rising_slow', 'warning',
  '{temperature,rate_of_change,cooler,gradual}'
);

-- ════════════════════════════════════════════════════════════
-- T3 — DURATION / PERSISTENCE SCENARIOS (6 scenarios)
-- ════════════════════════════════════════════════════════════

-- T3-DOOR-OPEN-WARN: Door open > 5 min
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-DOOR-OPEN-WARN', 'T3',
  'Door Open Warning',
  'Door open for more than 5 minutes',
  'walk_in_cooler', 'LDS02',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Door closed baseline",   "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 5, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 10000,  "f_port": 2, "description": "Door opens",             "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 6, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 180000, "f_port": 2, "description": "Still open at 3 min",    "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 6, "LAST_DOOR_OPEN_DURATION": 180, "BatV": 3.0}},
    {"delay_ms": 180000, "f_port": 2, "description": "Open > 5 min — warning", "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 6, "LAST_DOOR_OPEN_DURATION": 360, "BatV": 3.0}}
  ]'::jsonb,
  'door_open_warning', 'warning',
  '{door,duration,cooler}'
);

-- T3-DOOR-OPEN-CRIT: Door open > 10 min
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-DOOR-OPEN-CRIT', 'T3',
  'Door Open Critical',
  'Door open for more than 10 minutes',
  'walk_in_cooler', 'LDS02',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Door closed baseline",     "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 10, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 10000,  "f_port": 2, "description": "Door opens",               "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Still open — 5 min",       "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 300, "BatV": 3.0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Still open — 10 min crit", "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 600, "BatV": 3.0}},
    {"delay_ms": 120000, "f_port": 2, "description": "Confirmed critical 12 min","decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 720, "BatV": 3.0}}
  ]'::jsonb,
  'door_open_critical', 'critical',
  '{door,duration,cooler}'
);

-- T3-TEMP-SUSTAINED-15: Temp above threshold for 15 min
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-TEMP-SUSTAINED-15', 'T3',
  'Temp Sustained 15 min',
  'Temperature above threshold sustained for 15 minutes',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Already above threshold (42°F)", "decoded_payload": {"TempC_SHT": 5.56, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Sustained at 5 min (43°F)",      "decoded_payload": {"TempC_SHT": 6.11, "Hum_SHT": 56.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Sustained at 10 min (42.5°F)",   "decoded_payload": {"TempC_SHT": 5.83, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 300000, "f_port": 2, "description": "Sustained 15 min — alarm",       "decoded_payload": {"TempC_SHT": 6.39, "Hum_SHT": 57.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_sustained_danger', 'critical',
  '{temperature,duration,cooler}'
);

-- T3-TEMP-SUSTAINED-30: Temp above threshold for 30 min
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-TEMP-SUSTAINED-30', 'T3',
  'Temp Sustained 30 min',
  'Temperature above threshold sustained for 30 minutes',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Above threshold (42°F)",    "decoded_payload": {"TempC_SHT": 5.56, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Sustained 10 min (44°F)",   "decoded_payload": {"TempC_SHT": 6.67, "Hum_SHT": 58.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Sustained 20 min (45°F)",   "decoded_payload": {"TempC_SHT": 7.22, "Hum_SHT": 60.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Sustained 30 min — alarm",  "decoded_payload": {"TempC_SHT": 7.78, "Hum_SHT": 62.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'temp_sustained_danger', 'critical',
  '{temperature,duration,cooler}'
);

-- T3-DOOR-FLAPPING: Intermittent door flapping
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-DOOR-FLAPPING', 'T3',
  'Door Flapping',
  'Intermittent door flapping — open/close/open rapidly (3 cycles in 2 min)',
  'walk_in_cooler', 'LDS02',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Baseline closed",  "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 10, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 30000, "f_port": 2, "description": "Open",             "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 15000, "f_port": 2, "description": "Closed",           "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 11, "LAST_DOOR_OPEN_DURATION": 15, "BatV": 3.0}},
    {"delay_ms": 30000, "f_port": 2, "description": "Open again",       "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 12, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}},
    {"delay_ms": 15000, "f_port": 2, "description": "Closed again",     "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 12, "LAST_DOOR_OPEN_DURATION": 15, "BatV": 3.0}},
    {"delay_ms": 30000, "f_port": 2, "description": "Open — 3 cycles",  "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 13, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}}
  ]'::jsonb,
  'door_rapid_cycling', 'warning',
  '{door,pattern,cooler}'
);

-- T3-HUMID-SUSTAINED: Humidity sustained above 80% for 1 hour
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T3-HUMID-SUSTAINED', 'T3',
  'Humidity Sustained',
  'Humidity sustained above 80% for 1 hour',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,       "f_port": 2, "description": "Already above 80%",       "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 82.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000,  "f_port": 2, "description": "Sustained 10 min (83%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 83.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000,  "f_port": 2, "description": "Sustained 20 min (84%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 84.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000,  "f_port": 2, "description": "Sustained 30 min (85%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 85.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000,  "f_port": 2, "description": "Sustained 40 min (86%)",  "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 86.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 1200000, "f_port": 2, "description": "1 hour sustained — alarm","decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 87.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'humidity_sustained_critical', 'critical',
  '{humidity,duration,cooler}'
);

-- ════════════════════════════════════════════════════════════
-- T4 — PATTERN / CORRELATION SCENARIOS (4 scenarios)
-- ════════════════════════════════════════════════════════════

-- T4-MULTI-SENSOR-DRIFT: Multiple sensors drifting high
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T4-MULTI-SENSOR-DRIFT', 'T4',
  'Multi-Sensor Drift',
  'Multiple sensors in same unit all drifting high — compressor dying. Requires 2+ sensors on same unit.',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Sensor A baseline (36°F)",         "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B baseline (36.5°F)",       "decoded_payload": {"TempC_SHT": 2.50, "Hum_SHT": 46.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"},
    {"delay_ms": 300000, "f_port": 2, "description": "Sensor A rising (38°F)",           "decoded_payload": {"TempC_SHT": 3.33, "Hum_SHT": 48.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B also rising (38.5°F)",    "decoded_payload": {"TempC_SHT": 3.61, "Hum_SHT": 49.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"},
    {"delay_ms": 300000, "f_port": 2, "description": "Sensor A at warning (40°F)",       "decoded_payload": {"TempC_SHT": 4.44, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B also at warning (40.5°F)","decoded_payload": {"TempC_SHT": 4.72, "Hum_SHT": 51.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"}
  ]'::jsonb,
  'site_wide_temp_rise', 'critical',
  '{temperature,pattern,correlation,multi_sensor}'
);

-- T4-SINGLE-SENSOR-SPIKE: One sensor spiking, others normal
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T4-SINGLE-SENSOR-SPIKE', 'T4',
  'Single Sensor Spike',
  'One sensor spiking while others remain normal — sensor fault or localized issue. Requires 2+ sensors.',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Sensor A baseline (36°F)",      "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B normal (36°F)",        "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"},
    {"delay_ms": 300000, "f_port": 2, "description": "Sensor A spikes (45°F)",        "decoded_payload": {"TempC_SHT": 7.22, "Hum_SHT": 60.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B still normal (36.2°F)","decoded_payload": {"TempC_SHT": 2.33, "Hum_SHT": 45.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"},
    {"delay_ms": 300000, "f_port": 2, "description": "Sensor A severe spike (50°F)",  "decoded_payload": {"TempC_SHT": 10.00,"Hum_SHT": 65.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "A"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Sensor B still stable (36.1°F)","decoded_payload": {"TempC_SHT": 2.28, "Hum_SHT": 45.0, "BatV": 3.0, "Bat_status": 0}, "_sensor": "B"}
  ]'::jsonb,
  'isolated_unit_failure', 'warning',
  '{temperature,pattern,correlation,sensor_fault}'
);

-- T4-DOOR-TEMP-CORRELATION: Door open + temp rising
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T4-DOOR-TEMP-CORRELATION', 'T4',
  'Door + Temp Correlation',
  'Door open event correlates with temperature rise. Requires door sensor (LDS02) + temp sensor (LHT65N) on same unit.',
  'walk_in_cooler', 'LDS02',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Door closed",                   "decoded_payload": {"DOOR_OPEN_STATUS": 0, "DOOR_OPEN_TIMES": 5, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}, "_sensor": "door"},
    {"delay_ms": 30000,  "f_port": 2, "description": "Temp baseline (36°F)",          "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "temp"},
    {"delay_ms": 60000,  "f_port": 2, "description": "Door opens",                    "decoded_payload": {"DOOR_OPEN_STATUS": 1, "DOOR_OPEN_TIMES": 6, "LAST_DOOR_OPEN_DURATION": 0, "BatV": 3.0}, "_sensor": "door"},
    {"delay_ms": 120000, "f_port": 2, "description": "Temp rising after door (38°F)", "decoded_payload": {"TempC_SHT": 3.33, "Hum_SHT": 50.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "temp"},
    {"delay_ms": 300000, "f_port": 2, "description": "Temp crosses threshold (41°F)", "decoded_payload": {"TempC_SHT": 5.00, "Hum_SHT": 55.0, "BatV": 3.1, "Bat_status": 0}, "_sensor": "temp"}
  ]'::jsonb,
  'door_open_temp_rising', 'warning',
  '{door,temperature,pattern,correlation}'
);

-- T4-HUMID-TEMP-CORRELATION: Humidity + temp spike — gasket failure
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T4-HUMID-TEMP-CORRELATION', 'T4',
  'Humidity + Temp Correlation',
  'Humidity spike correlates with temperature spike — possible gasket failure',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,      "f_port": 2, "description": "Normal baseline",           "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Both slightly rising",      "decoded_payload": {"TempC_SHT": 2.78, "Hum_SHT": 52.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Humidity rising faster",    "decoded_payload": {"TempC_SHT": 3.33, "Hum_SHT": 60.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Both continuing to climb",  "decoded_payload": {"TempC_SHT": 3.89, "Hum_SHT": 68.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 600000, "f_port": 2, "description": "Correlated drift — gasket", "decoded_payload": {"TempC_SHT": 4.44, "Hum_SHT": 75.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'gasket_leak_infer', 'warning',
  '{humidity,temperature,pattern,correlation,gasket}'
);

-- ════════════════════════════════════════════════════════════
-- T5 — SYSTEM / INFRASTRUCTURE SCENARIOS (6 scenarios)
-- ════════════════════════════════════════════════════════════

-- T5-BATTERY-LOW-WARN: Battery < 2.8V
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-BATTERY-LOW-WARN', 'T5',
  'Battery Low Warning',
  'Battery voltage drops below low-battery warning threshold (2.8V)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal battery (3.1V)",    "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Battery declining (2.9V)", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 2.9, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below 2.8V — warning",     "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 2.75,"Bat_status": 1}}
  ]'::jsonb,
  'battery_low', 'warning',
  '{battery,system,sensor_health}'
);

-- T5-BATTERY-LOW-CRIT: Battery < 2.5V
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-BATTERY-LOW-CRIT', 'T5',
  'Battery Critical',
  'Battery voltage drops below critical threshold (2.5V)',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal battery (3.1V)",   "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Battery low (2.7V)",      "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 2.7, "Bat_status": 1}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below 2.5V — critical",   "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 2.4, "Bat_status": 2}}
  ]'::jsonb,
  'battery_critical', 'critical',
  '{battery,system,sensor_health}'
);

-- T5-OFFLINE-WARN: No uplink for 15+ minutes
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-OFFLINE-WARN', 'T5',
  'Sensor Offline Warning',
  'No uplink received for 15+ minutes — sensor offline warning. Send one reading then stop.',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0, "f_port": 2, "description": "Last normal reading — then silence for 15+ min", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'sensor_offline', 'warning',
  '{offline,system,sensor_health}'
);

-- T5-OFFLINE-CRIT: No uplink for 60+ minutes
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-OFFLINE-CRIT', 'T5',
  'Sensor Offline Critical',
  'No uplink received for 60+ minutes — sensor offline critical. Send one reading then stop.',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0, "f_port": 2, "description": "Last normal reading — then silence for 60+ min", "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'sensor_offline_critical', 'critical',
  '{offline,system,sensor_health}'
);

-- T5-SIGNAL-POOR: RSSI < -120 dBm
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-SIGNAL-POOR', 'T5',
  'Poor Signal',
  'RSSI below -120 dBm — poor signal quality. RSSI is in rx_metadata, not decoded_payload.',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal signal (RSSI -80)",   "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_rx_metadata": {"rssi": -80,  "snr": 8.0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Degrading signal (RSSI -105)","decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_rx_metadata": {"rssi": -105, "snr": 2.0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Below -120 — poor signal",   "decoded_payload": {"TempC_SHT": 2.22, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}, "_rx_metadata": {"rssi": -125, "snr": -5.0}}
  ]'::jsonb,
  'signal_poor', 'warning',
  '{signal,system,sensor_health}'
);

-- T5-IMPOSSIBLE-VALUE: Sensor fault (327.67°C)
INSERT INTO alarm_test_scenarios (scenario_id, tier, name, description, equipment_type, sensor_model, payload_sequence, expected_alarm_type, expected_severity, tags)
VALUES (
  'T5-IMPOSSIBLE-VALUE', 'T5',
  'Impossible Value',
  'Sensor reports physically impossible temperature (327.67°C) — LHT65 probe disconnected error code',
  'walk_in_cooler', 'LHT65N',
  '[
    {"delay_ms": 0,     "f_port": 2, "description": "Normal reading",          "decoded_payload": {"TempC_SHT": 2.22,   "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}},
    {"delay_ms": 60000, "f_port": 2, "description": "Impossible — probe fault", "decoded_payload": {"TempC_SHT": 327.67, "Hum_SHT": 45.0, "BatV": 3.1, "Bat_status": 0}}
  ]'::jsonb,
  'reading_impossible', 'critical',
  '{impossible,system,sensor_health,fault}'
);

-- ────────────────────────────────────────────────────────────
-- VERIFICATION
-- ────────────────────────────────────────────────────────────
-- SELECT tier, count(*) FROM alarm_test_scenarios GROUP BY tier ORDER BY tier;
-- Expected: T1=16, T2=4, T3=6, T4=4, T5=6 = 36 total
-- SELECT count(*) FROM alarm_test_scenarios; -- Should be 36
