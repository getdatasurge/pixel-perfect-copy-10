import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  Loader2, Clock, Wifi, WifiOff, Send, ArrowUpFromLine,
} from 'lucide-react';
import { GatewayConfig, LoRaWANDevice, WebhookConfig } from '@/lib/ttn-payload';
import { SensorState } from '@/lib/emulatorSensorState';
import {
  syncDevicesToFreshTrack,
  sendReadingsToFreshTrack,
  testFreshTrackConnection,
  ExportSyncResult,
  ExportReadingsResult,
} from '@/lib/freshtrackExport';
import { loadExportConfig, saveExportConfig, ExportConfig } from '@/lib/exportConfigStore';
import { getEffectiveConfig } from '@/lib/freshtrackConnectionStore';
import { toast } from '@/hooks/use-toast';
import ExportConnectionSettings from './ExportConnectionSettings';
import OrgStateViewer from './OrgStateViewer';

interface ExportPanelProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  sensorStates: Record<string, SensorState>;
  webhookConfig: WebhookConfig;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'sync' | 'readings' | 'connection' | 'error';
  message: string;
  status: 'success' | 'warning' | 'error';
}

interface ReadingFeedEntry {
  id: string;
  timestamp: Date;
  unitId: string;
  deviceName?: string;
  temperature?: number;
  humidity?: number;
  doorOpen?: boolean;
  battery?: number;
  signal?: number;
  status: 'sent' | 'failed';
}

