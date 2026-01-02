import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thermometer, Droplets, Battery, Signal, DoorOpen, DoorClosed, Clock, AlertTriangle, CheckCircle, XCircle, RefreshCw, Copy } from 'lucide-react';
import { useTelemetrySubscription } from '@/hooks/useTelemetrySubscription';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useState, useEffect, useCallback } from 'react';
import { debug } from '@/lib/debugLogger';

interface TelemetryMonitorProps {
  orgId?: string;
  unitId?: string;
  // Fallback to local state when no DB telemetry available
  localState?: {
    currentTemp: number | null;
    humidity: number;
    doorOpen: boolean;
    batteryLevel: number;
    signalStrength: number;
  };
}

interface PullError {
  message: string;
  error_code?: string;
  hint?: string;
  request_id?: string;
  diagnostics?: Record<string, unknown>;
}

export default function TelemetryMonitor({ orgId, unitId, localState }: TelemetryMonitorProps) {
  const { telemetry, loading, getSensorStatus, refetch } = useTelemetrySubscription({
    orgId,
    enabled: !!orgId, // Only enabled if we have an org_id
  });

  const [isPulling, setIsPulling] = useState(false);
  const [autoPullEnabled, setAutoPullEnabled] = useState(false);
  const [lastPullError, setLastPullError] = useState<PullError | null>(null);

  // Copy request_id to clipboard
  const copyRequestId = (requestId: string) => {
    navigator.clipboard.writeText(requestId);
    toast({ title: 'Copied', description: 'Request ID copied to clipboard' });
  };

  // Memoized pull function with proper dependencies
  const pullFromFrostGuard = useCallback(async (silent = false) => {
    if (!orgId) {
      if (!silent) {
        toast({
          title: 'Error',
          description: 'No organization ID selected',
          variant: 'destructive',
        });
      }
      return;
    }

    setIsPulling(true);
    setLastPullError(null);
    
    // Debug logging
    debug.network('FROSTGUARD_TELEMETRY_REQUEST', { orgId, unitId });
    console.log('[TelemetryMonitor] Pulling from FrostGuard...', { orgId, unitId });

    try {
      const { data, error } = await supabase.functions.invoke('pull-frostguard-telemetry', {
        body: {
          org_id: orgId,
          sync_to_local: true,
        },
      });

      console.log('[TelemetryMonitor] Response:', { data, error });

      // When Edge Function returns 200 with ok:false, error will be null and data will contain error details
      // When Edge Function crashes or returns non-2xx, error will be set
      if (error) {
        console.error('[TelemetryMonitor] Edge function error:', error);

        // Try to extract more details from the error
        // FunctionsHttpError has a context property that may contain the response
        let errorMessage = error.message || 'Edge function error';
        let errorContext: Record<string, unknown> | undefined;

        // Check if error has additional context (FunctionsHttpError type)
        if ('context' in error && error.context) {
          errorContext = error.context as Record<string, unknown>;
          console.error('[TelemetryMonitor] Error context:', errorContext);
        }

        // Check for specific error types
        if (errorMessage.includes('non-2xx')) {
          errorMessage = 'Edge Function returned an error. This usually means the function crashed or a required secret is missing. Check Supabase Edge Function logs.';
        } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('network')) {
          errorMessage = 'Network error connecting to Edge Function. Check your internet connection.';
        }

        const pullError: PullError = {
          message: errorMessage,
          error_code: 'EDGE_FUNCTION_ERROR',
          hint: 'Check Supabase Dashboard > Edge Functions > Logs for detailed error information. Most likely cause: FROSTGUARD_ANON_KEY secret is not configured.',
          request_id: data?.request_id,
          diagnostics: errorContext ? { error_context: errorContext } : undefined,
        };
        setLastPullError(pullError);
        debug.error('FROSTGUARD_TELEMETRY_ERROR', { ...pullError, originalError: error });
        throw error;
      }

      if (!data?.ok) {
        const pullError: PullError = {
          message: data?.error || 'Unknown error',
          error_code: data?.error_code,
          hint: data?.hint,
          request_id: data?.request_id,
          diagnostics: data?.diagnostics,
        };
        setLastPullError(pullError);
        debug.error('FROSTGUARD_TELEMETRY_ERROR', { ...pullError });
        console.error('[TelemetryMonitor] Pull error with diagnostics:', pullError);
        throw new Error(data?.error || 'Pull failed');
      }

      debug.network('FROSTGUARD_TELEMETRY_SUCCESS', {
        count: data?.count,
        request_id: data?.request_id,
        source: data?.source,
      });

      console.log(`[TelemetryMonitor] Successfully pulled ${data?.count || 0} records`);

      if (!silent) {
        toast({
          title: 'Success',
          description: `Pulled ${data?.count || 0} telemetry record(s) from FrostGuard`,
        });
      }

      // Refetch to get the latest data
      refetch();
    } catch (error) {
      console.error('[TelemetryMonitor] Error pulling from FrostGuard:', error);
      if (!silent) {
        toast({
          title: 'Telemetry Pull Failed',
          description: lastPullError?.hint || (error instanceof Error ? error.message : 'Failed to pull telemetry data'),
          variant: 'destructive',
        });
      }
    } finally {
      setIsPulling(false);
    }
  }, [orgId, unitId, refetch, lastPullError?.hint]);

  // Auto-pull from FrostGuard on mount and periodically
  useEffect(() => {
    if (!autoPullEnabled || !orgId) return;

    const pullData = async () => {
      try {
        await pullFromFrostGuard(true); // Silent pull (no toast)
      } catch (error) {
        console.error('Auto-pull error:', error);
      }
    };

    // Initial pull
    pullData();

    // Pull every 30 seconds
    const interval = setInterval(pullData, 30000);

    return () => clearInterval(interval);
  }, [orgId, autoPullEnabled, pullFromFrostGuard]);

  // Determine data source
  const useDbTelemetry = !!(telemetry && telemetry.last_uplink_at);

  // Calculate sensor status from telemetry
  const sensorStatus = telemetry
    ? getSensorStatus(
        telemetry.last_uplink_at,
        telemetry.expected_checkin_minutes,
        telemetry.warn_after_missed,
        telemetry.critical_after_missed
      )
    : 'unknown';

  const getStatusBadge = () => {
    switch (sensorStatus) {
      case 'online':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Online</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-500"><AlertTriangle className="h-3 w-3 mr-1" />Warning</Badge>;
      case 'offline':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Offline</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getDoorStatusIcon = () => {
    const isOpen = useDbTelemetry
      ? telemetry?.door_state === 'open'
      : localState?.doorOpen;

    return isOpen
      ? <DoorOpen className="h-6 w-6 text-orange-500" />
      : <DoorClosed className="h-6 w-6 text-green-500" />;
  };

  const getDoorStatusText = () => {
    if (useDbTelemetry) {
      return telemetry?.door_state === 'unknown'
        ? 'Unknown'
        : telemetry?.door_state?.toUpperCase();
    }
    return localState?.doorOpen ? 'OPEN' : 'CLOSED';
  };

  // Values from DB or fallback to local
  const tempValue = useDbTelemetry
    ? telemetry?.last_temp_f
    : localState?.currentTemp;

  const humidityValue = useDbTelemetry
    ? telemetry?.last_humidity
    : localState?.humidity;

  const batteryValue = useDbTelemetry
    ? telemetry?.battery_pct
    : localState?.batteryLevel;

  const signalValue = useDbTelemetry
    ? telemetry?.rssi_dbm
    : localState?.signalStrength;

  const lastUplinkText = telemetry?.last_uplink_at
    ? formatDistanceToNow(new Date(telemetry.last_uplink_at), { addSuffix: true })
    : 'Never';

  return (
    <div className="space-y-4">
      {/* Data Source Indicator */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Badge variant={useDbTelemetry ? "default" : "outline"}>
          {useDbTelemetry ? '📡 Live from Database' : '🔌 Local Emulator State'}
        </Badge>
        {useDbTelemetry && getStatusBadge()}
        {(orgId || unitId) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {orgId && <span className="font-mono">org: {orgId.slice(0, 8)}...</span>}
            {unitId && <span className="font-mono">unit: {unitId}</span>}
          </div>
        )}
      </div>

      {/* No Context Warning */}
      {!orgId && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="font-medium text-sm mb-1">No Organization Context Selected</p>
                <p className="text-xs text-muted-foreground">
                  Go to the <strong>Testing</strong> tab and select a user/organization context to pull telemetry data from FrostGuard.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pull from FrostGuard Controls */}
      {orgId && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => pullFromFrostGuard(false)}
              disabled={isPulling}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isPulling ? 'animate-spin' : ''}`} />
              {isPulling ? 'Pulling...' : 'Pull Telemetry'}
            </Button>
            <Badge variant={autoPullEnabled ? "default" : "secondary"} className="text-xs">
              Auto-pull: {autoPullEnabled ? 'ON (every 30s)' : 'OFF'}
            </Badge>
          </div>

          {/* Error display with actionable hints */}
          {lastPullError && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-destructive">
                      {lastPullError.error_code || 'Error'}: {lastPullError.message}
                    </p>
                    {lastPullError.hint && (
                      <p className="text-xs text-muted-foreground">{lastPullError.hint}</p>
                    )}
                  </div>
                </div>
                {lastPullError.request_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      Request: {lastPullError.request_id}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => copyRequestId(lastPullError.request_id!)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {/* Show diagnostics for debugging */}
                {lastPullError.diagnostics && (
                  <div className="text-xs text-muted-foreground font-mono bg-muted/50 p-2 rounded">
                    <div className="font-semibold mb-1">Diagnostics:</div>
                    {Object.entries(lastPullError.diagnostics).map(([key, value]) => (
                      <div key={key}>
                        {key}: {typeof value === 'boolean' ? (value ? '✓' : '✗') : String(value)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {loading && (
            <div className="text-xs text-muted-foreground">
              Loading telemetry from database...
            </div>
          )}
          {!loading && !useDbTelemetry && !lastPullError && (
            <div className="text-xs text-amber-600">
              No telemetry data found. Click "Pull Telemetry" to fetch from FrostGuard.
            </div>
          )}
          {!loading && useDbTelemetry && (
            <div className="text-xs text-green-600">
              ✓ Telemetry data loaded from database
            </div>
          )}
        </div>
      )}

      {/* Temperature & Humidity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Thermometer className="h-4 w-4" />
            Temperature & Humidity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold">
                {tempValue !== null && tempValue !== undefined
                  ? `${Number(tempValue).toFixed(1)}°F`
                  : '-- --'}
              </div>
              <div className="text-xs text-muted-foreground">Temperature</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold flex items-center justify-center gap-1">
                <Droplets className="h-5 w-5 text-blue-500" />
                {humidityValue !== null && humidityValue !== undefined
                  ? `${Number(humidityValue).toFixed(0)}%`
                  : '-- --'}
              </div>
              <div className="text-xs text-muted-foreground">Humidity</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Door Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {getDoorStatusIcon()}
            Door Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">
              {getDoorStatusText()}
            </div>
            {useDbTelemetry && telemetry?.last_door_event_at && (
              <div className="text-xs text-muted-foreground">
                Last event: {formatDistanceToNow(new Date(telemetry.last_door_event_at), { addSuffix: true })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Device Readiness */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Device Readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Battery */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Battery className={`h-4 w-4 ${(batteryValue ?? 0) < 20 ? 'text-red-500' : 'text-green-500'}`} />
              <span className="text-sm">Battery</span>
            </div>
            <span className="font-medium">
              {batteryValue !== null && batteryValue !== undefined
                ? `${Math.round(Number(batteryValue))}%`
                : '-- --'}
            </span>
          </div>

          {/* Signal Strength */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Signal className={`h-4 w-4 ${(signalValue ?? -100) < -80 ? 'text-yellow-500' : 'text-green-500'}`} />
              <span className="text-sm">Signal</span>
            </div>
            <span className="font-medium">
              {signalValue !== null && signalValue !== undefined
                ? `${Math.round(Number(signalValue))} dBm`
                : '-- --'}
            </span>
          </div>

          {/* SNR (only from DB) */}
          {useDbTelemetry && telemetry?.snr_db !== null && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Signal className="h-4 w-4 text-blue-500" />
                <span className="text-sm">SNR</span>
              </div>
              <span className="font-medium">{Number(telemetry.snr_db).toFixed(1)} dB</span>
            </div>
          )}

          {/* Last Heartbeat */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Last Heartbeat</span>
            </div>
            <span className="font-medium text-sm">{lastUplinkText}</span>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="text-center text-sm text-muted-foreground py-2">
          Loading telemetry...
        </div>
      )}
    </div>
  );
}
