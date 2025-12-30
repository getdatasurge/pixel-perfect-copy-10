import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle2, XCircle, Clock, ArrowRight, 
  Radio, Webhook, Database, Building2, Trash2,
  Thermometer, DoorOpen
} from 'lucide-react';
import { TestResult } from '@/lib/ttn-payload';

interface TestDashboardProps {
  results: TestResult[];
  onClearResults: () => void;
}

export default function TestDashboard({ results, onClearResults }: TestDashboardProps) {
  // Get latest result for summary
  const latestResult = results[0];

  // Calculate stats
  const stats = {
    total: results.length,
    ttnSuccess: results.filter(r => r.ttnStatus === 'success').length,
    webhookSuccess: results.filter(r => r.webhookStatus === 'success').length,
    dbSuccess: results.filter(r => r.dbStatus === 'inserted').length,
    orgApplied: results.filter(r => r.orgApplied).length,
  };

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
          disabled={results.length === 0}
          className="flex items-center gap-1"
        >
          <Trash2 className="h-4 w-4" />
          Clear Results
        </Button>
      </div>

      {/* Data Flow Visualization */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Data Flow Status</CardTitle>
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
      <div className="grid grid-cols-4 gap-4">
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
