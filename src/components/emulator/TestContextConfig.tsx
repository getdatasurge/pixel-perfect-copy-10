import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, MapPin, Box, ExternalLink } from 'lucide-react';
import { WebhookConfig } from '@/lib/ttn-payload';

interface TestContextConfigProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
}

export default function TestContextConfig({ config, onConfigChange, disabled }: TestContextConfigProps) {
  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
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
              FrostGuard API URL
            </Label>
            <Input
              id="frostguardApiUrl"
              placeholder="https://your-project.supabase.co"
              value={config.frostguardApiUrl || ''}
              onChange={e => update({ frostguardApiUrl: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              For syncing devices to FrostGuard sensor registry
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
      </CardContent>
    </Card>
  );
}
