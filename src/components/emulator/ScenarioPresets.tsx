import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Snowflake, Thermometer, AlertTriangle, DoorOpen, BatteryLow, WifiOff, Info, X, Droplets } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { ScenarioType } from '@/lib/deviceLibrary/scenarioComposer';

export interface ScenarioConfig {
  id: ScenarioType;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'Freezer' | 'Fridge' | 'Alert' | 'Sensor';
  tempRange?: { min: number; max: number };
  humidity?: number;
  doorBehavior?: 'normal' | 'stuck-open' | 'rapid';
  batteryLevel?: number;
  signalStrength?: number;
  /** Device library scenario type mapping */
  libraryScenario?: ScenarioType;
}

const scenarios: ScenarioConfig[] = [
  {
    id: 'normal',
    name: 'Normal Freezer',
    description: 'Stable freezer at -18°F to -10°F',
    icon: <Snowflake className="h-4 w-4" />,
    category: 'Freezer',
    tempRange: { min: -18, max: -10 },
    humidity: 30,
    batteryLevel: 95,
    signalStrength: -65,
    libraryScenario: 'normal',
  },
  {
    id: 'normal',
    name: 'Normal Refrigerator',
    description: 'Stable fridge at 35°F to 40°F',
    icon: <Thermometer className="h-4 w-4" />,
    category: 'Fridge',
    tempRange: { min: 35, max: 40 },
    humidity: 45,
    batteryLevel: 95,
    signalStrength: -65,
    libraryScenario: 'normal',
  },
  {
    id: 'temp_excursion',
    name: 'Temp Excursion',
    description: 'Rising temp simulating failure',
    icon: <AlertTriangle className="h-4 w-4" />,
    category: 'Alert',
    tempRange: { min: 45, max: 60 },
    humidity: 70,
    batteryLevel: 95,
    signalStrength: -65,
    libraryScenario: 'temp_excursion',
  },
  {
    id: 'door_left_open',
    name: 'Door Left Open',
    description: 'Door sensor stuck open',
    icon: <DoorOpen className="h-4 w-4" />,
    category: 'Alert',
    tempRange: { min: 40, max: 55 },
    humidity: 60,
    doorBehavior: 'stuck-open',
    batteryLevel: 95,
    signalStrength: -65,
    libraryScenario: 'door_left_open',
  },
  {
    id: 'leak',
    name: 'Leak Detected',
    description: 'Water leak alarm triggered',
    icon: <Droplets className="h-4 w-4" />,
    category: 'Alert',
    batteryLevel: 95,
    signalStrength: -65,
    libraryScenario: 'leak',
  },
  {
    id: 'low_battery',
    name: 'Low Battery',
    description: 'Critical battery level alert',
    icon: <BatteryLow className="h-4 w-4" />,
    category: 'Sensor',
    tempRange: { min: 35, max: 40 },
    batteryLevel: 8,
    signalStrength: -65,
    libraryScenario: 'low_battery',
  },
  {
    id: 'poor_signal',
    name: 'Poor Signal',
    description: 'Weak gateway connection',
    icon: <WifiOff className="h-4 w-4" />,
    category: 'Sensor',
    tempRange: { min: 35, max: 40 },
    batteryLevel: 95,
    signalStrength: -95,
    libraryScenario: 'poor_signal',
  },
];

const categoryColors: Record<ScenarioConfig['category'], string> = {
  Freezer: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  Fridge: 'bg-green-500/10 text-green-600 border-green-500/30',
  Alert: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  Sensor: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
};

const iconBgColors: Record<ScenarioConfig['category'], string> = {
  Freezer: 'bg-blue-500/10 text-blue-500',
  Fridge: 'bg-green-500/10 text-green-500',
  Alert: 'bg-amber-500/10 text-amber-500',
  Sensor: 'bg-purple-500/10 text-purple-500',
};

interface ScenarioPresetsProps {
  onApply: (scenario: ScenarioConfig) => void;
  disabled?: boolean;
  // New props for multi-sensor targeting
  selectedSensorIds?: string[];
  sensorTypes?: Record<string, 'temperature' | 'door'>;
  // Active scenario tracking
  activeScenario?: ScenarioType | null;
  onClearScenario?: () => void;
}

