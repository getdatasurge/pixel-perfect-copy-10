/**
 * Scenario & Alarm Panel
 *
 * Unified panel displaying every alarm-generating scenario as a clickable card.
 * Grouped by category, filterable by selected sensor types.
 * NOT disabled during emulation — clicking triggers immediate real-time emission.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Snowflake,
  Thermometer,
  ThermometerSun,
  Flame,
  TrendingUp,
  ZapOff,
  DoorOpen,
  DoorClosed,
  RefreshCw,
  Droplets,
  Wind,
  CloudRain,
  BatteryLow,
  BatteryWarning,
  WifiOff,
  RadioTower,
  Activity,
  ShieldAlert,
  AlertTriangle,
  Info,
  X,
  ChevronDown,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type {
  ScenarioAlarmDef,
  ScenarioAlarmCategory,
  ScenarioAlarmSeverity,
} from '@/lib/scenarioAlarmDefinitions';
import {
  SCENARIO_ALARM_DEFS,
  CATEGORY_ORDER,
  CATEGORY_COLORS,
  CATEGORY_ICON_BG,
  SEVERITY_COLORS,
  getGroupedScenarios,
} from '@/lib/scenarioAlarmDefinitions';

// ============================================
// Icon Mapping
// ============================================

const ICON_MAP: Record<string, React.ReactNode> = {
  Snowflake: <Snowflake className="h-4 w-4" />,
  Thermometer: <Thermometer className="h-4 w-4" />,
  ThermometerSun: <ThermometerSun className="h-4 w-4" />,
  Flame: <Flame className="h-4 w-4" />,
  TrendingUp: <TrendingUp className="h-4 w-4" />,
  ZapOff: <ZapOff className="h-4 w-4" />,
  DoorOpen: <DoorOpen className="h-4 w-4" />,
  DoorClosed: <DoorClosed className="h-4 w-4" />,
  RefreshCw: <RefreshCw className="h-4 w-4" />,
  Droplets: <Droplets className="h-4 w-4" />,
  Wind: <Wind className="h-4 w-4" />,
  CloudRain: <CloudRain className="h-4 w-4" />,
  BatteryLow: <BatteryLow className="h-4 w-4" />,
  BatteryWarning: <BatteryWarning className="h-4 w-4" />,
  WifiOff: <WifiOff className="h-4 w-4" />,
  RadioTower: <RadioTower className="h-4 w-4" />,
  Activity: <Activity className="h-4 w-4" />,
  ShieldAlert: <ShieldAlert className="h-4 w-4" />,
};

// ============================================
// Props
// ============================================

interface ScenarioAlarmPanelProps {
  onApplyScenario: (scenario: ScenarioAlarmDef) => void;
  selectedSensorIds: string[];
  sensorTypes: Record<string, 'temperature' | 'door'>;
  activeScenarioId: string | null;
  onClearScenario: () => void;
  isRunning: boolean;
}

// ============================================
// Component
// ============================================

export default function ScenarioAlarmPanel({
  onApplyScenario,
  selectedSensorIds,
  sensorTypes,
  activeScenarioId,
  onClearScenario,
  isRunning,
}: ScenarioAlarmPanelProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const hasSelection = selectedSensorIds.length > 0;
  const tempSensorCount = selectedSensorIds.filter(id => sensorTypes[id] === 'temperature').length;
  const doorSensorCount = selectedSensorIds.filter(id => sensorTypes[id] === 'door').length;

  const grouped = getGroupedScenarios();

  const getAffectedCount = (scenario: ScenarioAlarmDef): number => {
    switch (scenario.affectedSensorTypes) {
      case 'temperature':
        return tempSensorCount;
      case 'door':
        return doorSensorCount;
      case 'all':
        return selectedSensorIds.length;
    }
  };

  const isScenarioApplicable = (scenario: ScenarioAlarmDef): boolean => {
    return getAffectedCount(scenario) > 0;
  };

  const handleApply = (scenario: ScenarioAlarmDef) => {
    if (!hasSelection) return;
    if (!isScenarioApplicable(scenario)) return;

    const affectedCount = getAffectedCount(scenario);

    console.log('[SCENARIO_ALARM_APPLY]', {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      severity: scenario.severity,
      affected_sensor_types: scenario.affectedSensorTypes,
      affected_count: affectedCount,
      is_running: isRunning,
      timestamp: new Date().toISOString(),
    });

    onApplyScenario(scenario);

    toast({
      title: isRunning
        ? `Executing: ${scenario.name}`
        : `Applied: ${scenario.name}`,
      description: isRunning
        ? `Emitting from ${affectedCount} sensor${affectedCount !== 1 ? 's' : ''} now`
        : `Applied to ${affectedCount} sensor${affectedCount !== 1 ? 's' : ''}`,
    });
  };

  const handleClear = () => {
    onClearScenario();
    toast({
      title: 'Scenario cleared',
      description: 'Devices returned to normal operation',
    });
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const activeDef = activeScenarioId
    ? SCENARIO_ALARM_DEFS.find(d => d.id === activeScenarioId)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Scenarios & Alarms</h3>
          <p className="text-xs text-muted-foreground">
            Click to apply and emit in real time
          </p>
        </div>
        {activeDef && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Active scenario indicator */}
      {activeDef && (
        <Alert className={
          activeDef.severity === 'critical'
            ? 'bg-destructive/10 border-destructive/30'
            : activeDef.severity === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-green-500/10 border-green-500/30'
        }>
          {isRunning ? (
            <Zap className="h-4 w-4 text-amber-500 animate-pulse" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <AlertDescription>
            Active: <strong>{activeDef.name}</strong>
            {isRunning && (
              <span className="ml-1 text-muted-foreground">(emitting)</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* No selection warning */}
      {!hasSelection && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Select at least one sensor to apply scenarios
          </AlertDescription>
        </Alert>
      )}

      {/* Category groups */}
      {CATEGORY_ORDER.map(category => {
        const items = grouped.get(category) || [];
        if (items.length === 0) return null;

        const isCollapsed = collapsedCategories.has(category);
        const applicableCount = items.filter(s => isScenarioApplicable(s)).length;

        return (
          <Collapsible
            key={category}
            open={!isCollapsed}
            onOpenChange={() => toggleCategory(category)}
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1.5 px-1 hover:bg-muted/50 rounded-md transition-colors">
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">{category}</span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[category]}`}>
                  {applicableCount}/{items.length}
                </Badge>
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                {items.map(scenario => {
                  const applicable = isScenarioApplicable(scenario);
                  const isActive = activeScenarioId === scenario.id;
                  const icon = ICON_MAP[scenario.icon] || <AlertTriangle className="h-4 w-4" />;
                  const affectedCount = getAffectedCount(scenario);

                  const severityBorderClass =
                    scenario.severity === 'critical'
                      ? 'border-destructive bg-destructive/5'
                      : scenario.severity === 'warning'
                        ? 'border-amber-500 bg-amber-500/5'
                        : 'border-green-500 bg-green-500/5';

                  return (
                    <Card
                      key={scenario.id}
                      className={`cursor-pointer transition-all hover:shadow-sm ${
                        !hasSelection || !applicable
                          ? 'opacity-40 pointer-events-none'
                          : 'hover:border-primary'
                      } ${isActive ? severityBorderClass : ''}`}
                      onClick={() => hasSelection && applicable && handleApply(scenario)}
                    >
                      <CardContent className="p-2.5">
                        <div className="flex items-start gap-2">
                          <div className={`p-1.5 rounded-md shrink-0 ${
                            isActive
                              ? (scenario.severity === 'critical'
                                  ? 'bg-destructive/10 text-destructive'
                                  : scenario.severity === 'warning'
                                    ? 'bg-amber-500/10 text-amber-500'
                                    : 'bg-green-500/10 text-green-500')
                              : CATEGORY_ICON_BG[scenario.category]
                          }`}>
                            {icon}
                          </div>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <h4 className="font-medium text-xs truncate leading-tight">
                              {scenario.name}
                            </h4>
                            <p className="text-[10px] text-muted-foreground line-clamp-1">
                              {scenario.description}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1 py-0 ${SEVERITY_COLORS[scenario.severity]}`}
                              >
                                {scenario.severity}
                              </Badge>
                              {applicable && (
                                <span className="text-[10px] text-muted-foreground">
                                  {affectedCount} sensor{affectedCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
