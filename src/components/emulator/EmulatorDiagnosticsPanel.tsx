/**
 * Emulator Diagnostics Panel
 * 
 * Displays real-time state verification for door sensors and scheduling.
 * Shows truth source, payload preview, and next fire times.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, Clock, Zap, DoorOpen, DoorClosed } from 'lucide-react';
import { SensorState } from '@/lib/emulatorSensorState';
import { LoRaWANDevice } from '@/lib/ttn-payload';
import { toCanonicalDoor, validateDoorConsistency } from '@/lib/doorStateCanonical';
import { EmissionScheduler, DeviceEmissionStatus } from '@/lib/deviceLibrary/emissionScheduler';

interface Props {
  devices: LoRaWANDevice[];
  sensorStates: Record<string, SensorState>;
  scheduler: EmissionScheduler | null;
  isRunning: boolean;
  onTestUplink: (deviceId: string, explicitDoorState?: boolean) => void;
}

export default function EmulatorDiagnosticsPanel({ 
  devices, 
  sensorStates, 
  scheduler,
  isRunning,
  onTestUplink 
}: Props) {
  const doorDevices = devices.filter(d => d.type === 'door');
  const tempDevices = devices.filter(d => d.type === 'temperature');

  // Get formatted time until next fire
  const getTimeUntilNextFire = (status: DeviceEmissionStatus | null): string => {
    if (!status?.nextFireAt || !status.isRunning) return 'Not scheduled';
    const nextFire = new Date(status.nextFireAt).getTime();
    const now = Date.now();
    const diff = nextFire - now;
    if (diff <= 0) return 'Firing...';
    const seconds = Math.ceil(diff / 1000);
    return `${seconds}s`;
  };

  return (
    <Card className="border-dashed border-2 border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-500" />
          Emulator Diagnostics
          {isRunning ? (
            <Badge variant="default" className="ml-auto text-xs">Running</Badge>
          ) : (
            <Badge variant="secondary" className="ml-auto text-xs">Stopped</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Door Sensors Section */}
        {doorDevices.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              Door Sensors ({doorDevices.length})
            </h4>
            <ScrollArea className="max-h-48">
              <div className="space-y-2">
                {doorDevices.map(device => {
                  const state = sensorStates[device.id];
                  const status = scheduler?.getStatus(device.id);
                  const canonical = toCanonicalDoor(state?.doorOpen ?? false);
                  
                  // Validate consistency
                  const payloadPreview = {
                    door_status: canonical.door_status,
                    door_open: canonical.door_open,
                  };
                  const validation = validateDoorConsistency(
                    state?.doorOpen ?? false,
                    payloadPreview.door_status,
                    payloadPreview.door_open
                  );

                  return (
                    <div 
                      key={device.id} 
                      className="border rounded-lg p-3 bg-background/50 space-y-2"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {state?.doorOpen ? (
                            <DoorOpen className="h-4 w-4 text-red-500" />
                          ) : (
                            <DoorClosed className="h-4 w-4 text-green-500" />
                          )}
                          <span className="font-medium text-sm">{device.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {validation.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          )}
                          <Badge variant={state?.doorOpen ? 'destructive' : 'default'}>
                            {canonical.label}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium">Truth:</span>{' '}
                          <code className="bg-muted px-1 rounded">
                            doorOpen={String(state?.doorOpen ?? false)}
                          </code>
                        </div>
                        <div>
                          <span className="font-medium">Payload:</span>{' '}
                          <code className="bg-muted px-1 rounded">
                            {canonical.door_status}/{String(canonical.door_open)}
                          </code>
                        </div>
                        <div>
                          <span className="font-medium">Last sent:</span>{' '}
                          {state?.lastSentAt 
                            ? new Date(state.lastSentAt).toLocaleTimeString() 
                            : 'never'}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span className="font-medium">Next:</span>{' '}
                          {getTimeUntilNextFire(status)}
                        </div>
                        <div>
                          <span className="font-medium">Emissions:</span>{' '}
                          {status?.emissionCount ?? 0}
                        </div>
                        <div>
                          <span className="font-medium">Errors:</span>{' '}
                          <span className={status?.errors ? 'text-red-500' : ''}>
                            {status?.errors ?? 0}
                          </span>
                        </div>
                      </div>

                      {!validation.valid && (
                        <div className="text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 rounded p-2">
                          ⚠️ {validation.error}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs h-7"
                          onClick={() => onTestUplink(device.id, state?.doorOpen)}
                        >
                          Send Test (Current: {canonical.label})
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs h-7"
                          onClick={() => onTestUplink(device.id, !state?.doorOpen)}
                        >
                          Send Toggle ({state?.doorOpen ? 'Closed' : 'Open'})
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Temperature Sensors Section */}
        {tempDevices.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              Temperature Sensors ({tempDevices.length})
            </h4>
            <ScrollArea className="max-h-32">
              <div className="space-y-2">
                {tempDevices.map(device => {
                  const state = sensorStates[device.id];
                  const status = scheduler?.getStatus(device.id);

                  return (
                    <div 
                      key={device.id} 
                      className="border rounded-lg p-2 bg-background/50 flex justify-between items-center"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{device.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {state?.minTempF}°F - {state?.maxTempF}°F
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {getTimeUntilNextFire(status)}
                        <span className="text-muted-foreground/60">|</span>
                        <span>{status?.emissionCount ?? 0} sent</span>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs h-6 px-2"
                          onClick={() => onTestUplink(device.id)}
                        >
                          Test
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Scheduler Summary */}
        {scheduler && (
          <div className="border-t pt-2 mt-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Active devices: {scheduler.activeCount}</span>
              <span>Total emissions: {scheduler.totalEmissions}</span>
              <span>Total errors: {scheduler.totalErrors}</span>
            </div>
          </div>
        )}

        {devices.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">
            No devices configured
          </div>
        )}
      </CardContent>
    </Card>
  );
}
