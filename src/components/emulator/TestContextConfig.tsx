import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, Box, ExternalLink, Cloud, Loader2, Check } from 'lucide-react';
import { WebhookConfig, GatewayConfig, LoRaWANDevice } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface TestContextConfigProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
  gateways?: GatewayConfig[];
  devices?: LoRaWANDevice[];
}

export default function TestContextConfig({ 
  config, 
  onConfigChange, 
  disabled,
  gateways = [],
  devices = []
}: TestContextConfigProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
    setLastSyncResult(null);
  };

  // Normalize FrostGuard URL - extract base URL if edge function URL is pasted
  const handleFrostguardUrlChange = (value: string) => {
    let normalizedUrl = value;
    // Extract base URL if edge function URL is pasted
    if (value.includes('/functions/')) {
      const match = value.match(/^(https?:\/\/[^\/]+)/);
      if (match) {
        normalizedUrl = match[1];
      }
    }
    update({ frostguardApiUrl: normalizedUrl || undefined });
  };

  const canSync = config.testOrgId && config.frostguardApiUrl && (gateways.length > 0 || devices.length > 0);

  const syncAll = async () => {
    if (!config.testOrgId || !config.frostguardApiUrl) {
      toast({ 
        title: 'Missing Configuration', 
        description: 'Organization ID and FrostGuard API URL are required', 
        variant: 'destructive' 
      });
      return;
    }

    if (gateways.length === 0 && devices.length === 0) {
      toast({ 
        title: 'Nothing to Sync', 
        description: 'Add gateways or devices first', 
        variant: 'destructive' 
      });
      return;
    }

    setIsSyncing(true);
    setLastSyncResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('sync-to-frostguard', {
        body: {
          gateways: gateways.map(g => ({
            id: g.id,
            name: g.name,
            eui: g.eui,
            isOnline: g.isOnline,
          })),
          sensors: devices.map(d => ({
            id: d.id,
            name: d.name,
            devEui: d.devEui,
            type: d.type,
            gatewayId: d.gatewayId,
          })),
          orgId: config.testOrgId,
          siteId: config.testSiteId,
          unitId: config.testUnitId,
          frostguardApiUrl: config.frostguardApiUrl,
        },
      });

      if (error) throw error;

      const { results, summary } = data;
      setLastSyncResult(summary);
      
      if (results.gateways.failed > 0 || results.sensors.failed > 0) {
        const errors = [...results.gateways.errors, ...results.sensors.errors];
        toast({ 
          title: 'Sync Partial', 
          description: `${summary}. Errors: ${errors.join(', ')}`, 
          variant: 'destructive' 
        });
      } else {
        toast({ title: 'Sync Complete', description: summary });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast({ title: 'Sync Failed', description: errorMessage, variant: 'destructive' });
      setLastSyncResult(null);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <Label className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-primary" />
            Multi-Tenant Test Context
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Include organization context in payloads for multi-tenant testing with FrostGuard
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="testOrgId" className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              Organization ID
            </Label>
            <Input
              id="testOrgId"
              placeholder="org_abc123"
              value={config.testOrgId || ''}
              onChange={e => update({ testOrgId: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              FrostGuard org ID
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="testSiteId" className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Site ID
            </Label>
            <Input
              id="testSiteId"
              placeholder="site_xyz789"
              value={config.testSiteId || ''}
              onChange={e => update({ testSiteId: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Optional site context
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="testUnitId" className="flex items-center gap-1">
              <Box className="h-3 w-3" />
              Unit ID Override
            </Label>
            <Input
              id="testUnitId"
              placeholder="freezer-01"
              value={config.testUnitId || ''}
              onChange={e => update({ testUnitId: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Overrides device name
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor="frostguardApiUrl" className="flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              FrostGuard Supabase URL
            </Label>
            <Input
              id="frostguardApiUrl"
              placeholder="https://project-id.supabase.co"
              value={config.frostguardApiUrl || ''}
              onChange={e => handleFrostguardUrlChange(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Base Supabase URL (not edge function URL)
            </p>
          </div>
        </div>

        {(config.testOrgId || config.testSiteId) && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Active Context:</span>{' '}
              {config.testOrgId && <span className="font-mono">org={config.testOrgId}</span>}
              {config.testOrgId && config.testSiteId && ' • '}
              {config.testSiteId && <span className="font-mono">site={config.testSiteId}</span>}
            </p>
          </div>
        )}

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-primary" />
                Sync to Dashboard
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Register all gateways and sensors in FrostGuard
              </p>
            </div>
            <Button
              onClick={syncAll}
              disabled={disabled || isSyncing || !canSync}
              className="flex items-center gap-2"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : lastSyncResult ? (
                <>
                  <Check className="h-4 w-4" />
                  Synced
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4" />
                  Sync All ({gateways.length} gateways, {devices.length} sensors)
                </>
              )}
            </Button>
          </div>
          {lastSyncResult && (
            <p className="text-xs text-green-600 mt-2">
              ✓ {lastSyncResult}
            </p>
          )}
          {!canSync && !disabled && (
            <p className="text-xs text-muted-foreground mt-2">
              {!config.testOrgId || !config.frostguardApiUrl 
                ? 'Set Organization ID and FrostGuard API URL to enable sync'
                : 'Add gateways or devices to sync'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
