/**
 * Alarm Trigger Panel
 * 
 * UI component for triggering device-specific alarms based on the device library.
 * Displays applicable alarms for selected devices and allows one-click triggering.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Thermometer, 
  Snowflake, 
  DoorOpen, 
  Droplets, 
  Wind, 
  BatteryLow, 
  WifiOff, 
  Activity,
  ShieldAlert,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { AlarmTrigger, AlarmTriggerId } from '@/lib/deviceLibrary/alarmTriggers';
import { 
  ALARM_TRIGGERS, 
  getAlarmsForCategories,
  getSeverityColor,
  getSeverityIconBg,
} from '@/lib/deviceLibrary/alarmTriggers';
import type { DeviceCategory } from '@/lib/deviceLibrary/types';

// ============================================
// Icon Mapping
// ============================================

const ALARM_ICONS: Record<string, React.ReactNode> = {
  Thermometer: <Thermometer className="h-4 w-4" />,
  Snowflake: <Snowflake className="h-4 w-4" />,
  DoorOpen: <DoorOpen className="h-4 w-4" />,
  Droplets: <Droplets className="h-4 w-4" />,
  Wind: <Wind className="h-4 w-4" />,
  BatteryLow: <BatteryLow className="h-4 w-4" />,
  WifiOff: <WifiOff className="h-4 w-4" />,
  Activity: <Activity className="h-4 w-4" />,
  ShieldAlert: <ShieldAlert className="h-4 w-4" />,
};

// ============================================
// Component Props
// ============================================

interface AlarmTriggerPanelProps {
  /** Selected device instance IDs */
  selectedDeviceIds: string[];
  /** Map of device ID to library device category */
  deviceCategories: Record<string, DeviceCategory>;
  /** Callback when alarm is triggered */
  onTriggerAlarm: (alarmId: AlarmTriggerId, deviceIds: string[]) => void;
  /** Currently active alarm (if any) */
  activeAlarm?: AlarmTriggerId | null;
  /** Callback to clear active alarm */
  onClearAlarm?: () => void;
  /** Disabled state */
  disabled?: boolean;
}

// ============================================
// Component
// ============================================

export default function AlarmTriggerPanel({
  selectedDeviceIds,
  deviceCategories,
  onTriggerAlarm,
  activeAlarm,
  onClearAlarm,
  disabled = false,
}: AlarmTriggerPanelProps) {
  const [pendingAlarm, setPendingAlarm] = useState<AlarmTriggerId | null>(null);
  
  // Get unique categories from selected devices
  const selectedCategories = [...new Set(
    selectedDeviceIds
      .map(id => deviceCategories[id])
      .filter((cat): cat is DeviceCategory => !!cat)
  )];
  
  // Get applicable alarms for selected categories
  const applicableAlarms = getAlarmsForCategories(selectedCategories);
  
  const hasSelection = selectedDeviceIds.length > 0;
  const hasApplicableAlarms = applicableAlarms.length > 0;
  
  const handleTriggerAlarm = (alarmId: AlarmTriggerId) => {
    if (!hasSelection || disabled) return;
    
    // Find devices that this alarm applies to
    const alarm = ALARM_TRIGGERS[alarmId];
    const applicableDeviceIds = selectedDeviceIds.filter(id => {
      const category = deviceCategories[id];
      return category && alarm.applicableCategories.includes(category);
    });
    
    if (applicableDeviceIds.length === 0) {
      toast({
        title: 'Alarm not applicable',
        description: 'Selected devices do not support this alarm type',
        variant: 'destructive',
      });
      return;
    }
    
    console.log('[ALARM_TRIGGER]', {
      alarm_id: alarmId,
      alarm_name: alarm.name,
      device_ids: applicableDeviceIds,
      timestamp: new Date().toISOString(),
    });
    
    onTriggerAlarm(alarmId, applicableDeviceIds);
    
    toast({
      title: `Triggered: ${alarm.name}`,
      description: `Applied to ${applicableDeviceIds.length} device${applicableDeviceIds.length !== 1 ? 's' : ''}`,
    });
  };
  
  const handleClearAlarm = () => {
    onClearAlarm?.();
    toast({
      title: 'Alarm cleared',
      description: 'Devices returned to normal operation',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Alarm Triggers</h3>
          <p className="text-xs text-muted-foreground">
            Simulate device alarm conditions
          </p>
        </div>
        {activeAlarm && onClearAlarm && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAlarm}
            className="text-destructive"
          >
            <X className="h-3 w-3 mr-1" />
            Clear Alarm
          </Button>
        )}
      </div>

      {/* Active alarm indicator */}
      {activeAlarm && (
        <Alert className="bg-destructive/10 border-destructive/30">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive">
            Active alarm: <strong>{ALARM_TRIGGERS[activeAlarm]?.name}</strong>
          </AlertDescription>
        </Alert>
      )}

      {/* No selection warning */}
      {!hasSelection && !disabled && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Select at least one device to trigger alarms
          </AlertDescription>
        </Alert>
      )}

      {/* No applicable alarms */}
      {hasSelection && !hasApplicableAlarms && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No alarms available for selected device types
          </AlertDescription>
        </Alert>
      )}

      {/* Alarm grid */}
      {hasApplicableAlarms && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {applicableAlarms.map(alarm => {
            const isActive = activeAlarm === alarm.id;
            const icon = ALARM_ICONS[alarm.icon] || <AlertTriangle className="h-4 w-4" />;
            
            return (
              <Card
                key={alarm.id}
                className={`cursor-pointer transition-all hover:border-primary hover:shadow-sm ${
                  disabled || !hasSelection ? 'opacity-50 pointer-events-none' : ''
                } ${isActive ? 'border-destructive bg-destructive/5' : ''}`}
                onClick={() => !disabled && handleTriggerAlarm(alarm.id as AlarmTriggerId)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-md ${getSeverityIconBg(alarm.severity)}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <h4 className="font-medium text-sm truncate">{alarm.name}</h4>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {alarm.description}
                      </p>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${getSeverityColor(alarm.severity)}`}
                      >
                        {alarm.severity}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
