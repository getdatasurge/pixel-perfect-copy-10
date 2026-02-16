import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Upload, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  Loader2, Clock, Wifi, WifiOff, Send, ArrowUpFromLine,
  Download, ChevronDown, ArrowUp,
} from 'lucide-react';
import { GatewayConfig, LoRaWANDevice, WebhookConfig } from '@/lib/ttn-payload';
import { SensorState } from '@/lib/emulatorSensorState';
import {
  syncDevicesToFreshTrack,
  sendReadingsToFreshTrack,
  testFreshTrackConnection,
  pullOrgState,
  ExportSyncResult,
  ExportReadingsResult,
  OrgStateResult,
} from '@/lib/freshtrackExport';
import { loadExportConfig, saveExportConfig, ExportConfig } from '@/lib/exportConfigStore';
import { toast } from '@/hooks/use-toast';

interface ExportPanelProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  sensorStates: Record<string, SensorState>;
  webhookConfig: WebhookConfig;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'sync' | 'readings' | 'connection' | 'error' | 'pull';
  message: string;
  status: 'success' | 'warning' | 'error';
}

interface ReadingFeedEntry {
  id: string;
  timestamp: Date;
  unitId: string;
  unitName?: string;
  temperature: number;
  temperatureUnit: string;
  humidity?: number;
  batteryLevel?: number;
  signalStrength?: number;
  doorOpen?: boolean;
}

const AUTO_SYNC_INTERVALS = [
  { value: '15', label: '15s' },
  { value: '60', label: '1 min' },
  { value: '120', label: '2 min' },
  { value: '300', label: '5 min' },
  { value: '900', label: '15 min' },
];

