import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Play } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LoRaWANDevice, TTNConfig, generateTTNDeviceId } from '@/lib/ttn-payload';
import { ProvisionResult, ProvisioningSummary } from '../TTNProvisioningWizard';

interface StepExecutionProps {
  devices: LoRaWANDevice[];
  ttnConfig?: TTNConfig;
  orgId?: string;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  progress: number;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  results: ProvisionResult[];
  setResults: React.Dispatch<React.SetStateAction<ProvisionResult[]>>;
  setSummary: React.Dispatch<React.SetStateAction<ProvisioningSummary>>;
}

export default function StepExecution({
  devices,
  ttnConfig,
  orgId,
  isExecuting,
  setIsExecuting,
  progress,
  setProgress,
  results,
  setResults,
  setSummary,
}: StepExecutionProps) {
  const [currentDevice, setCurrentDevice] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  const startProvisioning = async () => {
    setIsExecuting(true);
    setHasStarted(true);
    setResults([]);
    setProgress(0);

    const summary: ProvisioningSummary = {
      created: 0,
      already_exists: 0,
      failed: 0,
      total: devices.length,
    };

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      setCurrentDevice(device.name);
      setProgress(Math.round((i / devices.length) * 100));

      let ttnDeviceId: string;
      try {
        ttnDeviceId = generateTTNDeviceId(device.devEui);
      } catch {
        // Invalid DevEUI
        const result: ProvisionResult = {
          dev_eui: device.devEui,
          name: device.name,
          ttn_device_id: 'invalid',
          status: 'failed',
          error: 'Invalid DevEUI format',
        };
        setResults(prev => [...prev, result]);
        summary.failed++;
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke('ttn-batch-provision', {
          body: {
            org_id: orgId,
            devices: [{
              dev_eui: device.devEui,
              join_eui: device.joinEui,
              app_key: device.appKey,
              name: device.name,
            }],
          },
        });

        if (error) throw error;

        if (data?.results?.[0]) {
          const resultItem = data.results[0];
          const result: ProvisionResult = {
            dev_eui: device.devEui,
            name: device.name,
            ttn_device_id: resultItem.ttn_device_id || ttnDeviceId,
            status: resultItem.status,
            error: resultItem.error,
          };
          setResults(prev => [...prev, result]);

          if (resultItem.status === 'created') summary.created++;
          else if (resultItem.status === 'already_exists') summary.already_exists++;
          else summary.failed++;
        } else {
          throw new Error('Unexpected response format');
        }
      } catch (err: any) {
        const result: ProvisionResult = {
          dev_eui: device.devEui,
          name: device.name,
          ttn_device_id: ttnDeviceId,
          status: 'failed',
          error: err.message || 'Unknown error',
        };
        setResults(prev => [...prev, result]);
        summary.failed++;
      }

      // Small delay to avoid rate limiting
      if (i < devices.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setProgress(100);
    setCurrentDevice(null);
    setIsExecuting(false);
    setSummary(summary);
  };

  const getStatusIcon = (status: ProvisionResult['status']) => {
    switch (status) {
      case 'created':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'already_exists':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: ProvisionResult['status']) => {
    switch (status) {
      case 'created':
        return <Badge className="bg-green-600">Created</Badge>;
      case 'already_exists':
        return <Badge variant="outline" className="text-amber-600 border-amber-600/30">Exists</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress section */}
      {!hasStarted ? (
        <div className="text-center py-8 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
            <Play className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="font-medium">Ready to Provision</p>
            <p className="text-sm text-muted-foreground">
              {devices.length} device(s) will be registered in TTN
            </p>
          </div>
          <Button onClick={startProvisioning} className="gap-2">
            <Play className="h-4 w-4" />
            Start Provisioning
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isExecuting ? (
                  <>Registering: {currentDevice}</>
                ) : (
                  <>Provisioning complete</>
                )}
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {results.length} of {devices.length} devices processed
            </p>
          </div>

          {/* Results list */}
          <ScrollArea className="h-[200px] border rounded-lg">
            <div className="p-2 space-y-2">
              {results.map((result, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(result.status)}
                    <div>
                      <p className="text-sm font-medium">{result.name}</p>
                      <code className="text-xs text-muted-foreground">
                        {result.ttn_device_id}
                      </code>
                    </div>
                  </div>
                  <div className="text-right">
                    {getStatusBadge(result.status)}
                    {result.error && (
                      <p className="text-xs text-destructive mt-1 max-w-[200px] truncate">
                        {result.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              
              {isExecuting && currentDevice && (
                <div className="flex items-center gap-3 p-2 rounded bg-muted/50 animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{currentDevice}</p>
                    <p className="text-xs text-muted-foreground">Registering...</p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
