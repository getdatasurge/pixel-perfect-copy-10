import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, Loader2, Check, X, Copy, Radio, AlertCircle } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';
import { LoRaWANDevice, normalizeDevEui } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface StepDeviceRegistrationProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
  isValidating: boolean;
  setIsValidating: (v: boolean) => void;
  devices: LoRaWANDevice[];
}

interface DeviceCheckResult {
  deviceId: string;
  devEui: string;
  status: 'checking' | 'registered' | 'not_found' | 'error';
  error?: string;
}

export default function StepDeviceRegistration({
  config,
  updateConfig,
  markStepPassed,
  stepStatus,
  isValidating,
  setIsValidating,
  devices,
}: StepDeviceRegistrationProps) {
  const [deviceResults, setDeviceResults] = useState<DeviceCheckResult[]>([]);
  const [hasChecked, setHasChecked] = useState(false);

  const checkDevices = async () => {
    if (!config.apiKey || !config.applicationId) {
      toast({
        title: 'Missing Configuration',
        description: 'Complete API Key step first',
        variant: 'destructive',
      });
      return;
    }

    setIsValidating(true);
    const results: DeviceCheckResult[] = [];

    for (const device of devices) {
      const normalizedDevEui = normalizeDevEui(device.devEui);
      if (!normalizedDevEui) continue;

      const deviceId = `sensor-${normalizedDevEui}`;
      
      results.push({
        deviceId,
        devEui: device.devEui,
        status: 'checking',
      });
      setDeviceResults([...results]);

      try {
        const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
          body: {
            action: 'check_device',
            cluster: config.cluster,
            application_id: config.applicationId,
            api_key: config.apiKey,
            device_id: deviceId,
          },
        });

        const idx = results.findIndex(r => r.deviceId === deviceId);
        if (error || !data?.ok) {
          results[idx] = {
            ...results[idx],
            status: data?.exists ? 'registered' : 'not_found',
            error: data?.error,
          };
        } else {
          results[idx] = {
            ...results[idx],
            status: data.exists ? 'registered' : 'not_found',
          };
        }
        setDeviceResults([...results]);
      } catch (err: any) {
        const idx = results.findIndex(r => r.deviceId === deviceId);
        results[idx] = {
          ...results[idx],
          status: 'error',
          error: err.message,
        };
        setDeviceResults([...results]);
      }
    }

    setIsValidating(false);
    setHasChecked(true);

    // Mark step as passed if at least one device is registered OR allow skip
    const hasRegistered = results.some(r => r.status === 'registered');
    markStepPassed(4, true); // Always allow proceeding
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  const ttnDevicesUrl = `https://${config.cluster}.cloud.thethings.network/console/applications/${config.applicationId}/devices/add`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Device Registration Check</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Devices must be registered in TTN before uplinks will work. They are NOT auto-created.
        </p>
      </div>

      {/* Warning */}
      <Alert className="border-amber-500/50 bg-amber-500/10">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-700">Manual Registration Required</AlertTitle>
        <AlertDescription className="text-sm text-amber-600">
          You must register each device in the TTN Console before using the emulator.
          Use the credentials shown below.
        </AlertDescription>
      </Alert>

      {/* Device List */}
      <div className="space-y-4">
        <Label>Emulator Devices</Label>
        {devices.map((device) => {
          const normalizedDevEui = normalizeDevEui(device.devEui);
          const deviceId = normalizedDevEui ? `sensor-${normalizedDevEui}` : 'Invalid DevEUI';
          const result = deviceResults.find(r => r.devEui === device.devEui);

          return (
            <Card key={device.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{device.name}</span>
                  <Badge variant="outline">{device.type}</Badge>
                </div>

                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">TTN Device ID:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs">{deviceId}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(deviceId, 'Device ID')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">DevEUI:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{device.devEui}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(device.devEui, 'DevEUI')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">JoinEUI:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{device.joinEui}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(device.joinEui, 'JoinEUI')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">AppKey:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono truncate max-w-[200px]">
                        {device.appKey}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(device.appKey, 'AppKey')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {result && (
                  <div className="pt-2 border-t">
                    {result.status === 'checking' ? (
                      <Badge variant="secondary">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Checking...
                      </Badge>
                    ) : result.status === 'registered' ? (
                      <Badge className="bg-green-500">
                        <Check className="h-3 w-3 mr-1" />
                        Registered in TTN
                      </Badge>
                    ) : result.status === 'not_found' ? (
                      <Badge variant="outline" className="text-amber-600 border-amber-500">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Not Found - Register in TTN
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <X className="h-3 w-3 mr-1" />
                        Error: {result.error}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          asChild
        >
          <a href={ttnDevicesUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Register Device in TTN
          </a>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={checkDevices}
          disabled={isValidating}
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Radio className="h-4 w-4 mr-2" />
          )}
          Check Device Status
        </Button>
      </div>

      {hasChecked && !deviceResults.some(r => r.status === 'registered') && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            No devices are registered yet. You can continue setup and register devices later,
            but uplinks will fail until devices are registered in TTN.
          </AlertDescription>
        </Alert>
      )}

      {/* Mark step as passed by default - device registration is optional for proceeding */}
      {!stepStatus?.passed && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markStepPassed(4, true)}
          className="text-muted-foreground"
        >
          Skip for now (register later)
        </Button>
      )}
    </div>
  );
}