export default function ExportPanel({ devices, gateways, sensorStates, webhookConfig }: ExportPanelProps) {
  const [config, setConfig] = useState<ExportConfig>(loadExportConfig);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'testing' | 'connected' | 'failed'>('unknown');
  const [connectionInfo, setConnectionInfo] = useState<{ orgName?: string; syncVersion?: number }>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSendingReadings, setIsSendingReadings] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [exportLog, setExportLog] = useState<LogEntry[]>([]);
  const [nextSyncIn, setNextSyncIn] = useState<number | null>(null);
  const [orgState, setOrgState] = useState<OrgStateResult | null>(null);
  const [orgStateOpen, setOrgStateOpen] = useState(false);
  const [readingFeed, setReadingFeed] = useState<ReadingFeedEntry[]>([]);
  const autoSyncRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const orgId = webhookConfig.testOrgId;

  useEffect(() => { saveExportConfig(config); }, [config]);

  const addLog = useCallback((type: LogEntry['type'], message: string, status: LogEntry['status']) => {
    setExportLog(prev => [{
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type, message, status,
    }, ...prev].slice(0, 50));
  }, []);

  // Test connection
  const handleTestConnection = useCallback(async () => {
    if (!orgId) {
      toast({ title: 'No Org Selected', description: 'Set Organization ID in Testing tab first.', variant: 'destructive' });
      return;
    }
    setConnectionStatus('testing');
    const result = await testFreshTrackConnection(orgId);
    if (result.ok) {
      setConnectionStatus('connected');
      setConnectionInfo({ orgName: result.orgName, syncVersion: result.syncVersion });
      addLog('connection', `Connected to FreshTrack: ${result.orgName || orgId.slice(0, 8)}`, 'success');
    } else {
      setConnectionStatus('failed');
      addLog('connection', `Connection failed: ${result.error}`, 'error');
      toast({ title: 'Connection Failed', description: result.hint || result.error, variant: 'destructive' });
    }
  }, [orgId, addLog]);

  useEffect(() => {
    if (orgId && connectionStatus === 'unknown') handleTestConnection();
  }, [orgId]);

  // Pull org state
  const handlePullState = useCallback(async () => {
    if (!orgId) return;
    setIsPulling(true);
    const result = await pullOrgState(orgId);
    if (result.ok) {
      setOrgState(result);
      addLog('pull', `Pulled state: ${result.sites?.length ?? 0} sites, ${result.units?.length ?? 0} units, ${result.sensors?.length ?? 0} sensors, ${result.gateways?.length ?? 0} gateways`, 'success');
      toast({ title: 'State Pulled', description: `${result.units?.length ?? 0} units, ${result.sensors?.length ?? 0} sensors` });
    } else {
      addLog('pull', `Pull failed: ${result.error}`, 'error');
      toast({ title: 'Pull Failed', description: result.error, variant: 'destructive' });
    }
    setIsPulling(false);
  }, [orgId, addLog]);

  // Sync devices
  const handleSyncDevices = useCallback(async () => {
    setIsSyncing(true);
    const result: ExportSyncResult = await syncDevicesToFreshTrack(devices, gateways, sensorStates, webhookConfig);
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
  }, [devices, gateways, sensorStates, webhookConfig, addLog]);

  // Send readings
  const handleSendReadings = useCallback(async () => {
    setIsSendingReadings(true);
    const result: ExportReadingsResult = await sendReadingsToFreshTrack(devices, sensorStates, webhookConfig);

    // Populate live feed from sent readings
    if (result.sentReadings) {
      const unitMap = new Map<string, string>();
      if (orgState?.units) {
        orgState.units.forEach(u => unitMap.set(u.id, u.name));
      }
      const feedEntries: ReadingFeedEntry[] = result.sentReadings.map(r => ({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        unitId: r.unit_id as string,
        unitName: unitMap.get(r.unit_id as string),
        temperature: r.temperature as number,
        temperatureUnit: (r.temperature_unit as string) || 'F',
        humidity: r.humidity as number | undefined,
        batteryLevel: r.battery_level as number | undefined,
        signalStrength: r.signal_strength as number | undefined,
        doorOpen: r.door_open as boolean | undefined,
      }));
      setReadingFeed(prev => [...feedEntries, ...prev].slice(0, 50));
    }

    if (result.success) {
      setConfig(prev => ({
        ...prev,
        lastReadingsSentAt: new Date().toISOString(),
        lastReadingsStatus: (result.failed ?? 0) > 0 ? 'partial' : 'success',
        lastReadingsIngested: result.ingested ?? 0,
        lastReadingsFailed: result.failed ?? 0,
      }));
      addLog('readings', `Sent ${result.ingested} readings (${result.failed} failed)`, (result.failed ?? 0) > 0 ? 'warning' : 'success');
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
  }, [devices, sensorStates, webhookConfig, orgState, addLog]);

  // Auto-sync
  useEffect(() => {
    if (autoSyncRef.current) { clearInterval(autoSyncRef.current); autoSyncRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    if (config.autoSyncEnabled && orgId) {
      const intervalMs = config.autoSyncIntervalSec * 1000;
      setNextSyncIn(config.autoSyncIntervalSec);

      countdownRef.current = setInterval(() => {
        setNextSyncIn(prev => (prev !== null && prev > 0 ? prev - 1 : config.autoSyncIntervalSec));
      }, 1000);

      autoSyncRef.current = setInterval(() => {
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
  }, [config.autoSyncEnabled, config.autoSyncIntervalSec, orgId]);

  const devicesWithUnit = devices.filter(d => d.unitId).length;

  return (
    <div className="space-y-6">
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
            <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={!orgId || connectionStatus === 'testing'}>
              {connectionStatus === 'testing' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Test
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!orgId ? (
            <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>No organization selected. Set Org ID in the Testing tab.</AlertDescription></Alert>
          ) : connectionStatus === 'connected' ? (
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline" className="border-green-500/30 text-green-600">Connected</Badge>
              {connectionInfo.orgName && <span className="text-muted-foreground">Org: {connectionInfo.orgName}</span>}
              {connectionInfo.syncVersion && <span className="text-muted-foreground">v{connectionInfo.syncVersion}</span>}
            </div>
          ) : connectionStatus === 'failed' ? (
            <Badge variant="destructive">Connection Failed</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Click Test to verify connection</span>
          )}
        </CardContent>
      </Card>

      {/* Pull State */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              Pull Org State
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handlePullState} disabled={!orgId || isPulling}>
              {isPulling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
              Pull
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {orgState?.ok ? (
            <Collapsible open={orgStateOpen} onOpenChange={setOrgStateOpen}>
              <div className="flex items-center gap-4 text-sm mb-2">
                <Badge variant="outline">{orgState.sites?.length ?? 0} Sites</Badge>
                <Badge variant="outline">{orgState.units?.length ?? 0} Units</Badge>
                <Badge variant="outline">{orgState.sensors?.length ?? 0} Sensors</Badge>
                <Badge variant="outline">{orgState.gateways?.length ?? 0} Gateways</Badge>
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  <ChevronDown className={`h-3 w-3 transition-transform ${orgStateOpen ? 'rotate-180' : ''}`} />
                  {orgStateOpen ? 'Hide' : 'Show'} details
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-40 mt-2">
                  <div className="space-y-2 text-xs font-mono">
                    {orgState.units?.map(u => (
                      <div key={u.id} className="flex items-center gap-2 py-0.5 border-b border-border/30">
                        <span className="text-muted-foreground w-20 truncate">{u.id.slice(0, 8)}</span>
                        <span className="font-medium">{u.name}</span>
                        <Badge variant="outline" className="text-[10px]">{u.unit_type}</Badge>
                        <Badge variant={u.status === 'ok' ? 'outline' : 'secondary'} className="text-[10px]">{u.status}</Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="text-sm text-muted-foreground">Pull org state to see available sites, units, and sensors.</p>
          )}
        </CardContent>
      </Card>

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
          <Button onClick={handleSyncDevices} disabled={isSyncing || !orgId || devices.length === 0} className="w-full">
            {isSyncing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Syncing...</> : <><ArrowUpFromLine className="h-4 w-4 mr-2" /> Sync Devices & Sensors</>}
          </Button>
          {config.lastSyncCounts && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(['gateways', 'devices', 'sensors'] as const).map(key => (
                <div key={key} className="bg-muted rounded p-2 text-center">
                  <div className="font-medium capitalize">{key}</div>
                  <div className="text-muted-foreground">{config.lastSyncCounts![key].created}c / {config.lastSyncCounts![key].updated}u</div>
                </div>
              ))}
            </div>
          )}
          {config.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(config.lastSyncAt).toLocaleString()} — <Badge variant={config.lastSyncStatus === 'success' ? 'outline' : 'destructive'} className="text-xs">{config.lastSyncStatus}</Badge>
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
              <Select
                value={String(config.autoSyncIntervalSec)}
                onValueChange={v => setConfig(prev => ({ ...prev, autoSyncIntervalSec: Number(v) }))}
                disabled={!orgId || devicesWithUnit === 0}
              >
                <SelectTrigger className="w-20 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_SYNC_INTERVALS.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="auto-sync" className="text-xs text-muted-foreground">Auto</Label>
              <Switch
                id="auto-sync"
                checked={config.autoSyncEnabled}
                onCheckedChange={v => setConfig(prev => ({ ...prev, autoSyncEnabled: v }))}
                disabled={!orgId || devicesWithUnit === 0}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {devicesWithUnit} of {devices.length} device(s) have unit assignments and will send readings.
          </p>
          {devicesWithUnit === 0 && (
            <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>No devices have unit_id assignments. Assign devices to units in the Devices tab first.</AlertDescription></Alert>
          )}
          <Button onClick={handleSendReadings} disabled={isSendingReadings || !orgId || devicesWithUnit === 0} variant="secondary" className="w-full">
            {isSendingReadings ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</> : <><Send className="h-4 w-4 mr-2" /> Send Current Readings</>}
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

      {/* Live Reading Feed */}
      {readingFeed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowUp className="h-3 w-3" />
                Live Reading Feed
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setReadingFeed([])}>Clear</Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-36">
              <div className="space-y-1">
                {readingFeed.map(entry => (
                  <div key={entry.id} className="flex items-center gap-2 py-0.5 text-xs font-mono border-b border-border/30 last:border-0">
                    <ArrowUp className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground w-14 shrink-0">{entry.timestamp.toLocaleTimeString()}</span>
                    <span className="font-medium truncate max-w-[140px]">{entry.unitName || entry.unitId.slice(0, 8)}</span>
                    <span>{entry.temperature}°{entry.temperatureUnit}</span>
                    {entry.humidity != null && <span className="text-muted-foreground">{entry.humidity}%rh</span>}
                    {entry.batteryLevel != null && <span className="text-muted-foreground">bat:{entry.batteryLevel}%</span>}
                    {entry.signalStrength != null && <span className="text-muted-foreground">{entry.signalStrength}dBm</span>}
                    {entry.doorOpen != null && <Badge variant={entry.doorOpen ? 'destructive' : 'outline'} className="text-[10px]">{entry.doorOpen ? 'OPEN' : 'closed'}</Badge>}
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
                    <span className="text-muted-foreground font-mono w-16 shrink-0">{entry.timestamp.toLocaleTimeString()}</span>
                    {entry.status === 'success' ? <CheckCircle className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                      : entry.status === 'warning' ? <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
                      : <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />}
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
