import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Play } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId } from '@/lib/ttn-payload';
import { ProvisionResult, ProvisioningSummary, ProvisioningMode } from '../TTNProvisioningWizard';

interface StepExecutionProps {
  devices: LoRaWANDevice[];
  gateways?: GatewayConfig[];
  ttnConfig?: TTNConfig;
  orgId?: string;
  isExecuting: boolean;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  progress: number;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  results: ProvisionResult[];
  setResults: React.Dispatch<React.SetStateAction<ProvisionResult[]>>;
  setSummary: React.Dispatch<React.SetStateAction<ProvisioningSummary>>;
  mode?: ProvisioningMode;
}

export default function StepExecution({
  devices,
  gateways = [],
  ttnConfig,
  orgId,
  isExecuting,
  setIsExecuting,
  progress,
  setProgress,
  results,
  setResults,
  setSummary,
  mode = 'devices',
}: StepExecutionProps) {
  const [currentItem, setCurrentItem] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const isGatewayMode = mode === 'gateways';
  const items = isGatewayMode ? gateways : devices;
  const entityLabel = isGatewayMode ? 'gateway' : 'device';
  const entityLabelPlural = isGatewayMode ? 'gateways' : 'devices';

  const startDeviceProvisioning = async () => {
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
      setCurrentItem(device.name);
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
    setCurrentItem(null);
    setIsExecuting(false);
    setSummary(summary);
  };

  const startGatewayProvisioning = async () => {
    setIsExecuting(true);
    setHasStarted(true);
    setResults([]);
    setProgress(0);

    const summary: ProvisioningSummary = {
      created: 0,
      already_exists: 0,
      failed: 0,
      total: gateways.length,
    };

    setProgress(10); // Show initial progress

    try {
      // Call the batch gateway registration endpoint
      const { data, error } = await supabase.functions.invoke('ttn-batch-register-gateways', {
        body: {
          org_id: orgId,
          gateways: gateways.map(g => ({
            eui: g.eui,
            name: g.name,
            is_online: g.isOnline,
          })),
        },
      });

      if (error) throw error;

      setProgress(80);

      // Process results
      if (data?.results) {
        for (const resultItem of data.results) {
          const gateway = gateways.find(g => g.eui.toLowerCase().replace(/[^a-f0-9]/gi, '') === resultItem.eui?.toLowerCase());
          const result: ProvisionResult = {
            eui: resultItem.eui,
            name: gateway?.name || resultItem.eui,
            ttn_gateway_id: resultItem.ttn_gateway_id,
            status: resultItem.status,
            error: resultItem.error,
          };
          setResults(prev => [...prev, result]);

          if (resultItem.status === 'created') summary.created++;
          else if (resultItem.status === 'already_exists') summary.already_exists++;
          else summary.failed++;
        }
      }

      // Use summary from response if available
      if (data?.summary) {
        summary.created = data.summary.created || 0;
        summary.already_exists = data.summary.already_exists || 0;
        summary.failed = data.summary.failed || 0;
      }
    } catch (err: any) {
      console.error('Gateway batch provision error:', err);
      // Mark all gateways as failed
      for (const gateway of gateways) {
        let ttnGatewayId: string;
        try {
          ttnGatewayId = generateTTNGatewayId(gateway.eui);
        } catch {
          ttnGatewayId = 'invalid';
        }
        const result: ProvisionResult = {
          eui: gateway.eui,
          name: gateway.name,
          ttn_gateway_id: ttnGatewayId,
          status: 'failed',
          error: err.message || 'Batch registration failed',
        };
        setResults(prev => [...prev, result]);
        summary.failed++;
      }
    }

    setProgress(100);
    setCurrentItem(null);
    setIsExecuting(false);
    setSummary(summary);
  };

  const startProvisioning = async () => {
    if (isGatewayMode) {
      await startGatewayProvisioning();
    } else {
      await startDeviceProvisioning();
    }
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

  const getDisplayId = (result: ProvisionResult) => {
    return isGatewayMode ? result.ttn_gateway_id : result.ttn_device_id;
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
              {items.length} {entityLabel}(s) will be registered in TTN
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
                  <>Registering{currentItem ? `: ${currentItem}` : '...'}</>
                ) : (
                  <>Provisioning complete</>
                )}
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {results.length} of {items.length} {entityLabelPlural} processed
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
                        {getDisplayId(result)}
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
              
              {isExecuting && currentItem && (
                <div className="flex items-center gap-3 p-2 rounded bg-muted/50 animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{currentItem}</p>
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