export default function ExportPanel({ devices, gateways, sensorStates, webhookConfig }: ExportPanelProps) {
  const [config, setConfig] = useState<ExportConfig>(loadExportConfig);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'connected' | 'failed'>('unknown');
  const [connectionInfo, setConnectionInfo] = useState<{ orgName?: string; syncVersion?: number }>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSendingReadings, setIsSendingReadings] = useState(false);
  const [exportLog, setExportLog] = useState<LogEntry[]>([]);
  const [readingsFeed, setReadingsFeed] = useState<ReadingFeedEntry[]>([]);
  const [nextSyncIn, setNextSyncIn] = useState<number | null>(null);
  const autoSyncRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // Resolve org ID: prefer connection settings over webhook config
  const connectionConfig = getEffectiveConfig();
  const effectiveOrgId = connectionConfig.freshtrackOrgId || webhookConfig.testOrgId;

  // Persist config changes
  useEffect(() => {
    saveExportConfig(config);
  }, [config]);

  const addLog = useCallback((type: LogEntry['type'], message: string, status: LogEntry['status']) => {
    setExportLog(prev => [{
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      message,
      status,
    }, ...prev].slice(0, 50));
  }, []);

  const addReadingsFeed = useCallback((devicesList: LoRaWANDevice[], states: Record<string, SensorState>) => {
    const entries: ReadingFeedEntry[] = devicesList
      .filter(dev => dev.unitId)
      .map(dev => {
        const state = states[dev.id];
        if (!state) return null;
        return {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          unitId: dev.unitId!,
          deviceName: dev.name,
          temperature: state.type === 'temperature' ? state.tempF : undefined,
          humidity: state.type === 'temperature' ? Math.round(state.humidity) : undefined,
          doorOpen: state.type === 'door' ? state.doorOpen : undefined,
          battery: Math.round(state.batteryPct),
          signal: Math.round(state.signalStrength),
          status: 'sent' as const,
        };
      })
      .filter(Boolean) as ReadingFeedEntry[];

    setReadingsFeed(prev => [...entries, ...prev].slice(0, 200));
  }, []);

  // Test connection
  const handleTestConnection = useCallback(async () => {
    if (!effectiveOrgId) {
      toast({ title: 'No Org Selected', description: 'Set Organization ID in Export Settings or Testing tab.', variant: 'destructive' });
      return;
    }
    setConnectionStatus('testing');
    const result = await testFreshTrackConnection(effectiveOrgId);
    if (result.ok) {
      setConnectionStatus('connected');
      setConnectionInfo({ orgName: result.orgName, syncVersion: result.syncVersion });
      addLog('connection', `Connected to FreshTrack: ${result.orgName || effectiveOrgId.slice(0, 8)}`, 'success');
    } else {
      setConnectionStatus('failed');
      addLog('connection', `Connection failed: ${result.error}`, 'error');
      toast({ title: 'Connection Failed', description: result.hint || result.error, variant: 'destructive' });
    }
  }, [effectiveOrgId, addLog]);

  // Auto-test on mount if org is set
  useEffect(() => {
    if (effectiveOrgId && connectionStatus === 'unknown') {
      handleTestConnection();
    }
  }, [effectiveOrgId]);

  // Sync devices
  const handleSyncDevices = useCallback(async () => {
    setIsSyncing(true);
    const result: ExportSyncResult = await syncDevicesToFreshTrack(devices, gateways, sensorStates, webhookConfig, effectiveOrgId);

    if (result.success) {
      setConfig(prev => ({
        ...prev,
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: (result.errors?.length ?? 0) > 0 ? 'partial' : 'success',
        lastSyncCounts: result.counts || null,
      }));
      const c = result.counts;
      const summary = c
        ? `GW: ${c.gateways.created}c/${c.gateways.updated}u, Dev: ${c.devices.created}c/${c.devices.updated}u, Sensors: ${c.sensors.created}c/${c.sensors.updated}u`
        : 'Sync complete';
      addLog('sync', summary, (result.errors?.length ?? 0) > 0 ? 'warning' : 'success');
      toast({ title: 'Sync Complete', description: summary });
    } else {
      setConfig(prev => ({ ...prev, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'failed', lastSyncCounts: null }));
      const errorMsg = result.details
        ? result.details.map(d => `${d.path}: ${d.message}`).join('; ')
        : (result.error || 'Unknown error');
      addLog('sync', `Sync failed: ${errorMsg}`, 'error');
      toast({ title: 'Sync Failed', description: errorMsg, variant: 'destructive' });
    }
    setIsSyncing(false);
  }, [devices, gateways, sensorStates, webhookConfig, effectiveOrgId, addLog]);

  // Send readings
  const handleSendReadings = useCallback(async () => {
    setIsSendingReadings(true);
    const result: ExportReadingsResult = await sendReadingsToFreshTrack(devices, sensorStates, webhookConfig, effectiveOrgId);

    if (result.success) {
      setConfig(prev => ({
        ...prev,
        lastReadingsSentAt: new Date().toISOString(),
        lastReadingsStatus: (result.failed ?? 0) > 0 ? 'partial' : 'success',
        lastReadingsIngested: result.ingested ?? 0,
        lastReadingsFailed: result.failed ?? 0,
      }));
      addReadingsFeed(devices, sensorStates);
      addLog('readings', `Sent ${result.ingested} readings (${result.failed} failed)`, (result.failed ?? 0) > 0 ? 'warning' : 'success');
      toast({ title: 'Readings Sent', description: `${result.ingested} ingested, ${result.failed} failed` });
    } else {
      setConfig(prev => ({
        ...prev,
        lastReadingsSentAt: new Date().toISOString(),
        lastReadingsStatus: 'failed',
        lastReadingsIngested: 0,
        lastReadingsFailed: result.failed ?? 0,
      }));
      addLog('readings', `Send failed: ${result.error}`, 'error');
      toast({ title: 'Send Failed', description: result.error, variant: 'destructive' });
    }
    setIsSendingReadings(false);
  }, [devices, sensorStates, webhookConfig, effectiveOrgId, addLog, addReadingsFeed]);

  // Auto-sync
  useEffect(() => {
    if (autoSyncRef.current) {
      clearInterval(autoSyncRef.current);
      autoSyncRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (config.autoSyncEnabled && effectiveOrgId) {
      const intervalMs = config.autoSyncIntervalSec * 1000;
      setNextSyncIn(config.autoSyncIntervalSec);

      countdownRef.current = setInterval(() => {
        setNextSyncIn(prev => (prev !== null && prev > 0 ? prev - 1 : config.autoSyncIntervalSec));
      }, 1000);

      autoSyncRef.current = setInterval(() => {
        // Don't hammer if last sync failed
        if (config.lastReadingsStatus === 'failed') {
          addLog('readings', 'Auto-sync paused: last attempt failed', 'warning');
          return;
        }
        handleSendReadings();
        setNextSyncIn(config.autoSyncIntervalSec);
      }, intervalMs);
    } else {
      setNextSyncIn(null);
    }

    return () => {
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [config.autoSyncEnabled, config.autoSyncIntervalSec, effectiveOrgId]);

  const devicesWithUnit = devices.filter(d => d.unitId).length;

  return (
    <div className="space-y-6">
      {/* Connection Settings */}
      <ExportConnectionSettings
        onConfigChange={() => {
          // Re-test connection when settings change
          setConnectionStatus('unknown');
        }}
      />

      {/* Connection Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : connectionStatus === 'failed' ? (
                <WifiOff className="h-4 w-4 text-destructive" />
              ) : (
                <Wifi className="h-4 w-4 text-muted-foreground" />
              )}
              FreshTrack Pro Connection
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={!effectiveOrgId || connectionStatus === 'testing'}
            >
              {connectionStatus === 'testing' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Test
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!effectiveOrgId ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>No organization selected. Set Org ID in Export Settings or Testing tab.</AlertDescription>
            </Alert>
          ) : connectionStatus === 'connected' ? (
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline" className="border-green-500/30 text-green-600">Connected</Badge>
              {connectionInfo.orgName && <span className="text-muted-foreground">Org: {connectionInfo.orgName}</span>}
              {connectionInfo.syncVersion != null && <span className="text-muted-foreground">v{connectionInfo.syncVersion}</span>}
            </div>
          ) : connectionStatus === 'failed' ? (
            <Badge variant="destructive">Connection Failed</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Click Test to verify connection</span>
          )}
        </CardContent>
      </Card>

      {/* Organization State Viewer */}
      {effectiveOrgId && connectionStatus === 'connected' && (
        <OrgStateViewer orgId={effectiveOrgId} />
      )}

      {/* Sync Devices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Sync Devices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Push {gateways.length} gateway(s), {devices.length} device(s) to FreshTrack Pro.
          </p>
          <Button
            onClick={handleSyncDevices}
            disabled={isSyncing || !effectiveOrgId || devices.length === 0}
            className="w-full"
          >
            {isSyncing ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Syncing...</>
            ) : (
              <><ArrowUpFromLine className="h-4 w-4 mr-2" /> Sync Devices & Sensors</>
            )}
          </Button>
          {config.lastSyncCounts && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-muted rounded p-2 text-center">
                <div className="font-medium">Gateways</div>
                <div className="text-muted-foreground">
                  {config.lastSyncCounts.gateways.created}c / {config.lastSyncCounts.gateways.updated}u
                </div>
              </div>
              <div className="bg-muted rounded p-2 text-center">
                <div className="font-medium">Devices</div>
                <div className="text-muted-foreground">
                  {config.lastSyncCounts.devices.created}c / {config.lastSyncCounts.devices.updated}u
                </div>
              </div>
              <div className="bg-muted rounded p-2 text-center">
                <div className="font-medium">Sensors</div>
                <div className="text-muted-foreground">
                  {config.lastSyncCounts.sensors.created}c / {config.lastSyncCounts.sensors.updated}u
                </div>
              </div>
            </div>
          )}
          {config.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(config.lastSyncAt).toLocaleString()} — {' '}
              <Badge variant={config.lastSyncStatus === 'success' ? 'outline' : 'destructive'} className="text-xs">
                {config.lastSyncStatus}
              </Badge>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Send Readings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4" />
              Send Readings
            </CardTitle>
            <div className="flex items-center gap-2">
              {config.autoSyncEnabled && (
                <Select
                  value={String(config.autoSyncIntervalSec)}
                  onValueChange={v => setConfig(prev => ({ ...prev, autoSyncIntervalSec: Number(v) }))}
                >
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60">1 min</SelectItem>
                    <SelectItem value="120">2 min</SelectItem>
                    <SelectItem value="300">5 min</SelectItem>
                    <SelectItem value="600">10 min</SelectItem>
                    <SelectItem value="900">15 min</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Label htmlFor="auto-sync" className="text-xs text-muted-foreground">Auto-sync</Label>
              <Switch
                id="auto-sync"
                checked={config.autoSyncEnabled}
                onCheckedChange={v => setConfig(prev => ({ ...prev, autoSyncEnabled: v }))}
                disabled={!effectiveOrgId || devicesWithUnit === 0}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {devicesWithUnit} of {devices.length} device(s) have unit assignments and will send readings.
          </p>
          {devicesWithUnit === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No devices have unit_id assignments. Assign devices to units in the Devices tab first.
              </AlertDescription>
            </Alert>
          )}
          <Button
            onClick={handleSendReadings}
            disabled={isSendingReadings || !effectiveOrgId || devicesWithUnit === 0}
            variant="secondary"
            className="w-full"
          >
            {isSendingReadings ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Send Current Readings</>
            )}
          </Button>
          {config.autoSyncEnabled && nextSyncIn !== null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Next auto-sync in {nextSyncIn}s (every {config.autoSyncIntervalSec}s)
            </div>
          )}
          {config.lastReadingsSentAt && (
            <p className="text-xs text-muted-foreground">
              Last sent: {new Date(config.lastReadingsSentAt).toLocaleString()} — {config.lastReadingsIngested} ingested, {config.lastReadingsFailed} failed
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reading Stream */}
      {readingsFeed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Reading Stream</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setReadingsFeed([])}>Clear</Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {readingsFeed.map(entry => (
                  <div key={entry.id} className="flex items-start gap-2 py-1 text-xs border-b border-border/30 last:border-0">
                    <span className="text-muted-foreground font-mono w-16 shrink-0">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    <ArrowUpFromLine className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                    <span className="font-mono break-all">
                      {entry.deviceName || entry.unitId.slice(0, 8)}:
                      {entry.temperature !== undefined && ` ${entry.temperature}°F`}
                      {entry.humidity !== undefined && `, ${entry.humidity}% RH`}
                      {entry.doorOpen !== undefined && (entry.doorOpen ? ' OPEN' : ' CLOSED')}
                      {entry.battery !== undefined && `, bat ${entry.battery}%`}
                      {entry.signal !== undefined && `, ${entry.signal}dBm`}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Export Log */}
      {exportLog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Export Log</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setExportLog([])}>Clear</Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {exportLog.map(entry => (
                  <div key={entry.id} className="flex items-start gap-2 py-1 text-xs border-b border-border/30 last:border-0">
                    <span className="text-muted-foreground font-mono w-16 shrink-0">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    {entry.status === 'success' ? (
                      <CheckCircle className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                    ) : entry.status === 'warning' ? (
                      <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                    )}
                    <span className="font-mono break-all">{entry.message}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
