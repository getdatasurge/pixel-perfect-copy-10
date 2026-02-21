/**
 * Alarm Test Scenarios — loader, runner, batch testing, and verification
 *
 * Fetches predefined alarm scenarios from the alarm_test_scenarios table
 * and runs them by sending sequential uplinks through the sensor-simulator
 * edge function, then triggers evaluate-alarms for alarm pipeline testing.
 *
 * Enhanced features:
 *   - Load/filter scenarios from DB
 *   - Run individual scenarios with real-time progress
 *   - "Turbo" mode: skip inter-step delays for rapid testing
 *   - Batch "Run All Quick": auto-runs all non-time-dependent scenarios
 *   - Alarm verification: checks alarm_events for expected alarm after run
 *   - Cancellable runs via AbortSignal
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PayloadStep {
  delay_ms: number;
  decoded_payload: Record<string, unknown>;
  f_port: number;
  description: string;
  /** For multi-sensor scenarios: identifies which sensor to target ("A", "B", "door", "temp") */
  _sensor?: string;
  /** Optional rx_metadata override for signal-strength scenarios */
  _rx_metadata?: { rssi: number; snr: number };
}

export interface AlarmScenario {
  id: string;
  scenario_id: string;
  tier: "T1" | "T2" | "T3" | "T4" | "T5";
  name: string;
  description: string;
  equipment_type: string;
  sensor_model: string;
  payload_sequence: PayloadStep[];
  expected_alarm_type: string;
  expected_severity: "info" | "warning" | "critical";
  tags: string[];
}

export interface ScenarioRunProgress {
  step: number;
  total: number;
  description: string;
  status: "sending" | "waiting" | "evaluating" | "verifying" | "done";
}

export interface ScenarioResult {
  scenario_id: string;
  started_at: string;
  completed_at: string;
  payloads_sent: number;
  status: "passed" | "failed" | "timeout" | "completed" | "skipped";
  error?: string;
  /** Whether the expected alarm was found in alarm_events after running */
  alarm_verified: boolean | null;
  /** The alarm_event row if found */
  alarm_event?: {
    id: string;
    alarm_type: string;
    severity: string;
    created_at: string;
  };
  steps: {
    step: number;
    description: string;
    sent_at: string;
    success: boolean;
    error?: string;
  }[];
}

export interface BatchRunProgress {
  current_scenario: string;
  scenario_index: number;
  total_scenarios: number;
  scenario_progress?: ScenarioRunProgress;
  status: "running" | "completed" | "cancelled";
}

export interface BatchResult {
  started_at: string;
  completed_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ScenarioResult[];
}

// ─── Run Options ────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Skip inter-step delays (turbo mode for batch testing) */
  turbo?: boolean;
  /** Minimum delay between steps even in turbo mode (ms). Default: 500 */
  turboDelayMs?: number;
  /** Verify the expected alarm was created after running. Default: true */
  verify?: boolean;
  /** AbortSignal to cancel a running scenario */
  signal?: AbortSignal;
}

// ─── Quick-testable classification ─────────────────────────────────────────

/**
 * Maximum total delay (ms) for a scenario to be classified as "quick".
 * T1 threshold scenarios typically have 2-4 steps x 60s = 120-240s total.
 * T5 battery/signal/impossible also have ~120s total delays.
 * These can be safely run in turbo mode without meaningful time gaps.
 */
const QUICK_DELAY_THRESHOLD_MS = 240_000; // 4 min max real delay

/**
 * Scenarios that depend on the ABSENCE of data or cron-based detection.
 * These cannot be meaningfully tested in turbo mode.
 */
const TIME_DEPENDENT_SCENARIO_IDS = new Set([
  "T5-OFFLINE-WARN", // Needs 15+ min without uplinks + cron check
  "T5-OFFLINE-CRIT", // Needs 60+ min without uplinks + cron check
]);

/**
 * Determine if a scenario can be tested "quickly" in turbo mode.
 * Quick = short total delays AND doesn't depend on time-based detection.
 */
export function isQuickScenario(scenario: AlarmScenario): boolean {
  if (TIME_DEPENDENT_SCENARIO_IDS.has(scenario.scenario_id)) return false;

  const totalDelay = scenario.payload_sequence.reduce(
    (sum, step) => sum + step.delay_ms,
    0
  );
  return totalDelay <= QUICK_DELAY_THRESHOLD_MS;
}

/**
 * Classify scenarios into speed categories for the UI.
 */
