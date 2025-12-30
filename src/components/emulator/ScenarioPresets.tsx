import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Snowflake, Thermometer, AlertTriangle, DoorOpen, BatteryLow, WifiOff } from 'lucide-react';

export interface ScenarioConfig {
  name: string;
  description: string;
  icon: React.ReactNode;
  tempRange?: { min: number; max: number };
  humidity?: number;
  doorBehavior?: 'normal' | 'stuck-open' | 'rapid';
  batteryLevel?: number;
  signalStrength?: number;
}

const scenarios: ScenarioConfig[] = [
  {
    name: 'Normal Freezer',
    description: 'Stable freezer operation at -18°F to -10°F',
    icon: <Snowflake className="h-4 w-4" />,
    tempRange: { min: -18, max: -10 },
    humidity: 30,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Normal Refrigerator',
    description: 'Stable fridge operation at 35°F to 40°F',
    icon: <Thermometer className="h-4 w-4" />,
    tempRange: { min: 35, max: 40 },
    humidity: 45,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Temperature Excursion',
    description: 'Rising temperature simulating failure',
    icon: <AlertTriangle className="h-4 w-4" />,
    tempRange: { min: 45, max: 60 },
    humidity: 70,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Door Left Open',
    description: 'Door sensor stuck in open state',
    icon: <DoorOpen className="h-4 w-4" />,
    tempRange: { min: 40, max: 55 },
    humidity: 60,
    doorBehavior: 'stuck-open',
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Low Battery',
    description: 'Critical battery level alert',
    icon: <BatteryLow className="h-4 w-4" />,
    tempRange: { min: 35, max: 40 },
    batteryLevel: 8,
    signalStrength: -65,
  },
  {
    name: 'Poor Signal',
    description: 'Weak gateway connection',
    icon: <WifiOff className="h-4 w-4" />,
    tempRange: { min: 35, max: 40 },
    batteryLevel: 95,
    signalStrength: -95,
  },
];

interface ScenarioPresetsProps {
  onApply: (scenario: ScenarioConfig) => void;
  disabled?: boolean;
}

export default function ScenarioPresets({ onApply, disabled }: ScenarioPresetsProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Test Scenarios</h3>
        <p className="text-sm text-muted-foreground">
          Quick presets to simulate various conditions
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {scenarios.map(scenario => (
          <Card 
            key={scenario.name} 
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => !disabled && onApply(scenario)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-muted">
                  {scenario.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{scenario.name}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {scenario.description}
                  </p>
                  {scenario.tempRange && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      {scenario.tempRange.min}°F - {scenario.tempRange.max}°F
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
