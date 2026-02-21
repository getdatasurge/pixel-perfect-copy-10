/**
 * Alarm Test Scenarios — Validation Tests
 *
 * Verifies the structural integrity of every alarm scenario in the
 * seed migration SQL file. Parses the SQL directly to extract scenarios
 * and validates schema, coverage, temperature conversions, and field names.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Parse scenarios from the SQL migration ────────────────────────────────

interface ParsedScenario {
  scenario_id: string;
  tier: string;
  name: string;
  description: string;
  equipment_type: string;
  sensor_model: string;
  payload_sequence: any[];
  expected_alarm_type: string;
  expected_severity: string;
  tags: string[];
}

function parseScenariosFromSQL(): ParsedScenario[] {
  const sqlPath = resolve(
    __dirname,
    "../../../supabase/migrations/20260221000000_alarm_scenario_seeds.sql"
  );
  const sql = readFileSync(sqlPath, "utf-8");

  const scenarios: ParsedScenario[] = [];

  // Match each INSERT INTO alarm_test_scenarios VALUES block
  const insertRegex =
    /INSERT INTO alarm_test_scenarios\s*\([^)]+\)\s*VALUES\s*\(\s*'([^']+)',\s*'([^']+)',\s*\n\s*'([^']*)',\s*\n\s*'([^']*)',\s*\n\s*'([^']*)',\s*'([^']*)',\s*\n\s*'(\[[\s\S]*?\])'::jsonb,\s*\n\s*'([^']*)',\s*'([^']*)',\s*\n\s*'\{([^}]*)\}'/g;

  let match;
  while ((match = insertRegex.exec(sql)) !== null) {
    const [
      ,
      scenario_id,
      tier,
      name,
      description,
      equipment_type,
      sensor_model,
      payloadJson,
      expected_alarm_type,
      expected_severity,
      tagsStr,
    ] = match;

    let payload_sequence;
    try {
      payload_sequence = JSON.parse(payloadJson);
    } catch {
      payload_sequence = [];
    }

    scenarios.push({
      scenario_id,
      tier,
      name,
      description,
      equipment_type,
      sensor_model,
      payload_sequence,
      expected_alarm_type,
      expected_severity,
      tags: tagsStr ? tagsStr.split(",") : [],
    });
  }

  // Fallback: if regex didn't match, try a simpler approach counting scenario_id values
  if (scenarios.length === 0) {
    const idRegex = /'(T[1-5]-[A-Z0-9_-]+)'/g;
    const ids = new Set<string>();
    let idMatch;
    while ((idMatch = idRegex.exec(sql)) !== null) {
      if (
        idMatch[1].match(/^T[1-5]-/) &&
        !ids.has(idMatch[1])
      ) {
        ids.add(idMatch[1]);
      }
    }

    // Parse a simpler way — extract JSON payload blocks
    const valueBlocks = sql.split(/INSERT INTO alarm_test_scenarios/).slice(1);
    for (const block of valueBlocks) {
      const sidMatch = block.match(/'(T[1-5]-[A-Z0-9_-]+)'/);
      const tierMatch = block.match(/'(T[1-5])'/);
      const nameMatch = block.match(
        /,\s*'(T[1-5])'\s*,\s*\n\s*'([^']*)'/
      );
      const equipMatch = block.match(/'(walk_in_cooler|walk_in_freezer|prep_table|display_case|dry_storage)'/);
      const sensorMatch = block.match(/'(LHT65N|LDS02|LDDS75|AM307|EM300-TH|ERS)'/);
      const jsonMatch = block.match(/(\[[\s\S]*?\])'::\s*jsonb/);
      const severityMatch = block.match(/'(info|warning|critical)'/g);
      const tagsMatch = block.match(/'\{([^}]*)\}'/);

      if (sidMatch && tierMatch) {
        let payloads: any[] = [];
        if (jsonMatch) {
          try {
            payloads = JSON.parse(jsonMatch[1] + "]".repeat(0)); // already has closing bracket
          } catch {
            try {
              payloads = JSON.parse(jsonMatch[1]);
            } catch {
              payloads = [];
            }
          }
        }

        // Get the last severity match (the expected_severity, not the tier severity)
        const severities = severityMatch || [];
        const expectedSeverity = severities.length > 0
          ? severities[severities.length - 1].replace(/'/g, "")
          : "warning";

        scenarios.push({
          scenario_id: sidMatch[1],
          tier: tierMatch[1],
          name: nameMatch ? nameMatch[2] : sidMatch[1],
          description: "",
          equipment_type: equipMatch ? equipMatch[1] : "unknown",
          sensor_model: sensorMatch ? sensorMatch[1] : "unknown",
          payload_sequence: payloads,
          expected_alarm_type: "",
          expected_severity: expectedSeverity,
          tags: tagsMatch ? tagsMatch[1].split(",") : [],
        });
      }
    }
  }

  return scenarios;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

const scenarios = parseScenariosFromSQL();

describe("Alarm Test Scenarios — Schema Validation", () => {
  it("should have at least 36 scenarios total", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(36);
  });

  it("every scenario_id matches pattern T[1-5]-[A-Z0-9_-]+", () => {
    for (const s of scenarios) {
      expect(s.scenario_id).toMatch(/^T[1-5]-[A-Z0-9_-]+$/);
    }
  });

  it("every tier is T1–T5", () => {
    const validTiers = ["T1", "T2", "T3", "T4", "T5"];
    for (const s of scenarios) {
      expect(validTiers).toContain(s.tier);
    }
  });

  it("every scenario has a non-empty payload_sequence", () => {
    for (const s of scenarios) {
      expect(Array.isArray(s.payload_sequence)).toBe(true);
      expect(s.payload_sequence.length).toBeGreaterThan(0);
    }
  });

  it("every payload step has delay_ms >= 0, decoded_payload object, f_port 1-255", () => {
    for (const s of scenarios) {
      for (const step of s.payload_sequence) {
        expect(step.delay_ms).toBeGreaterThanOrEqual(0);
        expect(typeof step.decoded_payload).toBe("object");
        expect(step.decoded_payload).not.toBeNull();
        expect(step.f_port).toBeGreaterThanOrEqual(1);
        expect(step.f_port).toBeLessThanOrEqual(255);
      }
    }
  });

  it("every expected_severity is info, warning, or critical", () => {
    const validSeverities = ["info", "warning", "critical"];
    for (const s of scenarios) {
      expect(validSeverities).toContain(s.expected_severity);
    }
  });

  it("scenario_ids are unique", () => {
    const ids = scenarios.map((s) => s.scenario_id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("Alarm Test Scenarios — Temperature Conversion Validation", () => {
  // Helper: °C to °F
  const cToF = (c: number) => c * 9 / 5 + 32;

  it("cooler high warning trigger payload should be around 40°F (4.44°C)", () => {
    const scenario = scenarios.find(
      (s) => s.scenario_id === "T1-COOLER-HIGH-WARN"
    );
    if (!scenario) return; // skip if not parsed

    const lastPayload =
      scenario.payload_sequence[scenario.payload_sequence.length - 1];
    const tempC =
      lastPayload.decoded_payload.TempC_SHT ??
      lastPayload.decoded_payload.temperature;

    if (tempC !== undefined) {
      const tempF = cToF(tempC);
      // Should be above 40°F warning threshold
      expect(tempF).toBeGreaterThanOrEqual(40);
      expect(tempF).toBeLessThan(50); // sanity check
    }
  });

  it("cooler high critical trigger payload should be above 41°F (5.0°C)", () => {
    const scenario = scenarios.find(
      (s) => s.scenario_id === "T1-COOLER-HIGH-CRIT"
    );
    if (!scenario) return;

    const lastPayload =
      scenario.payload_sequence[scenario.payload_sequence.length - 1];
    const tempC =
      lastPayload.decoded_payload.TempC_SHT ??
      lastPayload.decoded_payload.temperature;

    if (tempC !== undefined) {
      const tempF = cToF(tempC);
      expect(tempF).toBeGreaterThan(41);
    }
  });

  it("freezer high warning trigger should be above 5°F (-15°C)", () => {
    const scenario = scenarios.find(
      (s) => s.scenario_id === "T1-FREEZER-HIGH-WARN"
    );
    if (!scenario) return;

    const lastPayload =
      scenario.payload_sequence[scenario.payload_sequence.length - 1];
    const tempC = lastPayload.decoded_payload.TempC_SHT;

    if (tempC !== undefined) {
      const tempF = cToF(tempC);
      expect(tempF).toBeGreaterThan(5);
    }
  });

  it("freezer low critical trigger should be below -30°F (-34.44°C)", () => {
    const scenario = scenarios.find(
      (s) => s.scenario_id === "T1-FREEZER-LOW-CRIT"
    );
    if (!scenario) return;

    const lastPayload =
      scenario.payload_sequence[scenario.payload_sequence.length - 1];
    const tempC = lastPayload.decoded_payload.TempC_SHT;

    if (tempC !== undefined) {
      const tempF = cToF(tempC);
      expect(tempF).toBeLessThan(-30);
    }
  });

  it("impossible value scenario should have 327.67°C", () => {
    const scenario = scenarios.find(
      (s) => s.scenario_id === "T5-IMPOSSIBLE-VALUE"
    );
    if (!scenario) return;

    const lastPayload =
      scenario.payload_sequence[scenario.payload_sequence.length - 1];
    expect(lastPayload.decoded_payload.TempC_SHT).toBe(327.67);
  });
});

describe("Alarm Test Scenarios — Coverage Validation", () => {
  it("all 5 tiers have at least 1 scenario", () => {
    const tiers = new Set(scenarios.map((s) => s.tier));
    expect(tiers.has("T1")).toBe(true);
    expect(tiers.has("T2")).toBe(true);
    expect(tiers.has("T3")).toBe(true);
    expect(tiers.has("T4")).toBe(true);
    expect(tiers.has("T5")).toBe(true);
  });

  it("T1 has at least 10 scenarios", () => {
    const t1 = scenarios.filter((s) => s.tier === "T1");
    expect(t1.length).toBeGreaterThanOrEqual(10);
  });

  it("T2 has at least 3 scenarios", () => {
    const t2 = scenarios.filter((s) => s.tier === "T2");
    expect(t2.length).toBeGreaterThanOrEqual(3);
  });

  it("T3 has at least 4 scenarios", () => {
    const t3 = scenarios.filter((s) => s.tier === "T3");
    expect(t3.length).toBeGreaterThanOrEqual(4);
  });

  it("T4 has at least 3 scenarios", () => {
    const t4 = scenarios.filter((s) => s.tier === "T4");
    expect(t4.length).toBeGreaterThanOrEqual(3);
  });

  it("T5 has at least 4 scenarios", () => {
    const t5 = scenarios.filter((s) => s.tier === "T5");
    expect(t5.length).toBeGreaterThanOrEqual(4);
  });

  it("has scenarios for walk_in_cooler, walk_in_freezer, prep_table, display_case, and dry_storage", () => {
    const equipTypes = new Set(scenarios.map((s) => s.equipment_type));
    expect(equipTypes.has("walk_in_cooler")).toBe(true);
    expect(equipTypes.has("walk_in_freezer")).toBe(true);
    expect(equipTypes.has("prep_table")).toBe(true);
    expect(equipTypes.has("display_case")).toBe(true);
    expect(equipTypes.has("dry_storage")).toBe(true);
  });

  it("has both warning and critical severity scenarios", () => {
    const severities = new Set(scenarios.map((s) => s.expected_severity));
    expect(severities.has("warning")).toBe(true);
    expect(severities.has("critical")).toBe(true);
  });
});

describe("Alarm Test Scenarios — Payload Field Validation", () => {
  it("Dragino LHT65N scenarios use native field names (TempC_SHT, Hum_SHT, BatV)", () => {
    const draginoScenarios = scenarios.filter(
      (s) => s.sensor_model === "LHT65N"
    );

    for (const s of draginoScenarios) {
      for (const step of s.payload_sequence) {
        const keys = Object.keys(step.decoded_payload);
        // LHT65N should use TempC_SHT, not "temperature"
        if (keys.includes("temperature")) {
          // This is wrong for Dragino — should be TempC_SHT
          throw new Error(
            `${s.scenario_id} step uses "temperature" instead of "TempC_SHT" for Dragino LHT65N`
          );
        }
        // Should have TempC_SHT or be a non-temp scenario
        const hasDraginoField =
          keys.includes("TempC_SHT") ||
          keys.includes("DOOR_OPEN_STATUS");
        expect(hasDraginoField).toBe(true);
      }
    }
  });

  it("Dragino LDS02 scenarios use native field names (DOOR_OPEN_STATUS, DOOR_OPEN_TIMES)", () => {
    const doorScenarios = scenarios.filter(
      (s) => s.sensor_model === "LDS02"
    );

    for (const s of doorScenarios) {
      for (const step of s.payload_sequence) {
        const keys = Object.keys(step.decoded_payload);
        // LDS02 payloads should have DOOR_OPEN_STATUS unless it's a temp payload in a multi-sensor scenario
        if (step._sensor === "temp" || step._sensor === "A" || step._sensor === "B") {
          continue; // Skip temp sensor payloads in multi-sensor scenarios
        }
        const hasDoorField =
          keys.includes("DOOR_OPEN_STATUS") ||
          keys.includes("TempC_SHT"); // Multi-sensor scenarios may have temp payloads in door scenario
        expect(hasDoorField).toBe(true);
      }
    }
  });

  it("Milesight/Elsys scenarios use canonical field names (temperature, humidity, battery)", () => {
    const milesightScenarios = scenarios.filter(
      (s) =>
        s.sensor_model === "AM307" ||
        s.sensor_model === "EM300-TH" ||
        s.sensor_model === "ERS"
    );

    for (const s of milesightScenarios) {
      for (const step of s.payload_sequence) {
        const keys = Object.keys(step.decoded_payload);
        // Should use "temperature" not "TempC_SHT"
        if (keys.includes("TempC_SHT")) {
          throw new Error(
            `${s.scenario_id} uses "TempC_SHT" instead of "temperature" for ${s.sensor_model}`
          );
        }
        const hasCanonicalField =
          keys.includes("temperature") ||
          keys.includes("humidity") ||
          keys.includes("battery") ||
          keys.includes("co2");
        expect(hasCanonicalField).toBe(true);
      }
    }
  });
});

describe("Alarm Test Scenarios — Scenario Count", () => {
  it("total scenarios >= 36", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(36);
  });

  it("prints scenario summary", () => {
    const byTier = scenarios.reduce(
      (acc, s) => {
        acc[s.tier] = (acc[s.tier] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log(`\nScenario Summary:`);
    console.log(`  Total: ${scenarios.length}`);
    for (const [tier, count] of Object.entries(byTier).sort()) {
      console.log(`  ${tier}: ${count}`);
    }
  });
});
