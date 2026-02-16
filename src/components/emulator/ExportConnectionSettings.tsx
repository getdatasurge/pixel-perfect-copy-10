import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Settings, Eye, EyeOff, ChevronDown, ChevronRight,
  Loader2, CheckCircle, XCircle, Trash2,
} from 'lucide-react';
import {
  loadConnectionConfig,
  saveConnectionConfig,
  clearConnectionConfig,
  isDirectModeAvailable,
  getEffectiveConfig,
  FreshTrackConnectionConfig,
} from '@/lib/freshtrackConnectionStore';
import { testFreshTrackHealth } from '@/lib/freshtrackExport';
import { toast } from '@/hooks/use-toast';

interface ExportConnectionSettingsProps {
  onConfigChange?: (config: FreshTrackConnectionConfig) => void;
}

export default function ExportConnectionSettings({ onConfigChange }: ExportConnectionSettingsProps) {
  const [config, setConfig] = useState<FreshTrackConnectionConfig>(loadConnectionConfig);
  const [isOpen, setIsOpen] = useState(!isDirectModeAvailable());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const toggleKeyVisibility = (field: string) => {
    setShowKeys(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = useCallback(() => {
    saveConnectionConfig(config);
    onConfigChange?.(config);
    toast({ title: 'Settings Saved', description: 'FreshTrack connection settings saved to localStorage.' });
  }, [config, onConfigChange]);

  const handleClear = useCallback(() => {
    clearConnectionConfig();
    const empty: FreshTrackConnectionConfig = {
      freshtrackUrl: '',
      emulatorSyncApiKey: '',
      deviceIngestApiKey: '',
      orgStateSyncApiKey: '',
      freshtrackOrgId: '',
    };
    setConfig(empty);
    setTestResult(null);
    onConfigChange?.(empty);
    toast({ title: 'Settings Cleared', description: 'FreshTrack connection settings removed.' });
  }, [onConfigChange]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await testFreshTrackHealth();
    if (result.ok) {
      setTestResult('success');
      toast({
        title: 'Connection OK',
        description: result.version ? `FreshTrack v${result.version} reachable` : 'FreshTrack endpoint reachable',
      });
    } else {
      setTestResult('failed');
      toast({ title: 'Connection Failed', description: result.error, variant: 'destructive' });
    }
    setIsTesting(false);
  }, []);

  const effective = getEffectiveConfig();
  const mode = isDirectModeAvailable() ? 'direct' : effective.freshtrackUrl ? 'partial' : 'proxy';

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                FreshTrack Connection Settings
              </CardTitle>
              <div className="flex items-center gap-2">
                {mode === 'direct' ? (
                  <Badge variant="outline" className="border-green-500/30 text-green-600 text-xs">Direct</Badge>
                ) : mode === 'partial' ? (
                  <Badge variant="outline" className="border-yellow-500/30 text-yellow-600 text-xs">Partial</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Proxy</Badge>
                )}
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* FreshTrack URL */}
            <div className="space-y-1.5">
              <Label htmlFor="ft-url" className="text-xs">FreshTrack Supabase URL</Label>
              <Input
                id="ft-url"
                value={config.freshtrackUrl}
                onChange={e => setConfig(prev => ({ ...prev, freshtrackUrl: e.target.value }))}
                placeholder="VITE_FRESHTRACK_SUPABASE_URL"
                className="h-8 text-sm font-mono"
              />
            </div>

            {/* API Keys */}
            {([
              { key: 'emulatorSyncApiKey' as const, label: 'Emulator Sync API Key', env: 'VITE_EMULATOR_SYNC_API_KEY' },
              { key: 'deviceIngestApiKey' as const, label: 'Device Ingest API Key', env: 'VITE_DEVICE_INGEST_API_KEY' },
              { key: 'orgStateSyncApiKey' as const, label: 'Org State Sync API Key', env: 'VITE_ORG_STATE_SYNC_API_KEY' },
            ]).map(({ key, label, env }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`ft-${key}`} className="text-xs">{label}</Label>
                <div className="relative">
                  <Input
                    id={`ft-${key}`}
                    type={showKeys[key] ? 'text' : 'password'}
                    value={config[key]}
                    onChange={e => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={env}
                    className="h-8 text-sm font-mono pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility(key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKeys[key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}

            {/* Organization ID */}
            <div className="space-y-1.5">
              <Label htmlFor="ft-org" className="text-xs">Organization ID</Label>
              <Input
                id="ft-org"
                value={config.freshtrackOrgId}
                onChange={e => setConfig(prev => ({ ...prev, freshtrackOrgId: e.target.value }))}
                placeholder="VITE_FRESHTRACK_ORG_ID (UUID)"
                className="h-8 text-sm font-mono"
              />
            </div>

            {/* Env var fallback info */}
            {(effective.freshtrackUrl && !config.freshtrackUrl) && (
              <Alert>
                <AlertDescription className="text-xs">
                  Using URL from environment variable. Enter a value above to override.
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSave}>
                Save Settings
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting || !effective.freshtrackUrl}
              >
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : testResult === 'success' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500 mr-1" />
                ) : testResult === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive mr-1" />
                ) : null}
                Test Connection
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClear}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