export type ScenarioSpeed = "instant" | "moderate" | "slow" | "time-dependent";

export function getScenarioSpeed(scenario: AlarmScenario): ScenarioSpeed {
  if (TIME_DEPENDENT_SCENARIO_IDS.has(scenario.scenario_id)) {
    return "time-dependent";
  }
  const totalDelay = scenario.payload_sequence.reduce(
    (sum, step) => sum + step.delay_ms,
    0
  );
  if (totalDelay <= QUICK_DELAY_THRESHOLD_MS) return "instant"; // <= 4min real, ~seconds in turbo
  if (totalDelay <= 1_800_000) return "moderate"; // <= 30 min
  return "slow"; // > 30 min
}

export const SPEED_META: Record<
  ScenarioSpeed,
  { label: string; color: string; icon: string; badgeClass: string }
> = {
  instant: {
    label: "Quick",
    color: "text-emerald-500",
    icon: "⚡",
    badgeClass: "border-emerald-500/40 text-emerald-600 bg-emerald-500/10",
  },
  moderate: {
    label: "5-30 min",
    color: "text-amber-500",
    icon: "🕐",
    badgeClass: "border-amber-500/40 text-amber-600 bg-amber-500/10",
  },
  slow: {
    label: "30+ min",
    color: "text-orange-500",
    icon: "🐢",
    badgeClass: "border-orange-500/40 text-orange-600 bg-orange-500/10",
  },
  "time-dependent": {
    label: "Cron",
    color: "text-purple-500",
    icon: "⏰",
    badgeClass: "border-purple-500/40 text-purple-600 bg-purple-500/10",
  },
};

// ─── Loader ────────────────────────────────────────────────────────────────

/**
 * Fetch all alarm test scenarios from the database.
 * Optionally filter by tier, equipment_type, or severity.
 */
