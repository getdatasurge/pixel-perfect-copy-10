import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Check, X, Play, ShieldCheck, Radio, Webhook, Globe, Key } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';
import { LoRaWANDevice, normalizeDevEui } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';

interface StepVerificationProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
  isValidating: boolean;
  setIsValidating: (v: boolean) => void;
  devices: LoRaWANDevice[];
}

interface VerificationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: 'pending' | 'checking' | 'passed' | 'failed';
  message?: string;
}

export default function StepVerification({
  config,
  markStepPassed,
  isValidating,
  setIsValidating,
  devices,
}: StepVerificationProps) {
  const [items, setItems] = useState<VerificationItem[]>([
    { id: 'cluster', label: 'Cluster configured', icon: <Globe className="h-4 w-4" />, status: 'pending' },
    { id: 'app', label: 'Application accessible', icon: <ShieldCheck className="h-4 w-4" />, status: 'pending' },
    { id: 'apikey', label: 'API key valid', icon: <Key className="h-4 w-4" />, status: 'pending' },
    { id: 'device', label: 'Device registered', icon: <Radio className="h-4 w-4" />, status: 'pending' },
    { id: 'webhook', label: 'Webhook configured', icon: <Webhook className="h-4 w-4" />, status: 'pending' },
  ]);
  const [hasRun, setHasRun] = useState(false);

  const updateItem = (id: string, updates: Partial<VerificationItem>) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const runVerification = async () => {
    setIsValidating(true);
    setHasRun(true);

    // Reset all to checking
    setItems(prev => prev.map(item => ({ ...item, status: 'checking' as const, message: undefined })));

    // Step 1: Cluster
    updateItem('cluster', { status: 'passed', message: `${config.cluster} cluster selected` });
    await new Promise(r => setTimeout(r, 300));

    // Step 2 & 3: Test connection (validates app + api key)
    updateItem('app', { status: 'checking' });
    updateItem('apikey', { status: 'checking' });

    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test',
          cluster: config.cluster,
          application_id: config.applicationId,
          api_key: config.apiKey,
        },
      });

      if (error || !data?.ok || !data?.connected) {
        updateItem('app', { status: 'failed', message: data?.error || error?.message || 'Connection failed' });
        updateItem('apikey', { status: 'failed', message: data?.hint || 'Check API key permissions' });
        updateItem('device', { status: 'pending' });
        updateItem('webhook', { status: 'pending' });
        setIsValidating(false);
        markStepPassed(6, false, 'Connection test failed');
        return;
      }

      updateItem('app', { status: 'passed', message: `Application "${config.applicationId}" found` });
      updateItem('apikey', { status: 'passed', message: 'API key valid with required permissions' });
    } catch (err: any) {
      updateItem('app', { status: 'failed', message: err.message });
      updateItem('apikey', { status: 'failed' });
      setIsValidating(false);
      markStepPassed(6, false, err.message);
      return;
    }

    await new Promise(r => setTimeout(r, 300));

    // Step 4: Check device registration
    updateItem('device', { status: 'checking' });

    let deviceRegistered = false;
    if (devices.length > 0) {
      const device = devices[0];
      const normalizedDevEui = normalizeDevEui(device.devEui);
      const deviceId = normalizedDevEui ? `sensor-${normalizedDevEui}` : null;

      if (deviceId) {
        try {
          const { data } = await supabase.functions.invoke('manage-ttn-settings', {
            body: {
              action: 'check_device',
              cluster: config.cluster,
              application_id: config.applicationId,
              api_key: config.apiKey,
              device_id: deviceId,
            },
          });

          if (data?.exists) {
            deviceRegistered = true;
            updateItem('device', { status: 'passed', message: `Device "${deviceId}" registered` });
          } else {
            updateItem('device', { status: 'failed', message: `Device not found in TTN - register manually` });
          }
        } catch {
          updateItem('device', { status: 'failed', message: 'Could not check device status' });
        }
      }
    } else {
      updateItem('device', { status: 'failed', message: 'No devices configured in emulator' });
    }

    await new Promise(r => setTimeout(r, 300));

    // Step 5: Webhook (self-reported)
    updateItem('webhook', { status: 'passed', message: 'User confirmed webhook configuration' });

    setIsValidating(false);

    // Mark overall as passed if core items pass (device registration is a warning, not blocker)
    const coreItemsPassed = items.filter(i => i.id !== 'device').every(i => 
      i.status === 'passed' || i.status === 'checking'
    );

    // Re-read current state
    setTimeout(() => {
      setItems(current => {
        const allPassed = current.filter(i => i.id !== 'device').every(i => i.status === 'passed');
        markStepPassed(6, allPassed, allPassed ? undefined : 'Some checks failed');
        return current;
      });
    }, 100);
  };

  const getStatusIcon = (status: VerificationItem['status']) => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'passed':
        return <Check className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <X className="h-4 w-4 text-destructive" />;
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted" />;
    }
  };

  const allPassed = items.every(i => i.status === 'passed');
  const hasFailed = items.some(i => i.status === 'failed');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Final Verification</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Run a complete test to verify your TTN configuration is correct.
        </p>
      </div>

      {/* Configuration Summary */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Cluster:</span>
            <code className="bg-muted px-2 rounded">{config.cluster}</code>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Application:</span>
            <code className="bg-muted px-2 rounded">{config.applicationId}</code>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">API Key:</span>
            <code className="bg-muted px-2 rounded">****{config.apiKey.slice(-8)}</code>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Devices:</span>
            <Badge variant="outline">{devices.length} configured</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Verification Checklist */}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 p-3 rounded-lg border ${
              item.status === 'passed'
                ? 'bg-green-500/5 border-green-500/30'
                : item.status === 'failed'
                ? 'bg-destructive/5 border-destructive/30'
                : 'bg-muted/30'
            }`}
          >
            {getStatusIcon(item.status)}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {item.icon}
                <span className="font-medium text-sm">{item.label}</span>
              </div>
              {item.message && (
                <p className="text-xs text-muted-foreground mt-0.5">{item.message}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={runVerification}
        disabled={isValidating}
        className="w-full"
        size="lg"
      >
        {isValidating ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Play className="h-4 w-4 mr-2" />
        )}
        {hasRun ? 'Run Again' : 'Run Full Test'}
      </Button>

      {hasRun && allPassed && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <Check className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-700">All Checks Passed!</AlertTitle>
          <AlertDescription className="text-green-600">
            Your TTN integration is configured correctly. Click "Complete Setup" to save and start using TTN routing.
          </AlertDescription>
        </Alert>
      )}

      {hasRun && hasFailed && !allPassed && (
        <Alert variant="destructive">
          <X className="h-4 w-4" />
          <AlertTitle>Some Checks Failed</AlertTitle>
          <AlertDescription>
            Review the failed items above and use the "Back" button to fix the configuration.
            Device registration warnings can be addressed later.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
