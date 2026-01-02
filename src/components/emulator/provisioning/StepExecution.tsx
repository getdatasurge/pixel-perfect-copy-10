import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Play, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId } from '@/lib/ttn-payload';
import { ProvisionResult, ProvisioningSummary, ProvisioningMode } from '../TTNProvisioningWizard';
import { debug, log } from '@/lib/debugLogger';
import { logProvisioningEvent } from '@/lib/supportSnapshot';

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
  const [retryingItem, setRetryingItem] = useState<string | null>(null);
  
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
          error_code: 'INVALID_EUI',
          retryable: false,
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
            error_code: resultItem.error_code,
            retryable: resultItem.retryable ?? true,
            attempts: resultItem.attempts,
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
          error_code: 'NETWORK_ERROR',
          retryable: true,
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

    // Log provisioning start to debug panel
    debug.provisioning('Starting gateway provisioning', {
      gateway_count: gateways.length,
      org_id: orgId,
      cluster: ttnConfig?.cluster,
      application_id: ttnConfig?.applicationId,
    });

    const allErrors: string[] = [];

    // Process gateways one by one for granular progress
    for (let i = 0; i < gateways.length; i++) {
      const gateway = gateways[i];
      setCurrentItem(gateway.name);
      setProgress(Math.round((i / gateways.length) * 100));

      let ttnGatewayId: string;
      try {
        ttnGatewayId = generateTTNGatewayId(gateway.eui);
      } catch {
        ttnGatewayId = 'invalid';
      }

      // Log individual gateway attempt
      debug.provisioning(`Provisioning gateway: ${gateway.name}`, {
        eui: gateway.eui,
        ttn_gateway_id: ttnGatewayId,
        cluster: ttnConfig?.cluster,
      });

      try {
        const startTime = performance.now();
        
        // Call batch endpoint with single gateway for better error handling
        const { data, error } = await supabase.functions.invoke('ttn-batch-register-gateways', {
          body: {
            org_id: orgId,
            gateways: [{
              eui: gateway.eui,
              name: gateway.name,
              is_online: gateway.isOnline,
            }],
          },
        });

        const durationMs = Math.round(performance.now() - startTime);

        if (error) {
          log('provisioning', 'error', `Gateway ${gateway.name} failed: ${error.message}`, {
            eui: gateway.eui,
            error: error.message,
            duration_ms: durationMs,
          });
          throw error;
        }

        if (data?.results?.[0]) {
          const resultItem = data.results[0];
          const result: ProvisionResult = {
            eui: gateway.eui,
            name: gateway.name,
            ttn_gateway_id: resultItem.ttn_gateway_id,
            status: resultItem.status,
            error: resultItem.error,
            error_code: resultItem.error_code,
            retryable: resultItem.retryable,
            attempts: resultItem.attempts,
          };
          setResults(prev => [...prev, result]);

          // Log result to debug panel
          log('provisioning', resultItem.status === 'failed' ? 'error' : 'info',
            `Gateway ${gateway.name}: ${resultItem.status}`, {
              eui: gateway.eui,
              ttn_gateway_id: resultItem.ttn_gateway_id,
              status: resultItem.status,
              error: resultItem.error,
              attempts: resultItem.attempts,
              duration_ms: durationMs,
              request_id: data.requestId,
            }
          );

          if (resultItem.status === 'created') summary.created++;
          else if (resultItem.status === 'already_exists') summary.already_exists++;
          else {
            summary.failed++;
            if (resultItem.error) allErrors.push(resultItem.error);
          }
        } else {
          throw new Error('Unexpected response format');
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Network error';
        allErrors.push(errorMsg);
        
        log('provisioning', 'error', `Gateway ${gateway.name} exception: ${errorMsg}`, {
          eui: gateway.eui,
          error: errorMsg,
        });

        const result: ProvisionResult = {
          eui: gateway.eui,
          name: gateway.name,
          ttn_gateway_id: ttnGatewayId,
          status: 'failed',
          error: errorMsg,
          error_code: 'NETWORK_ERROR',
          retryable: true,
        };
        setResults(prev => [...prev, result]);
        summary.failed++;
      }

      // Delay between gateways
      if (i < gateways.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setProgress(100);
    setCurrentItem(null);
    setIsExecuting(false);
    setSummary(summary);

    // Log final summary to debug panel and history
    debug.provisioning('Gateway provisioning complete', {
      created: summary.created,
      already_exists: summary.already_exists,
      failed: summary.failed,
      total: summary.total,
    });

    logProvisioningEvent({
      timestamp: new Date().toISOString(),
      entity_type: 'gateway',
      attempted: summary.total,
      created: summary.created,
      exists: summary.already_exists,
      failed: summary.failed,
      errors: allErrors,
    });
  };

  const retryGateway = async (failedResult: ProvisionResult) => {
    const gateway = gateways.find(g => g.eui === failedResult.eui);
    if (!gateway) return;

    setRetryingItem(gateway.eui);

    try {
      const { data, error } = await supabase.functions.invoke('ttn-batch-register-gateways', {
        body: {
          org_id: orgId,
          gateways: [{
            eui: gateway.eui,
            name: gateway.name,
            is_online: gateway.isOnline,
          }],
        },
      });

      if (error) throw error;

      if (data?.results?.[0]) {
        const resultItem = data.results[0];
        // Update the result in place
        setResults(prev => prev.map(r => 
          r.eui === gateway.eui 
            ? { 
                ...r, 
                status: resultItem.status, 
                error: resultItem.error, 
                error_code: resultItem.error_code,
                retryable: resultItem.retryable,
                attempts: (r.attempts || 0) + (resultItem.attempts || 1),
              }
            : r
        ));
        
        // Update summary if status changed
        if (resultItem.status !== 'failed') {
          setSummary(prev => ({
            ...prev,
            failed: prev.failed - 1,
            [resultItem.status === 'created' ? 'created' : 'already_exists']: 
              prev[resultItem.status === 'created' ? 'created' : 'already_exists'] + 1,
          }));
        }
      }
    } catch (err: any) {
      // Update with new error
      setResults(prev => prev.map(r => 
        r.eui === gateway.eui 
          ? { ...r, error: err.message, retryable: true, attempts: (r.attempts || 0) + 1 }
          : r
      ));
    } finally {
      setRetryingItem(null);
    }
  };

  const retryDevice = async (failedResult: ProvisionResult) => {
    const device = devices.find(d => d.devEui === failedResult.dev_eui);
    if (!device) return;

    setRetryingItem(device.devEui);

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
        setResults(prev => prev.map(r => 
          r.dev_eui === device.devEui 
            ? { 
                ...r, 
                status: resultItem.status, 
                error: resultItem.error, 
                error_code: resultItem.error_code,
                retryable: resultItem.retryable ?? true,
                attempts: (r.attempts || 0) + (resultItem.attempts || 1),
              }
            : r
        ));
        
        if (resultItem.status !== 'failed') {
          setSummary(prev => ({
            ...prev,
            failed: prev.failed - 1,
            [resultItem.status === 'created' ? 'created' : 'already_exists']: 
              prev[resultItem.status === 'created' ? 'created' : 'already_exists'] + 1,
          }));
        }
      }
    } catch (err: any) {
      setResults(prev => prev.map(r => 
        r.dev_eui === device.devEui 
          ? { ...r, error: err.message, retryable: true, attempts: (r.attempts || 0) + 1 }
          : r
      ));
    } finally {
      setRetryingItem(null);
    }
  };

  const handleRetryItem = (result: ProvisionResult) => {
    if (isGatewayMode) {
      retryGateway(result);
    } else {
      retryDevice(result);
    }
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

  const getItemKey = (result: ProvisionResult) => {
    return isGatewayMode ? result.eui : result.dev_eui;
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
              {results.map((result, index) => {
                const itemKey = getItemKey(result);
                const isRetrying = retryingItem === itemKey;
                
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 rounded bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      {isRetrying ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        getStatusIcon(result.status)
                      )}
                      <div>
                        <p className="text-sm font-medium">{result.name}</p>
                        <code className="text-xs text-muted-foreground">
                          {getDisplayId(result)}
                        </code>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.status === 'failed' && result.retryable && !isExecuting && !isRetrying && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetryItem(result)}
                          className="h-7 px-2 text-xs gap-1"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </Button>
                      )}
                      <div className="text-right">
                        {getStatusBadge(result.status)}
                        {result.error && (
                          <p className="text-xs text-destructive mt-1 max-w-[150px] truncate" title={result.error}>
                            {result.error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              
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