export async function loadScenarios(filters?: {
  tier?: string;
  equipment_type?: string;
  severity?: string;
}): Promise<AlarmScenario[]> {
  const db = supabase as any;
  let query = db
    .from("alarm_test_scenarios")
    .select("*")
    .order("tier")
    .order("scenario_id");

  if (filters?.tier) {
    query = query.eq("tier", filters.tier);
  }
  if (filters?.equipment_type) {
    query = query.eq("equipment_type", filters.equipment_type);
  }
  if (filters?.severity) {
    query = query.eq("expected_severity", filters.severity);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[alarmScenarios] Failed to load scenarios:", error);
    throw new Error(`Failed to load scenarios: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    scenario_id: row.scenario_id,
    tier: row.tier,
    name: row.name,
    description: row.description || "",
    equipment_type: row.equipment_type,
    sensor_model: row.sensor_model,
    payload_sequence:
      typeof row.payload_sequence === "string"
        ? JSON.parse(row.payload_sequence)
        : row.payload_sequence,
    expected_alarm_type: row.expected_alarm_type || "",
    expected_severity: row.expected_severity || "warning",
    tags: row.tags || [],
  }));
}

/**
 * Load a single scenario by its scenario_id (e.g. "T1-COOLER-HIGH-WARN").
 */
export async function loadScenarioById(
  scenarioId: string
): Promise<AlarmScenario | null> {
  const db = supabase as any;
  const { data, error } = await db
    .from("alarm_test_scenarios")
    .select("*")
    .eq("scenario_id", scenarioId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    scenario_id: data.scenario_id,
    tier: data.tier,
    name: data.name,
    description: data.description || "",
    equipment_type: data.equipment_type,
    sensor_model: data.sensor_model,
    payload_sequence:
      typeof data.payload_sequence === "string"
        ? JSON.parse(data.payload_sequence)
        : data.payload_sequence,
    expected_alarm_type: data.expected_alarm_type || "",
    expected_severity: data.expected_severity || "warning",
    tags: data.tags || [],
  };
}

// ─── Runner ────────────────────────────────────────────────────────────────

/**
 * Run a scenario by sending each payload step through the sensor-simulator
 * edge function with the configured delays between steps.
 *
 * Supports turbo mode (skip delays), alarm verification, and cancellation.
 */
export async function runScenario(
  scenarioId: string,
  unitId: string,
  onProgress?: (progress: ScenarioRunProgress) => void,
  options: RunOptions = {}
): Promise<ScenarioResult> {
  const {
    turbo = false,
    turboDelayMs = 500,
    verify = true,
    signal,
  } = options;

  const scenario = await loadScenarioById(scenarioId);
  if (!scenario) {
    return {
      scenario_id: scenarioId,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      payloads_sent: 0,
      status: "failed",
      error: `Scenario not found: ${scenarioId}`,
      alarm_verified: null,
      steps: [],
    };
  }

  const startedAt = new Date().toISOString();
  const steps: ScenarioResult["steps"] = [];
  const payloads = scenario.payload_sequence;

  for (let i = 0; i < payloads.length; i++) {
    if (signal?.aborted) {
      return {
        scenario_id: scenarioId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        payloads_sent: steps.filter((s) => s.success).length,
        status: "failed",
        error: "Cancelled",
        alarm_verified: null,
        steps,
      };
    }

    const step = payloads[i];
    const effectiveDelay = turbo
      ? Math.min(step.delay_ms, turboDelayMs)
      : step.delay_ms;

    // Wait for the delay
    if (effectiveDelay > 0) {
      onProgress?.({
        step: i + 1,
        total: payloads.length,
        description: turbo
          ? `⚡ ${step.description}`
          : `Waiting ${formatDelay(step.delay_ms)} → ${step.description}`,
        status: "waiting",
      });

      await sleep(effectiveDelay, signal);
    }

    onProgress?.({
      step: i + 1,
      total: payloads.length,
      description: step.description,
      status: "sending",
    });

    try {
      // Extract temperature (convert C to F for simulator)
      const tempC =
        (step.decoded_payload.TempC_SHT as number) ??
        (step.decoded_payload.temperature as number) ??
        undefined;
      const tempF = tempC !== undefined ? (tempC * 9) / 5 + 32 : undefined;

      const humidity =
        (step.decoded_payload.Hum_SHT as number) ??
        (step.decoded_payload.humidity as number) ??
        undefined;

      // Build the simulator body
      const body: Record<string, unknown> = {
        action: "inject",
        unit_id: unitId,
        temperature: tempF,
        humidity: humidity,
      };

      // Door sensor fields (LDS02)
      if (step.decoded_payload.DOOR_OPEN_STATUS !== undefined) {
        body.door_open = step.decoded_payload.DOOR_OPEN_STATUS === 1;
        body.door_open_times = step.decoded_payload.DOOR_OPEN_TIMES;
        body.door_open_duration = step.decoded_payload.LAST_DOOR_OPEN_DURATION;
      }

      // Battery voltage (Dragino BatV)
      if (step.decoded_payload.BatV !== undefined) {
        body.battery_voltage = step.decoded_payload.BatV;
      }
      // Battery percentage (Milesight)
      if (step.decoded_payload.battery !== undefined) {
        body.battery_percentage = step.decoded_payload.battery;
      }
      // Battery mV (Elsys vdd)
      if (step.decoded_payload.vdd !== undefined) {
        body.battery_voltage = (step.decoded_payload.vdd as number) / 1000;
      }

      // Signal quality metadata (T5-SIGNAL-POOR)
      if (step._rx_metadata) {
        body.rx_metadata = step._rx_metadata;
      }

      const { error: invokeError } = await supabase.functions.invoke(
        "sensor-simulator",
        { body }
      );

      steps.push({
        step: i + 1,
        description: step.description,
        sent_at: new Date().toISOString(),
        success: !invokeError,
        error: invokeError?.message,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({
        step: i + 1,
        description: step.description,
        sent_at: new Date().toISOString(),
        success: false,
        error: msg,
      });

      return {
        scenario_id: scenarioId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        payloads_sent: steps.filter((s) => s.success).length,
        status: "failed",
        error: `Step ${i + 1} failed: ${msg}`,
        alarm_verified: null,
        steps,
      };
    }

    onProgress?.({
      step: i + 1,
      total: payloads.length,
      description: step.description,
      status: "done",
    });
  }

  // Trigger alarm evaluation
  onProgress?.({
    step: payloads.length,
    total: payloads.length,
    description: "Evaluating alarms...",
    status: "evaluating",
  });

  try {
    await supabase.functions.invoke("process-unit-states");
  } catch {
    console.warn("[alarmScenarios] process-unit-states invocation failed");
  }

  // Verify the expected alarm was created
  let alarm_verified: boolean | null = null;
  let alarm_event: ScenarioResult["alarm_event"] = undefined;

  if (verify && scenario.expected_alarm_type) {
    onProgress?.({
      step: payloads.length,
      total: payloads.length,
      description: "Verifying alarm result...",
      status: "verifying",
    });

    await sleep(turbo ? 1500 : 2500, signal);

    const verification = await verifyAlarmResult(
      unitId,
      scenario.expected_alarm_type,
      scenario.expected_severity,
      startedAt
    );
    alarm_verified = verification.found;
    alarm_event = verification.event;
  }

  const failedSteps = steps.filter((s) => !s.success);
  const allStepsOk = failedSteps.length === 0;

  return {
    scenario_id: scenarioId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    payloads_sent: steps.filter((s) => s.success).length,
    status: allStepsOk
      ? alarm_verified === true
        ? "passed"
        : alarm_verified === false
          ? "failed"
          : "completed"
      : "failed",
    error: !allStepsOk
      ? `${failedSteps.length} step(s) failed`
      : alarm_verified === false
        ? `Expected alarm "${scenario.expected_alarm_type}" (${scenario.expected_severity}) not found`
        : undefined,
    alarm_verified,
    alarm_event,
    steps,
  };
}

// ─── Alarm Verification ────────────────────────────────────────────────────

async function verifyAlarmResult(
  unitId: string,
  expectedAlarmType: string,
  expectedSeverity: string,
  afterTimestamp: string
): Promise<{ found: boolean; event?: ScenarioResult["alarm_event"] }> {
  try {
    const db = supabase as any;
    const { data, error } = await db
      .from("alarm_events")
      .select("id, alarm_type, severity, created_at")
      .eq("unit_id", unitId)
      .eq("alarm_type", expectedAlarmType)
      .eq("severity", expectedSeverity)
      .gte("created_at", afterTimestamp)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[alarmScenarios] Alarm verification failed:", error);
      return { found: false };
    }

    if (data) {
      return {
        found: true,
        event: {
          id: data.id,
          alarm_type: data.alarm_type,
          severity: data.severity,
          created_at: data.created_at,
        },
      };
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}

// ─── Batch Runner ──────────────────────────────────────────────────────────

/**
 * Run all "quick" scenarios sequentially in turbo mode.
 */
export async function runAllQuick(
  unitId: string,
  scenarios: AlarmScenario[],
  onProgress?: (progress: BatchRunProgress) => void,
  signal?: AbortSignal
): Promise<BatchResult> {
  const quickScenarios = scenarios.filter(isQuickScenario);
  const startedAt = new Date().toISOString();
  const results: ScenarioResult[] = [];

  for (let i = 0; i < quickScenarios.length; i++) {
    if (signal?.aborted) {
      for (let j = i; j < quickScenarios.length; j++) {
        results.push({
          scenario_id: quickScenarios[j].scenario_id,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          payloads_sent: 0,
          status: "skipped",
          error: "Batch cancelled",
          alarm_verified: null,
          steps: [],
        });
      }
      break;
    }

    const scenario = quickScenarios[i];

    onProgress?.({
      current_scenario: scenario.scenario_id,
      scenario_index: i,
      total_scenarios: quickScenarios.length,
      status: "running",
    });

    const result = await runScenario(
      scenario.scenario_id,
      unitId,
      (scenarioProgress) => {
        onProgress?.({
          current_scenario: scenario.scenario_id,
          scenario_index: i,
          total_scenarios: quickScenarios.length,
          scenario_progress: scenarioProgress,
          status: "running",
        });
      },
      { turbo: true, verify: true, signal }
    );

    results.push(result);

    // Brief cooldown between scenarios
    await sleep(1000, signal);
  }

  onProgress?.({
    current_scenario: "",
    scenario_index: quickScenarios.length,
    total_scenarios: quickScenarios.length,
    status: "completed",
  });

  return {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    total: quickScenarios.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function getScenarioDuration(scenario: AlarmScenario): number {
  return scenario.payload_sequence.reduce((sum, step) => sum + step.delay_ms, 0);
}

export const TIER_META: Record<string, { label: string; color: string; description: string }> = {
  T1: { label: "T1 — Threshold", color: "bg-blue-500", description: "Single reading crosses boundary" },
  T2: { label: "T2 — Rate of Change", color: "bg-amber-500", description: "Temperature rising/falling too fast" },
  T3: { label: "T3 — Duration", color: "bg-orange-500", description: "Condition sustained beyond time limit" },
  T4: { label: "T4 — Pattern", color: "bg-red-500", description: "Multi-sensor or cross-reading correlation" },
  T5: { label: "T5 — System", color: "bg-purple-500", description: "Device health, connectivity, battery" },
};

export function getSeverityVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "critical": return "destructive";
    case "warning":  return "default";
    case "info":     return "secondary";
    default:         return "outline";
  }
}
