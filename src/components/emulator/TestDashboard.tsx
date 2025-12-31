import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  CheckCircle2, XCircle, Clock, ArrowRight, 
  Radio, Webhook, Database, Building2, Trash2,
  Thermometer, DoorOpen, ChevronDown, Cloud, AlertTriangle
} from 'lucide-react';
import { TestResult, SyncResult } from '@/lib/ttn-payload';

interface TestDashboardProps {
  results: TestResult[];
  syncResults?: SyncResult[];
  onClearResults: () => void;
}

export default function TestDashboard({ results, syncResults = [], onClearResults }: TestDashboardProps) {
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [expandedSyncIds, setExpandedSyncIds] = useState<Set<string>>(new Set());

  const toggleSyncExpanded = (id: string) => {
    setExpandedSyncIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatSyncTime = (date: Date) => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday 
      ? date.toLocaleTimeString() 
      : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  
  // Get latest results for summary
  const latestResult = results[0];
  const latestSync = syncResults[0];

  // Calculate stats
  const stats = {
    total: results.length,
    ttnSuccess: results.filter(r => r.ttnStatus === 'success').length,
    webhookSuccess: results.filter(r => r.webhookStatus === 'success').length,
    dbSuccess: results.filter(r => r.dbStatus === 'inserted').length,
    orgApplied: results.filter(r => r.orgApplied).length,
  };

  // Sync stats
  const syncStats = syncResults.length > 0 ? {
    totalSyncs: syncResults.length,
    successful: syncResults.filter(r => r.status === 'success').length,
    partial: syncResults.filter(r => r.status === 'partial').length,
    failed: syncResults.filter(r => r.status === 'failed').length,
    totalGatewaysSynced: syncResults.reduce((sum, r) => sum + r.counts.gatewaysSynced, 0),
    totalDevicesSynced: syncResults.reduce((sum, r) => sum + r.counts.devicesSynced, 0),
  } : null;

  const StatusIcon = ({ status }: { status: 'success' | 'failed' | 'skipped' | 'pending' | 'inserted' }) => {
    switch (status) {
      case 'success':
      case 'inserted':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'skipped':
        return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const SyncStatusBadge = ({ status }: { status: SyncResult['status'] }) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/30">Success</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">Partial</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
    }
  };

  const MethodBadge = ({ method }: { method: SyncResult['method'] }) => {
    if (!method) return null;
    return (
      <Badge variant="outline" className="text-xs">
        {method === 'endpoint' ? 'via API' : 'direct writes'}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Test Results Dashboard</h3>
          <p className="text-sm text-muted-foreground">
            Real-time validation of the end-to-end data flow
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onClearResults}
          disabled={results.length === 0 && syncResults.length === 0}
          className="flex items-center gap-1"
        >
          <Trash2 className="h-4 w-4" />
          Clear Results
        </Button>
      </div>

      {/* Sync Status Section */}
      {latestSync && (
        <Card className={
          latestSync.status === 'success' ? 'border-green-500/30 bg-green-500/5' :
          latestSync.status === 'partial' ? 'border-yellow-500/30 bg-yellow-500/5' :
          'border-destructive/30 bg-destructive/5'
        }>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cloud className="h-4 w-4" />
                Last Sync Status
              </CardTitle>
              <div className="flex items-center gap-2">
                <SyncStatusBadge status={latestSync.status} />
                <MethodBadge method={latestSync.method} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Sync Data Flow Visualization */}
            <div className="flex items-center justify-center gap-2 py-2">
              {/* Emulator */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Radio className="h-6 w-6 text-primary" />
                </div>
                <span className="text-xs">Emulator</span>
                <StatusIcon status={latestSync.stages.emulator} />
              </div>

              <ArrowRight className="h-4 w-4 text-muted-foreground" />

              {/* API */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Webhook className="h-6 w-6 text-blue-500" />
                </div>
                <span className="text-xs">API</span>
                <StatusIcon status={latestSync.stages.api} />
              </div>

              <ArrowRight className="h-4 w-4 text-muted-foreground" />

              {/* Database */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Database className="h-6 w-6 text-orange-500" />
                </div>
                <span className="text-xs">Database</span>
                <StatusIcon status={latestSync.stages.database} />
              </div>

              <ArrowRight className="h-4 w-4 text-muted-foreground" />

              {/* Org Context */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-purple-500" />
                </div>
                <span className="text-xs">Org</span>
                <StatusIcon status={latestSync.stages.orgApplied ? 'success' : 'skipped'} />
              </div>
            </div>

            {/* Sync Counts */}
            <div className="flex items-center justify-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <Radio className="h-3 w-3" />
                {latestSync.counts.gatewaysSynced} gateways
                {latestSync.counts.gatewaysFailed > 0 && (
                  <span className="text-destructive">({latestSync.counts.gatewaysFailed} failed)</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <Thermometer className="h-3 w-3" />
                {latestSync.counts.devicesSynced} devices
                {latestSync.counts.devicesFailed > 0 && (
                  <span className="text-destructive">({latestSync.counts.devicesFailed} failed)</span>
                )}
              </span>
            </div>

            {/* Summary */}
            {latestSync.summary && (
              <p className="text-xs text-center text-muted-foreground">{latestSync.summary}</p>
            )}

            {/* Error Details */}
            {latestSync.errors.length > 0 && (
              <Collapsible open={errorsExpanded} onOpenChange={setErrorsExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {latestSync.errors.length} error{latestSync.errors.length > 1 ? 's' : ''}
                    <ChevronDown className={`h-4 w-4 transition-transform ${errorsExpanded ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-destructive/10 rounded-md p-3 space-y-1">
                    {latestSync.errors.map((error, i) => (
                      <p key={i} className="text-xs text-destructive font-mono">{error}</p>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Sync Run ID */}
            <p className="text-xs text-center text-muted-foreground font-mono">
              sync_run_id: {latestSync.sync_run_id.slice(0, 8)}...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sync History Section */}
      {syncResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Sync History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-60">
              <div className="space-y-2">
                {syncResults.slice(0, 15).map(sync => (
                  <div 
                    key={sync.id} 
                    className={`p-3 rounded-md border-l-4 ${
                      sync.status === 'success' ? 'border-l-green-500 bg-green-500/5' :
                      sync.status === 'partial' ? 'border-l-yellow-500 bg-yellow-500/5' :
                      'border-l-destructive bg-destructive/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatSyncTime(sync.timestamp)}
                        </span>
                        <SyncStatusBadge status={sync.status} />
                        <MethodBadge method={sync.method} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {sync.counts.gatewaysSynced} GW, {sync.counts.devicesSynced} dev
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {sync.sync_run_id.slice(0, 8)}...
                      </span>
                      {sync.errors.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-5 px-2 text-xs text-destructive"
                          onClick={() => toggleSyncExpanded(sync.id)}
                        >
                          {sync.errors.length} error{sync.errors.length > 1 ? 's' : ''}
                          <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${expandedSyncIds.has(sync.id) ? 'rotate-180' : ''}`} />
                        </Button>
                      )}
                    </div>

                    {expandedSyncIds.has(sync.id) && sync.errors.length > 0 && (
                      <div className="mt-2 bg-destructive/10 rounded p-2 space-y-1">
                        {sync.errors.map((error, i) => (
                          <p key={i} className="text-xs text-destructive font-mono">{error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Data Flow Visualization (for readings) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reading Data Flow Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-2 py-4">
            {/* Emulator */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
                <Radio className="h-8 w-8 text-primary" />
              </div>
              <span className="text-xs font-medium">Emulator</span>
              <StatusIcon status="success" />
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground" />

            {/* TTN */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-blue-500">
                  <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              </div>
              <span className="text-xs font-medium">TTN Cloud</span>
              <StatusIcon status={latestResult?.ttnStatus || 'pending'} />
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground" />

            {/* Webhook */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Webhook className="h-8 w-8 text-green-500" />
              </div>
              <span className="text-xs font-medium">Webhook</span>
              <StatusIcon status={latestResult?.webhookStatus || 'pending'} />
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground" />

            {/* Database */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Database className="h-8 w-8 text-orange-500" />
              </div>
              <span className="text-xs font-medium">Database</span>
              <StatusIcon status={latestResult?.dbStatus || 'pending'} />
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground" />

            {/* Org Context */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Building2 className="h-8 w-8 text-purple-500" />
              </div>
              <span className="text-xs font-medium">Org Scoped</span>
              <StatusIcon status={latestResult?.orgApplied ? 'success' : 'skipped'} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total Tests</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500">
              {stats.dbSuccess}/{stats.total}
            </div>
            <p className="text-xs text-muted-foreground">DB Inserts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-500">
              {stats.ttnSuccess}/{stats.total}
            </div>
            <p className="text-xs text-muted-foreground">TTN Success</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-500">
              {stats.orgApplied}/{stats.total}
            </div>
            <p className="text-xs text-muted-foreground">Org Applied</p>
          </CardContent>
        </Card>
        {syncStats && (
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">
                {syncStats.successful}/{syncStats.totalSyncs}
              </div>
              <p className="text-xs text-muted-foreground">Syncs OK</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Results Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            {results.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No test results yet. Start emulation or send a reading.
              </div>
            ) : (
              <div className="space-y-2">
                {results.slice(0, 20).map(result => (
                  <div 
                    key={result.id} 
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        {result.deviceType === 'temperature' ? (
                          <Thermometer className="h-4 w-4 text-blue-500" />
                        ) : (
                          <DoorOpen className="h-4 w-4 text-orange-500" />
                        )}
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {result.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={result.ttnStatus === 'success' ? 'default' : result.ttnStatus === 'skipped' ? 'secondary' : 'destructive'}
                        className="text-xs"
                      >
                        TTN: {result.ttnStatus}
                      </Badge>
                      <Badge 
                        variant={result.webhookStatus === 'success' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        WH: {result.webhookStatus}
                      </Badge>
                      <Badge 
                        variant={result.dbStatus === 'inserted' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        DB: {result.dbStatus}
                      </Badge>
                      {result.orgApplied && (
                        <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600">
                          Org ✓
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}