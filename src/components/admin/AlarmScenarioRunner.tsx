/**
 * AlarmScenarioRunner — Admin UI for browsing, running, and batch-testing alarm scenarios.
 *
 * Flow: The emulator sends sensor data through TTN, then waits for the user
 * to check the FrostGuard app and manually confirm whether the expected alert
 * appeared. The emulator has NO visibility into the main application.
 *
 * Features:
 * - Browse all scenarios from alarm_test_scenarios table
 * - Filter by tier (T1-T5), equipment type, severity
 * - View payload sequence timeline for each scenario
 * - Run individual scenarios: Normal mode (real delays) or Turbo mode (skip delays)
 * - Manual Pass/Fail confirmation after each scenario
 * - "Run All Quick" batch: runs scenarios one at a time, pausing for confirmation
 * - Session result history
 * - Cancellable batch runs
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Thermometer,
  DoorOpen,
  Battery,
  Signal,
  Activity,
  ChevronDown,
  ChevronUp,
  Zap,
  Square,
  SkipForward,
  FlaskConical,
  ThumbsUp,
  ThumbsDown,
  Eye,
} from "lucide-react";
import type { GatewayConfig, TTNConfig, LoRaWANDevice } from "@/lib/ttn-payload";
import {
  loadScenarios,
  runScenario,
  isQuickScenario,
  getScenarioSpeed,
  getScenarioDuration,
  TIER_META,
  SPEED_META,
  getSeverityVariant,
  type AlarmScenario,
  type ScenarioRunProgress,
  type ScenarioResult,
  type RunOptions,
  type ScenarioTTNContext,
} from "@/lib/alarmScenarios";

// ─── Supporting types ──────────────────────────────────────────────────────

interface Unit {
  id: string;
  name: string;
  unit_type: string;
  area: { name: string; site: { name: string } };
}

interface SensorInfo {
  devEui: string;
  deviceId: string;
}

interface AlarmScenarioRunnerProps {
  organizationId: string | null;
  selectedUserId?: string | null;
  ttnConfig?: TTNConfig | null;
  gateway?: GatewayConfig | null;
  devices?: LoRaWANDevice[];
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AlarmScenarioRunner({
  organizationId,
  selectedUserId,
  ttnConfig,
  gateway,
  devices = [],
}: AlarmScenarioRunnerProps) {
  // Data state
  const [scenarios, setScenarios] = useState<AlarmScenario[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Sensor info for the currently selected unit
  const [unitSensor, setUnitSensor] = useState<SensorInfo | null>(null);

  // Filter state
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // Individual run state
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScenarioRunProgress | null>(null);

  // Awaiting user confirmation after payloads sent
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<{
    scenario: AlarmScenario;
    result: ScenarioResult;
  } | null>(null);

  // Batch run state: queue-based so we can pause for confirmation between each
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchQueue, setBatchQueue] = useState<AlarmScenario[]>([]);
  const [batchResults, setBatchResults] = useState<ScenarioResult[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Session result history (scenario_id -> last result)
  const [resultHistory, setResultHistory] = useState<Map<string, ScenarioResult>>(
    new Map()
  );

  // ─── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters =
        selectedTier !== "all" ? { tier: selectedTier } : undefined;
      const data = await loadScenarios(filters);
      setScenarios(data);
    } catch (error) {
      console.error("[AlarmScenarioRunner] Failed to load scenarios:", error);
    }
    setIsLoading(false);
  }, [selectedTier]);

  const loadUnits = useCallback(async () => {
    if (!organizationId) return;

    const { data: areasData } = await supabase
      .from("areas")
      .select("id, site:sites!inner(organization_id)")
      .eq("is_active", true)
      .eq("sites.organization_id", organizationId);

    const areaIds = (areasData || []).map((a: any) => a.id);
    if (areaIds.length === 0) return;

    const { data } = await supabase
      .from("units")
      .select(
        "id, name, unit_type, area:areas!inner(name, site:sites!inner(name))"
      )
      .in("area_id", areaIds)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name");

    setUnits(
      (data || []).map((u: any) => ({
        id: u.id,
        name: u.name,
        unit_type: u.unit_type,
        area: {
          name: u.area?.name || "",
          site: { name: u.area?.site?.name || "" },
        },
      }))
    );
  }, [organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  // Look up the sensor assigned to the selected unit from in-memory devices
  // (assignments live in FrostGuard and are synced to the devices array,
  //  not reliably reflected in the local lora_sensors table)
  useEffect(() => {
    if (!selectedUnit) {
      setUnitSensor(null);
      return;
    }
    const device = devices.find((d) => d.unitId === selectedUnit);
    if (device?.devEui) {
      const normalised = device.devEui.replace(/[:\s-]/g, "").toLowerCase();
      setUnitSensor({
        devEui: device.devEui,
        deviceId: `sensor-${normalised}`,
      });
    } else {
      setUnitSensor(null);
    }
  }, [selectedUnit, devices]);

  // Build TTN context from props + unit sensor lookup
  const ttnContext: ScenarioTTNContext | undefined =
    organizationId &&
    selectedUserId &&
    ttnConfig?.enabled &&
    ttnConfig.applicationId &&
    gateway &&
    unitSensor
      ? {
          orgId: organizationId,
          selectedUserId,
          applicationId: ttnConfig.applicationId,
          gatewayId: gateway.ttnGatewayId || gateway.id,
          gatewayEui: gateway.eui,
          devEui: unitSensor.devEui,
          deviceId: unitSensor.deviceId,
        }
      : undefined;

  // ─── Run a single scenario then show confirmation ───────────────────────

  const sendScenario = async (
    scenario: AlarmScenario,
    options: RunOptions = {}
  ) => {
    if (!selectedUnit) return;

    setRunningScenarioId(scenario.scenario_id);
    setProgress(null);
    setAwaitingConfirmation(null);

    const result = await runScenario(
      scenario.scenario_id,
      selectedUnit,
      (p) => setProgress(p),
      { ...options, ttnContext }
    );

    setRunningScenarioId(null);
    setProgress(null);

    if (result.status === "failed") {
      // Send failed — record immediately, no confirmation needed
      setResultHistory((prev) =>
        new Map(prev).set(scenario.scenario_id, result)
      );
      if (isBatchMode) advanceBatch(result);
    } else {
      // Payloads sent — wait for user to confirm they saw the alert
      setAwaitingConfirmation({ scenario, result });
    }
  };

  const handleRunScenario = (
    scenarioId: string,
    options: RunOptions = {}
  ) => {
    const scenario = scenarios.find((s) => s.scenario_id === scenarioId);
    if (!scenario) return;
    sendScenario(scenario, options);
  };

  // ─── User confirms pass/fail ───────────────────────────────────────────

  const handleConfirm = (passed: boolean) => {
    if (!awaitingConfirmation) return;

    const { scenario, result } = awaitingConfirmation;
    const finalResult: ScenarioResult = {
      ...result,
      completed_at: new Date().toISOString(),
      status: passed ? "passed" : "failed",
      alarm_verified: passed,
      error: passed ? undefined : "User confirmed: alert not seen in FrostGuard app",
    };

    setResultHistory((prev) =>
      new Map(prev).set(scenario.scenario_id, finalResult)
    );
    setAwaitingConfirmation(null);

    if (isBatchMode) {
      advanceBatch(finalResult);
    }
  };

  // ─── Batch run (queue-based, pauses for confirmation) ──────────────────

  const handleRunAllQuick = () => {
    if (!selectedUnit) return;

    const quickScenarios = scenarios.filter(isQuickScenario);
    if (quickScenarios.length === 0) return;

    setIsBatchMode(true);
    setBatchResults([]);
    setBatchTotal(quickScenarios.length);
    setBatchQueue(quickScenarios.slice(1));
    setResultHistory(new Map());

    // Start with the first scenario
    sendScenario(quickScenarios[0], { turbo: true });
  };

  const advanceBatch = (completedResult: ScenarioResult) => {
    setBatchResults((prev) => {
      const updated = [...prev, completedResult];

      // Check if we're done
      setBatchQueue((queue) => {
        if (queue.length === 0) {
          // All done
          setIsBatchMode(false);
          return [];
        }

        // Run the next scenario
        const [next, ...rest] = queue;
        setTimeout(() => sendScenario(next, { turbo: true }), 500);
        return rest;
      });

      return updated;
    });
  };

  const handleCancelBatch = () => {
    abortControllerRef.current?.abort();
    // Mark remaining queue as skipped
    const skippedResults: ScenarioResult[] = batchQueue.map((s) => ({
      scenario_id: s.scenario_id,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      payloads_sent: 0,
      status: "skipped" as const,
      error: "Batch cancelled",
      alarm_verified: null,
      steps: [],
    }));
    setBatchResults((prev) => [...prev, ...skippedResults]);
    for (const r of skippedResults) {
      setResultHistory((prev) => new Map(prev).set(r.scenario_id, r));
    }
    setBatchQueue([]);
    setIsBatchMode(false);
    setAwaitingConfirmation(null);
    setRunningScenarioId(null);
  };

  // ─── Expand toggle ─────────────────────────────────────────────────────

  const toggleExpand = (scenarioId: string) => {
    setExpandedScenario((prev) => (prev === scenarioId ? null : scenarioId));
  };

  // ─── Computed values ───────────────────────────────────────────────────

  const groupedByTier = scenarios.reduce(
    (acc, s) => {
      if (!acc[s.tier]) acc[s.tier] = [];
      acc[s.tier].push(s);
      return acc;
    },
    {} as Record<string, AlarmScenario[]>
  );

  const quickCount = scenarios.filter(isQuickScenario).length;
  const isAnyRunning = runningScenarioId !== null || awaitingConfirmation !== null;
  const isTTNReady = !!ttnContext;

  // ─── Icon helpers ──────────────────────────────────────────────────────

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case "T1": return <Thermometer className="w-4 h-4" />;
      case "T2": return <Activity className="w-4 h-4" />;
      case "T3": return <Clock className="w-4 h-4" />;
      case "T4": return <DoorOpen className="w-4 h-4" />;
      case "T5": return <Battery className="w-4 h-4" />;
      default:   return <Signal className="w-4 h-4" />;
    }
  };

  const getResultIcon = (result: ScenarioResult) => {
    switch (result.status) {
      case "passed":                return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":                return <XCircle className="w-4 h-4 text-red-500" />;
      case "awaiting_confirmation": return <Eye className="w-4 h-4 text-amber-500" />;
      case "skipped":               return <SkipForward className="w-4 h-4 text-muted-foreground" />;
      default:                      return <XCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatMs = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60_000)}m`;
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-amber-500">
            Alarm Scenario Testing Tool
          </p>
          <p className="text-sm text-muted-foreground">
            Scenarios inject real sensor data through the full pipeline. Alerts,
            emails, and compliance records <strong>will</strong> be generated.
            Use a test unit where possible.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5" />
            Alarm Scenarios
          </CardTitle>
          <CardDescription>
            {scenarios.length} scenarios loaded · {quickCount} quick-testable
            (⚡ turbo mode)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ── Controls row ─────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3 items-end">
            {/* Tier filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Tier</label>
              <Select value={selectedTier} onValueChange={setSelectedTier}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  <SelectItem value="T1">T1 — Threshold</SelectItem>
                  <SelectItem value="T2">T2 — Rate</SelectItem>
                  <SelectItem value="T3">T3 — Duration</SelectItem>
                  <SelectItem value="T4">T4 — Pattern</SelectItem>
                  <SelectItem value="T5">T5 — System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Unit selector */}
            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">
                Target Unit
              </label>
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a unit..." />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.area.site.name} › {u.area.name} › {u.name} (
                      {u.unit_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Batch run button */}
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              disabled={!selectedUnit || !isTTNReady || isAnyRunning || isBatchMode || quickCount === 0}
              onClick={handleRunAllQuick}
            >
              <Zap className="w-4 h-4" />
              Run All Quick ({quickCount})
            </Button>

            {/* Cancel button */}
            {isBatchMode && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={handleCancelBatch}
              >
                <Square className="w-4 h-4" />
                Cancel Batch
              </Button>
            )}
          </div>

          {/* ── TTN / sensor readiness warning ─────────────────────── */}
          {selectedUnit && !isTTNReady && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                {!selectedUserId && <p>No user selected — go to the User tab.</p>}
                {!ttnConfig?.enabled && <p>TTN is not enabled — configure TTN in Webhook Settings.</p>}
                {!ttnConfig?.applicationId && ttnConfig?.enabled && <p>TTN Application ID missing.</p>}
                {!gateway && <p>No gateway configured.</p>}
                {selectedUnit && !unitSensor && (
                  <p>No sensor assigned to this unit. Assign a sensor in Device Manager.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Batch progress ───────────────────────────────────────── */}
          {isBatchMode && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span>Batch Run</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {batchResults.length} / {batchTotal} confirmed
                </span>
              </div>
              <Progress
                value={(batchResults.length / batchTotal) * 100}
                className="h-2"
              />
            </div>
          )}

          {/* ── Batch results summary (shown when batch is done) ──── */}
          {!isBatchMode && batchResults.length > 0 && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold">Batch Results</h3>
                <Badge
                  variant="outline"
                  className="gap-1 border-green-500/50 text-green-600"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {batchResults.filter((r) => r.status === "passed").length} passed
                </Badge>
                {batchResults.filter((r) => r.status === "failed").length > 0 && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-red-500/50 text-red-500"
                  >
                    <XCircle className="w-3 h-3" />
                    {batchResults.filter((r) => r.status === "failed").length} failed
                  </Badge>
                )}
                {batchResults.filter((r) => r.status === "skipped").length > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <SkipForward className="w-3 h-3" />
                    {batchResults.filter((r) => r.status === "skipped").length} skipped
                  </Badge>
                )}
              </div>

              {/* Per-scenario rows */}
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {batchResults.map((r) => (
                  <div
                    key={r.scenario_id}
                    className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/50"
                  >
                    {getResultIcon(r)}
                    <code className="font-mono text-muted-foreground w-52 flex-shrink-0 truncate">
                      {r.scenario_id}
                    </code>
                    <span className="text-muted-foreground w-16 flex-shrink-0 tabular-nums">
                      {r.payloads_sent} sent
                    </span>
                    {r.alarm_verified === true && (
                      <span className="text-green-600 text-xs">confirmed</span>
                    )}
                    {r.alarm_verified === false && (
                      <span className="text-red-500 text-xs">not seen</span>
                    )}
                    {r.error && (
                      <span className="text-red-400 truncate max-w-[180px]">
                        {r.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Sending progress ────────────────────────────────────── */}
          {progress && runningScenarioId && (
            <div className="bg-accent/10 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <code className="font-mono text-xs">{runningScenarioId}</code>
                <span className="text-muted-foreground">
                  Step {progress.step}/{progress.total}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.description}
              </p>
              <Progress
                value={(progress.step / progress.total) * 100}
                className="h-1.5"
              />
            </div>
          )}

          {/* ── Awaiting user confirmation ────────────────────────────── */}
          {awaitingConfirmation && (
            <div className="border-2 border-amber-500/50 bg-amber-500/5 rounded-lg p-4 space-y-4">
              <div className="flex items-start gap-3">
                <Eye className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="font-medium text-sm">
                      Check FrostGuard App Now
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {awaitingConfirmation.result.payloads_sent} payload(s) sent
                      for <code className="font-mono bg-muted px-1 rounded">{awaitingConfirmation.scenario.scenario_id}</code>.
                      Check the FrostGuard application and confirm whether you see the expected alert.
                    </p>
                  </div>

                  {/* What to look for */}
                  <div className="bg-background border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-medium">Expected Alert:</p>
                    <div className="flex gap-3 flex-wrap text-xs">
                      <span>
                        Type: <strong>{awaitingConfirmation.scenario.expected_alarm_type}</strong>
                      </span>
                      <span>
                        Severity:{" "}
                        <Badge
                          variant={getSeverityVariant(awaitingConfirmation.scenario.expected_severity)}
                          className="text-xs ml-1"
                        >
                          {awaitingConfirmation.scenario.expected_severity}
                        </Badge>
                      </span>
                      <span>
                        Equipment: <strong>{awaitingConfirmation.scenario.equipment_type}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {awaitingConfirmation.scenario.description}
                    </p>

                    {/* Show which sensors were involved */}
                    {(() => {
                      const sensors = new Set(
                        awaitingConfirmation.scenario.payload_sequence
                          .filter((s) => s._sensor)
                          .map((s) => s._sensor!)
                      );
                      if (sensors.size <= 1) return null;
                      return (
                        <div className="flex items-center gap-1.5 pt-1">
                          <span className="text-xs text-muted-foreground">Sensors involved:</span>
                          {[...sensors].map((s) => (
                            <Badge key={s} variant="secondary" className="text-[10px] py-0">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Pass / Fail buttons */}
                  <div className="flex gap-3">
                    <Button
                      size="sm"
                      className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleConfirm(true)}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Yes, I see the alert
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => handleConfirm(false)}
                    >
                      <ThumbsDown className="w-4 h-4" />
                      No, alert not visible
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* ── Scenario list ────────────────────────────────────────── */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedByTier)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([tier, tierScenarios]) => {
                  const meta = TIER_META[tier] || {
                    label: tier,
                    color: "bg-gray-500",
                    description: "",
                  };
                  const tierQuick = tierScenarios.filter(isQuickScenario).length;

                  return (
                    <div key={tier} className="space-y-2">
                      {/* Tier header */}
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${meta.color}`}
                        />
                        {getTierIcon(tier)}
                        <span className="text-sm font-semibold">
                          {meta.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          — {meta.description}
                        </span>
                        <Badge variant="outline" className="ml-auto text-xs">
                          {tierScenarios.length} total
                        </Badge>
                        {tierQuick > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs border-emerald-500/40 text-emerald-600"
                          >
                            ⚡ {tierQuick} quick
                          </Badge>
                        )}
                      </div>

                      {/* Scenario cards */}
                      <div className="space-y-1 ml-4">
                        {tierScenarios.map((scenario) => {
                          const isExpanded =
                            expandedScenario === scenario.scenario_id;
                          const isRunning =
                            runningScenarioId === scenario.scenario_id;
                          const speed = getScenarioSpeed(scenario);
                          const speedMeta = SPEED_META[speed];
                          const prevResult = resultHistory.get(
                            scenario.scenario_id
                          );
                          const duration = getScenarioDuration(scenario);

                          return (
                            <div
                              key={scenario.scenario_id}
                              className={`border rounded-lg transition-colors ${
                                prevResult?.status === "passed"
                                  ? "border-green-500/25 bg-green-500/[0.02]"
                                  : prevResult?.status === "failed"
                                    ? "border-red-500/25 bg-red-500/[0.02]"
                                    : ""
                              }`}
                            >
                              {/* Scenario summary row */}
                              <div
                                className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() =>
                                  toggleExpand(scenario.scenario_id)
                                }
                              >
                                {/* History result indicator */}
                                <div className="w-4 h-4 flex-shrink-0">
                                  {prevResult && getResultIcon(prevResult)}
                                </div>

                                <code className="text-xs font-mono text-muted-foreground w-52 flex-shrink-0 truncate">
                                  {scenario.scenario_id}
                                </code>
                                <span className="text-sm flex-1 truncate">
                                  {scenario.name}
                                </span>

                                {/* Speed badge */}
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 ${speedMeta.badgeClass}`}
                                >
                                  {speedMeta.icon} {speedMeta.label}
                                </Badge>

                                <Badge
                                  variant={getSeverityVariant(
                                    scenario.expected_severity
                                  )}
                                  className="text-xs"
                                >
                                  {scenario.expected_severity}
                                </Badge>
                                <Badge variant="outline" className="text-xs tabular-nums">
                                  {scenario.payload_sequence.length} steps
                                </Badge>

                                {/* Run buttons */}
                                <div
                                  className="flex gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Turbo run */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    title="Run turbo (skip delays)"
                                    disabled={!selectedUnit || !isTTNReady || isAnyRunning}
                                    onClick={() =>
                                      handleRunScenario(
                                        scenario.scenario_id,
                                        { turbo: true }
                                      )
                                    }
                                  >
                                    {isRunning ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Zap className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                  {/* Normal run */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    title={`Run normal (${formatMs(duration)} real time)`}
                                    disabled={!selectedUnit || !isTTNReady || isAnyRunning}
                                    onClick={() =>
                                      handleRunScenario(scenario.scenario_id)
                                    }
                                  >
                                    {isRunning ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Play className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                </div>

                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                )}
                              </div>

                              {/* Expanded detail panel */}
                              {isExpanded && (
                                <div className="px-3 pb-3 space-y-3 border-t bg-muted/20">
                                  <div className="pt-3">
                                    <p className="text-sm text-muted-foreground">
                                      {scenario.description}
                                    </p>
                                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                                      <span>
                                        Equipment:{" "}
                                        <strong>
                                          {scenario.equipment_type}
                                        </strong>
                                      </span>
                                      <span>
                                        Sensor:{" "}
                                        <strong>
                                          {scenario.sensor_model}
                                        </strong>
                                      </span>
                                      <span>
                                        Expected:{" "}
                                        <strong>
                                          {scenario.expected_alarm_type}
                                        </strong>
                                      </span>
                                      <span>
                                        Real duration:{" "}
                                        <strong>
                                          {formatMs(duration)}
                                        </strong>
                                      </span>
                                    </div>
                                  </div>

                                  {/* Payload timeline */}
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium">
                                      Payload Sequence:
                                    </p>
                                    {scenario.payload_sequence.map(
                                      (step, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-start gap-2 text-xs p-2 rounded bg-background border"
                                        >
                                          <Badge
                                            variant="outline"
                                            className="text-xs flex-shrink-0 tabular-nums"
                                          >
                                            {idx + 1}
                                          </Badge>
                                          {step.delay_ms > 0 && (
                                            <span className="text-muted-foreground flex-shrink-0 w-10 text-right tabular-nums">
                                              +{formatMs(step.delay_ms)}
                                            </span>
                                          )}
                                          {step._sensor && (
                                            <Badge
                                              variant="secondary"
                                              className="text-[10px] py-0"
                                            >
                                              {step._sensor}
                                            </Badge>
                                          )}
                                          <span className="flex-1">
                                            {step.description}
                                          </span>
                                          <code className="text-[10px] font-mono text-muted-foreground max-w-[260px] truncate">
                                            {JSON.stringify(
                                              step.decoded_payload
                                            )}
                                          </code>
                                        </div>
                                      )
                                    )}
                                  </div>

                                  {/* Previous result for this scenario */}
                                  {prevResult && (
                                    <div
                                      className={`rounded p-2.5 text-xs space-y-1 ${
                                        prevResult.status === "passed"
                                          ? "bg-green-500/10 border border-green-500/20"
                                          : prevResult.status === "failed"
                                            ? "bg-red-500/10 border border-red-500/20"
                                            : "bg-blue-500/10 border border-blue-500/20"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        {getResultIcon(prevResult)}
                                        <span className="font-medium">
                                          Last run: {prevResult.status}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                          {prevResult.payloads_sent} sent
                                        </span>
                                        {prevResult.alarm_verified === true && (
                                          <span className="text-green-600 ml-auto">
                                            User confirmed alert visible
                                          </span>
                                        )}
                                        {prevResult.alarm_verified === false && (
                                          <span className="text-red-500 ml-auto">
                                            User confirmed alert not seen
                                          </span>
                                        )}
                                      </div>
                                      {prevResult.error && (
                                        <p className="text-red-500">
                                          {prevResult.error}
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  {/* Tags */}
                                  {scenario.tags.length > 0 && (
                                    <div className="flex gap-1 flex-wrap">
                                      {scenario.tags.map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
