/**
 * AlarmScenarioRunner — Admin UI for browsing, running, and batch-testing alarm scenarios.
 *
 * Features:
 * - Browse all 36 scenarios from alarm_test_scenarios table
 * - Filter by tier (T1-T5), equipment type, severity
 * - View payload sequence timeline for each scenario
 * - Run individual scenarios: Normal mode (real delays) or Turbo mode (skip delays)
 * - "Run All Quick" batch: auto-runs all instant scenarios sequentially in turbo
 * - Alarm verification: checks alarm_events after each run
 * - Progress tracking for individual and batch runs
 * - Session result history with pass/fail/verified status
 * - Cancellable batch runs via AbortController
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchOrgState, type OrgStateUnit } from "@/lib/frostguardOrgSync";
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
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  loadScenarios,
  runScenario,
  runAllQuick,
  isQuickScenario,
  getScenarioSpeed,
  getScenarioDuration,
  TIER_META,
  SPEED_META,
  getSeverityVariant,
  type AlarmScenario,
  type ScenarioRunProgress,
  type ScenarioResult,
  type BatchRunProgress,
  type BatchResult,
  type RunOptions,
} from "@/lib/alarmScenarios";

// ─── Supporting types ──────────────────────────────────────────────────────

type Unit = OrgStateUnit;

interface AlarmScenarioRunnerProps {
  organizationId: string | null;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AlarmScenarioRunner({
  organizationId,
}: AlarmScenarioRunnerProps) {
  // Data state
  const [scenarios, setScenarios] = useState<AlarmScenario[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filter state
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // Individual run state
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScenarioRunProgress | null>(null);
  const [lastResult, setLastResult] = useState<ScenarioResult | null>(null);

  // Batch run state
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchRunProgress | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
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

    try {
      const result = await fetchOrgState(organizationId);
      if (result.ok && result.data?.units) {
        setUnits(result.data.units);
      } else {
        console.error("[AlarmScenarioRunner] Failed to load units:", result.error);
      }
    } catch (error) {
      console.error("[AlarmScenarioRunner] Error loading units:", error);
    }
  }, [organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  // ─── Individual run handler ────────────────────────────────────────────

  const handleRunScenario = async (
    scenarioId: string,
    options: RunOptions = {}
  ) => {
    if (!selectedUnit) return;

    setRunningScenarioId(scenarioId);
    setProgress(null);
    setLastResult(null);

    const result = await runScenario(
      scenarioId,
      selectedUnit,
      (p) => setProgress(p),
      options
    );

    setLastResult(result);
    setResultHistory((prev) => new Map(prev).set(scenarioId, result));
    setRunningScenarioId(null);
    setProgress(null);
  };

  // ─── Batch run handler ─────────────────────────────────────────────────

  const handleRunAllQuick = async () => {
    if (!selectedUnit) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsBatchRunning(true);
    setBatchProgress(null);
    setBatchResult(null);
    setResultHistory(new Map());

    const result = await runAllQuick(
      selectedUnit,
      scenarios,
      (p) => setBatchProgress(p),
      controller.signal
    );

    // Populate result history from batch
    const newHistory = new Map<string, ScenarioResult>();
    for (const r of result.results) {
      newHistory.set(r.scenario_id, r);
    }
    setResultHistory(newHistory);

    setBatchResult(result);
    setIsBatchRunning(false);
    abortControllerRef.current = null;
  };

  const handleCancelBatch = () => {
    abortControllerRef.current?.abort();
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
  const isAnyRunning = runningScenarioId !== null || isBatchRunning;

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
      case "passed":    return <ShieldCheck className="w-4 h-4 text-green-500" />;
      case "failed":    return <ShieldX className="w-4 h-4 text-red-500" />;
      case "completed": return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case "skipped":   return <SkipForward className="w-4 h-4 text-muted-foreground" />;
      default:          return <XCircle className="w-4 h-4 text-muted-foreground" />;
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
                      {u.name}
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
              disabled={!selectedUnit || isAnyRunning || quickCount === 0}
              onClick={handleRunAllQuick}
            >
              <Zap className="w-4 h-4" />
              Run All Quick ({quickCount})
            </Button>

            {/* Cancel button */}
            {isBatchRunning && (
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

          {/* ── Batch progress ───────────────────────────────────────── */}
          {isBatchRunning && batchProgress && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span>Running:</span>
                  <code className="font-mono text-xs bg-blue-500/10 px-1.5 py-0.5 rounded">
                    {batchProgress.current_scenario}
                  </code>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {batchProgress.scenario_index + 1} /{" "}
                  {batchProgress.total_scenarios}
                </span>
              </div>
              <Progress
                value={
                  ((batchProgress.scenario_index +
                    (batchProgress.scenario_progress
                      ? batchProgress.scenario_progress.step /
                        batchProgress.scenario_progress.total
                      : 0)) /
                    batchProgress.total_scenarios) *
                  100
                }
                className="h-2"
              />
              {batchProgress.scenario_progress && (
                <p className="text-xs text-muted-foreground">
                  Step {batchProgress.scenario_progress.step}/
                  {batchProgress.scenario_progress.total}:{" "}
                  {batchProgress.scenario_progress.description}
                </p>
              )}
            </div>
          )}

          {/* ── Batch results summary ────────────────────────────────── */}
          {batchResult && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold">Batch Results</h3>
                <Badge
                  variant="outline"
                  className="gap-1 border-green-500/50 text-green-600"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {batchResult.passed} passed
                </Badge>
                {batchResult.failed > 0 && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-red-500/50 text-red-500"
                  >
                    <XCircle className="w-3 h-3" />
                    {batchResult.failed} failed
                  </Badge>
                )}
                {batchResult.skipped > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <SkipForward className="w-3 h-3" />
                    {batchResult.skipped} skipped
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                  {Math.round(
                    (new Date(batchResult.completed_at).getTime() -
                      new Date(batchResult.started_at).getTime()) /
                      1000
                  )}
                  s total
                </span>
              </div>

              {/* Per-scenario rows */}
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {batchResult.results.map((r) => (
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
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-0.5 border-green-500/50 text-green-600 py-0"
                      >
                        <ShieldCheck className="w-2.5 h-2.5" />
                        verified
                      </Badge>
                    )}
                    {r.alarm_verified === false && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-0.5 border-red-500/50 text-red-500 py-0"
                      >
                        <ShieldX className="w-2.5 h-2.5" />
                        no alarm
                      </Badge>
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

          {/* ── Individual run progress ──────────────────────────────── */}
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

          {/* ── Individual last result ───────────────────────────────── */}
          {lastResult && !isBatchRunning && (
            <div
              className={`border rounded-lg p-3 space-y-2 ${
                lastResult.status === "passed"
                  ? "border-green-500/30 bg-green-500/5"
                  : lastResult.status === "failed"
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-blue-500/30 bg-blue-500/5"
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                {getResultIcon(lastResult)}
                <code className="font-mono text-xs">
                  {lastResult.scenario_id}
                </code>
                <Badge
                  variant={
                    lastResult.status === "passed"
                      ? "outline"
                      : lastResult.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-xs"
                >
                  {lastResult.status}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                  {lastResult.payloads_sent} sent ·{" "}
                  {Math.round(
                    (new Date(lastResult.completed_at).getTime() -
                      new Date(lastResult.started_at).getTime()) /
                      1000
                  )}
                  s
                </span>
              </div>
              {lastResult.alarm_verified !== null && (
                <div className="flex items-center gap-2 text-xs">
                  {lastResult.alarm_verified ? (
                    <>
                      <ShieldCheck className="w-3 h-3 text-green-500" />
                      <span className="text-green-600">
                        Alarm verified: {lastResult.alarm_event?.alarm_type} (
                        {lastResult.alarm_event?.severity})
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldX className="w-3 h-3 text-red-500" />
                      <span className="text-red-500">
                        Expected alarm not found in alarm_events
                      </span>
                    </>
                  )}
                </div>
              )}
              {lastResult.error && (
                <p className="text-xs text-red-500">{lastResult.error}</p>
              )}
              <div className="space-y-0.5">
                {lastResult.steps.map((step) => (
                  <div
                    key={step.step}
                    className="flex items-center gap-2 text-xs"
                  >
                    {step.success ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500" />
                    )}
                    <span className="text-muted-foreground">
                      Step {step.step}: {step.description}
                    </span>
                    {step.error && (
                      <span className="text-red-400 text-xs">
                        — {step.error}
                      </span>
                    )}
                  </div>
                ))}
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
                                    disabled={!selectedUnit || isAnyRunning}
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
                                    disabled={!selectedUnit || isAnyRunning}
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
                                          {prevResult.payloads_sent} sent ·{" "}
                                          {Math.round(
                                            (new Date(
                                              prevResult.completed_at
                                            ).getTime() -
                                              new Date(
                                                prevResult.started_at
                                              ).getTime()) /
                                              1000
                                          )}
                                          s
                                        </span>
                                        {prevResult.alarm_verified ===
                                          true && (
                                          <span className="text-green-600 ml-auto">
                                            Alarm verified ✓
                                          </span>
                                        )}
                                        {prevResult.alarm_verified ===
                                          false && (
                                          <span className="text-red-500 ml-auto">
                                            Alarm not found ✗
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
