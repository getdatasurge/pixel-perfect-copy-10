import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Play, RefreshCw, AlertTriangle, Settings, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId } from '@/lib/ttn-payload';
import { ProvisionResult, ProvisioningSummary, ProvisioningMode } from '../TTNProvisioningWizard';
import { debug, log } from '@/lib/debugLogger';
import { logProvisioningEvent } from '@/lib/supportSnapshot';

interface PermissionError {
  type: string;
  message: string;
  permissions?: { gateway_read: boolean; gateway_write: boolean };
  hint?: string;
  diagnostics?: Record<string, unknown>;
}

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
  onOpenSettings?: () => void;
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
  onOpenSettings,
}: StepExecutionProps) {
  const [currentItem, setCurrentItem] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [retryingItem, setRetryingItem] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<PermissionError | null>(null);
  const [isValidatingPermissions, setIsValidatingPermissions] = useState(false);
  
  const isGatewayMode = mode === 'gateways';
  const items = isGatewayMode ? gateways : devices;
  const entityLabel = isGatewayMode ? 'gateway' : 'device';
  const entityLabelPlural = isGatewayMode ? 'gateways' : 'devices';
  const cluster = ttnConfig?.cluster || 'eu1';

  // Validate gateway permissions before provisioning
  const validateGatewayPermissions = async (): Promise<boolean> => {
    if (!isGatewayMode) return true;
    
    setIsValidatingPermissions(true);
    setPermissionError(null);
    
    debug.provisioning('Pre-validating gateway permissions before execution', {
      org_id: orgId,
      cluster,
    });

    try {
      const { data: permCheck, error: permError } = await supabase.functions.invoke('manage-ttn-settings', {
        body: { action: 'check_gateway_permissions', org_id: orgId }
      });

      if (permError) {
        log('provisioning', 'error', 'Permission validation failed with error', {
          error: permError.message,
        });
        throw new Error(permError.message);
      }

      debug.provisioning('Permission pre-check result', {
        status: permCheck?.ok ? 'passed' : 'failed',
        permissions: permCheck?.permissions,
        diagnostics: permCheck?.diagnostics,
      });

      if (!permCheck?.ok) {
        const errorInfo: PermissionError = {
          type: 'PERMISSION_MISSING',
          message: permCheck?.error || 'Gateway permissions validation failed',
          permissions: permCheck?.permissions,
          hint: permCheck?.hint,
          diagnostics: permCheck?.diagnostics,
        };
        setPermissionError(errorInfo);
        log('provisioning', 'error', 'Permission pre-check failed', errorInfo as unknown as Record<string, unknown>);
        return false;
      }

      return true;
    } catch (err: any) {
      const errorInfo: PermissionError = {
        type: 'VALIDATION_ERROR',
        message: err.message || 'Failed to validate permissions',
        hint: 'Check your network connection and try again',
      };
      setPermissionError(errorInfo);
      log('provisioning', 'error', 'Permission validation exception', { error: err.message });
      return false;
    } finally {
      setIsValidatingPermissions(false);
    }
  };

  // Handle re-validate and retry flow
  const handleRevalidateAndRetry = async () => {
    const permissionsOk = await validateGatewayPermissions();
    if (permissionsOk) {
      await startProvisioning();
    }
  };

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
    // Pre-validate permissions before starting
    const permissionsOk = await validateGatewayPermissions();
    if (!permissionsOk) {
      return;
    }

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

          // Categorize log based on error type
          const logLevel = resultItem.status === 'failed' ? 'error' : 'info';
          const logCategory = resultItem.error_code === 'PERMISSION_MISSING' 
            ? 'Permission Error' 
            : resultItem.status === 'failed' 
            ? 'Provisioning Error' 
            : 'Provisioning Success';
          
          log('provisioning', logLevel, `Gateway ${gateway.name}: ${logCategory}`, {
            eui: gateway.eui,
            ttn_gateway_id: resultItem.ttn_gateway_id,
            status: resultItem.status,
            error: resultItem.error,
            error_code: resultItem.error_code,
            attempts: resultItem.attempts,
            duration_ms: durationMs,
            request_id: data.requestId,
          });

          if (resultItem.status === 'created') summary.created++;
          else if (resultItem.status === 'already_exists') summary.already_exists++;
          else {
            summary.failed++;
            if (resultItem.error) allErrors.push(resultItem.error);
            
            // Check if this is a permission error and surface it
            if (resultItem.error_code === 'PERMISSION_MISSING' || resultItem.error_code === 'AUTH_FORBIDDEN') {
              setPermissionError({
                type: resultItem.error_code,
                message: resultItem.error || 'API key lacks gateway permissions',
                permissions: { gateway_read: false, gateway_write: false },
                hint: 'Update your API key with gateway permissions in TTN Console',
              });
            }
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
    setPermissionError(null);
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

  const ttnConsoleUrl = `https://${cluster}.cloud.thethings.network/console`;

  return (
    <div className="space-y-4">
      {/* Permission error remediation panel */}
      {permissionError && !isExecuting && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Missing TTN Gateway Permissions</AlertTitle>
          <AlertDescription>
            <div className="space-y-3 mt-2">
              <p>{permissionError.message}</p>
              
              {/* Permission status badges */}
              {permissionError.permissions && (
                <div className="flex gap-2">
                  <Badge variant={permissionError.permissions.gateway_read ? 'outline' : 'destructive'}>
                    gateways:read {permissionError.permissions.gateway_read ? '✓' : '✗'}
                  </Badge>
                  <Badge variant={permissionError.permissions.gateway_write ? 'outline' : 'destructive'}>
                    gateways:write {permissionError.permissions.gateway_write ? '✗' : '✗'}
                  </Badge>
                </div>
              )}
              
              {/* Step-by-step fix instructions */}
              <div className="text-sm bg-muted/50 p-3 rounded-md space-y-2">
                <p className="font-medium">How to fix this:</p>
                <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                  <li>
                    Open{' '}
                    <a 
                      href={ttnConsoleUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="underline inline-flex items-center gap-1"
                    >
                      TTN Console <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                  <li>Go to <strong>User settings → API keys</strong> or <strong>Organization → API keys</strong></li>
                  <li>Create a new API key with these permissions:
                    <ul className="list-disc ml-4 mt-1">
                      <li><code className="text-xs bg-muted px-1 rounded">gateways:read</code> - List and view gateways</li>
                      <li><code className="text-xs bg-muted px-1 rounded">gateways:write</code> - Register new gateways</li>
                    </ul>
                  </li>
                  <li>Copy the new API key</li>
                  <li>Update the API key in <strong>Webhook Settings → TTN Configuration</strong></li>
                  <li>Click <strong>Re-validate & Retry</strong> below</li>
                </ol>
              </div>
              
              {/* Collapsible technical details */}
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground underline cursor-pointer">
                  View technical details
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-32">
                  {JSON.stringify(permissionError, null, 2)}
                </CollapsibleContent>
              </Collapsible>
              
              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                {onOpenSettings && (
                  <Button variant="outline" size="sm" onClick={onOpenSettings}>
                    <Settings className="h-3 w-3 mr-1" />
                    Open Settings
                  </Button>
                )}
                <Button 
                  size="sm" 
                  onClick={handleRevalidateAndRetry}
                  disabled={isValidatingPermissions}
                >
                  {isValidatingPermissions ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Re-validate & Retry
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Progress section */}
      {!hasStarted && !permissionError ? (
        <div className="text-center py-8 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
            <Play className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="font-medium">Ready to Provision</p>
            <p className="text-sm text-muted-foreground">
              {items.length} {entityLabel}(s) will be registered in TTN
            </p>
            {isGatewayMode && (
              <p className="text-xs text-muted-foreground mt-1">
                Gateway permissions will be validated before provisioning
              </p>
            )}
          </div>
          <Button 
            onClick={startProvisioning} 
            className="gap-2"
            disabled={isValidatingPermissions}
          >
            {isValidatingPermissions ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating Permissions...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Start Provisioning
              </>
            )}
          </Button>
        </div>
      ) : hasStarted && (
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
