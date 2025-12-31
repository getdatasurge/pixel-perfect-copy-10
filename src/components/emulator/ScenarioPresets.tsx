import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Snowflake, Thermometer, AlertTriangle, DoorOpen, BatteryLow, WifiOff } from 'lucide-react';

export interface ScenarioConfig {
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'Freezer' | 'Fridge' | 'Alert' | 'Sensor';
  tempRange?: { min: number; max: number };
  humidity?: number;
  doorBehavior?: 'normal' | 'stuck-open' | 'rapid';
  batteryLevel?: number;
  signalStrength?: number;
}

const scenarios: ScenarioConfig[] = [
  {
    name: 'Normal Freezer',
    description: 'Stable freezer at -18°F to -10°F',
    icon: <Snowflake className="h-4 w-4" />,
    category: 'Freezer',
    tempRange: { min: -18, max: -10 },
    humidity: 30,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Normal Refrigerator',
    description: 'Stable fridge at 35°F to 40°F',
    icon: <Thermometer className="h-4 w-4" />,
    category: 'Fridge',
    tempRange: { min: 35, max: 40 },
    humidity: 45,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Temp Excursion',
    description: 'Rising temp simulating failure',
    icon: <AlertTriangle className="h-4 w-4" />,
    category: 'Alert',
    tempRange: { min: 45, max: 60 },
    humidity: 70,
    batteryLevel: 95,
    signalStrength: -65,
  },
  {
    name: 'Door Left Open',
    description: 'Door sensor stuck open',
    icon: <DoorOpen className="h-4 w-4" />,
    category: 'Alert',
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
    category: 'Sensor',
    tempRange: { min: 35, max: 40 },
    batteryLevel: 8,
    signalStrength: -65,
  },
  {
    name: 'Poor Signal',
    description: 'Weak gateway connection',
    icon: <WifiOff className="h-4 w-4" />,
    category: 'Sensor',
    tempRange: { min: 35, max: 40 },
    batteryLevel: 95,
    signalStrength: -95,
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
}

export default function ScenarioPresets({ onApply, disabled }: ScenarioPresetsProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Test Scenarios</h3>
        <p className="text-xs text-muted-foreground">
          Quick presets for common conditions
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {scenarios.map(scenario => (
          <Card 
            key={scenario.name} 
            className={`cursor-pointer transition-all hover:border-primary hover:shadow-sm ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => !disabled && onApply(scenario)}
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
        ))}
      </div>
    </div>
  );
}