export default function ScenarioPresets({ 
  onApply, 
  disabled,
  selectedSensorIds = [],
  sensorTypes = {},
  activeScenario,
  onClearScenario,
}: ScenarioPresetsProps) {
  const hasSelection = selectedSensorIds.length > 0;
  
  // Count sensors by type
  const tempSensorCount = selectedSensorIds.filter(id => sensorTypes[id] === 'temperature').length;
  const doorSensorCount = selectedSensorIds.filter(id => sensorTypes[id] === 'door').length;
  const hasMixedTypes = tempSensorCount > 0 && doorSensorCount > 0;

  const handleApply = (scenario: ScenarioConfig) => {
    if (!hasSelection) return;
    
    // Log scenario application
    console.log('[SCENARIO_APPLY]', {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      library_scenario: scenario.libraryScenario,
      selected_sensor_ids: selectedSensorIds,
      temp_sensors: tempSensorCount,
      door_sensors: doorSensorCount,
      timestamp: new Date().toISOString(),
    });
    
    onApply(scenario);
    
    // Show toast with count
    const targetCount = scenario.doorBehavior 
      ? doorSensorCount 
      : scenario.tempRange 
        ? tempSensorCount 
        : selectedSensorIds.length;
    
    toast({
      title: `Applied "${scenario.name}"`,
      description: `Applied to ${targetCount} sensor${targetCount !== 1 ? 's' : ''}`,
    });
  };

  const handleClearScenario = () => {
    onClearScenario?.();
    toast({
      title: 'Scenario cleared',
      description: 'Devices returned to normal operation',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Test Scenarios</h3>
          <p className="text-xs text-muted-foreground">
            Quick presets for common conditions
          </p>
        </div>
        {activeScenario && activeScenario !== 'normal' && onClearScenario && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearScenario}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear Scenario
          </Button>
        )}
      </div>

      {/* Active scenario indicator */}
      {activeScenario && activeScenario !== 'normal' && (
        <Alert className="bg-amber-500/10 border-amber-500/30">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-amber-700">
            Active scenario: <strong>{scenarios.find(s => s.libraryScenario === activeScenario)?.name || activeScenario}</strong>
          </AlertDescription>
        </Alert>
      )}

      {/* No selection warning */}
      {!hasSelection && !disabled && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Select at least one sensor to apply scenarios
          </AlertDescription>
        </Alert>
      )}

      {/* Mixed types warning */}
      {hasMixedTypes && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Mixed sensor types selected. Temperature scenarios apply only to Temp sensors, 
            door scenarios apply only to Door sensors.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {scenarios.map((scenario, index) => {
          // Determine if this scenario applies to any selected sensors
          const appliesToTemp = scenario.tempRange && tempSensorCount > 0;
          const appliesToDoor = scenario.doorBehavior && doorSensorCount > 0;
          const appliesToAny = appliesToTemp || appliesToDoor || 
            (scenario.batteryLevel !== undefined || scenario.signalStrength !== undefined);
          
          const isDisabled = disabled || !hasSelection || (!appliesToAny && hasSelection);
          const isActive = activeScenario === scenario.libraryScenario && scenario.libraryScenario !== 'normal';
          
          return (
            <Card 
              key={`${scenario.name}-${index}`}
              className={`cursor-pointer transition-all hover:border-primary hover:shadow-sm ${
                isDisabled ? 'opacity-50 pointer-events-none' : ''
              } ${isActive ? 'border-amber-500 bg-amber-500/5' : ''}`}
              onClick={() => !isDisabled && handleApply(scenario)}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-md ${iconBgColors[scenario.category]}`}>
                    {scenario.icon}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm truncate">{scenario.name}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {scenario.description}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-xs ${categoryColors[scenario.category]}`}>
                        {scenario.category}
                      </Badge>
                      {scenario.tempRange && (
                        <span className="text-xs text-muted-foreground">
                          {scenario.tempRange.min}°F — {scenario.tempRange.max}°F
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
    </div>
  );
}
