import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Play, Radio, ExternalLink, Copy, Download } from 'lucide-react';
import { TTNConfig } from '@/lib/ttn-payload';
import { ProvisioningSummary, ProvisioningMode, ProvisionResult } from '../TTNProvisioningWizard';
import { getEntriesByCategory } from '@/lib/debugLogger';
import { buildSupportSnapshot, downloadSnapshot } from '@/lib/supportSnapshot';
import { toast } from '@/hooks/use-toast';

interface StepCompletionProps {
  summary: ProvisioningSummary;
  ttnConfig?: TTNConfig;
  onComplete: () => void;
  mode?: ProvisioningMode;
  results?: ProvisionResult[];
}

export default function StepCompletion({
  summary,
  ttnConfig,
  onComplete,
  mode = 'devices',
  results = [],
}: StepCompletionProps) {
  const isGatewayMode = mode === 'gateways';
  const entityLabelPlural = isGatewayMode ? 'gateway(s)' : 'device(s)';
  
  const ttnConsoleUrl = isGatewayMode
    ? `https://${ttnConfig?.cluster || 'eu1'}.cloud.thethings.network/console/gateways`
    : `https://${ttnConfig?.cluster || 'eu1'}.cloud.thethings.network/console/applications/${ttnConfig?.applicationId}/devices`;

  const successCount = summary.created + summary.already_exists;
  const hasFailures = summary.failed > 0;

  const handleCopyDebugBundle = () => {
    const provisioningLogs = getEntriesByCategory('provisioning');
    const bundle = {
      timestamp: new Date().toISOString(),
      mode,
      summary,
      results,
      logs: provisioningLogs.slice(-50),
    };
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    toast({ title: 'Debug bundle copied to clipboard' });
  };

  const handleExportSnapshot = () => {
    const snapshot = buildSupportSnapshot({ maxLogEntries: 200 });
    downloadSnapshot(snapshot);
    toast({ title: 'Support snapshot downloaded' });
  };

  return (
    <div className="space-y-6 py-4">
      {/* Success animation area */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
        </div>
        <div>
          <h3 className="text-xl font-semibold">
            {hasFailures ? 'Provisioning Completed' : 'Provisioning Complete!'}
          </h3>
          <p className="text-muted-foreground mt-1">
            {successCount} {entityLabelPlural} are now registered in TTN
            {hasFailures && ` (${summary.failed} failed)`}
          </p>
        </div>
      </div>

      {/* Next steps */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-center text-muted-foreground">
          What's next?
        </p>

        <div className="grid gap-3">
          {isGatewayMode ? (
            // Gateway-specific next steps
            <>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Play className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Configure Devices</p>
                    <p className="text-xs text-muted-foreground">
                      Add devices and route data through your gateways
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Radio className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Test Gateway Connectivity</p>
                    <p className="text-xs text-muted-foreground">
                      Verify gateways are online in TTN Console
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            // Device-specific next steps
            <>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Play className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Start Emulation</p>
                    <p className="text-xs text-muted-foreground">
                      Begin sending sensor data through TTN
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Radio className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Route Through TTN</p>
                    <p className="text-xs text-muted-foreground">
                      Enable TTN routing in Webhook settings
                    </p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <a
            href={ttnConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <ExternalLink className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">View in TTN Console</p>
                  <p className="text-xs text-muted-foreground">
                    Manage {isGatewayMode ? 'gateways' : 'devices'} in The Things Network
                  </p>
                </div>
              </CardContent>
            </Card>
          </a>
        </div>
      </div>

      {/* Debug actions */}
      <div className="flex justify-center gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={handleCopyDebugBundle} className="gap-1">
          <Copy className="h-3 w-3" />
          Copy Debug Bundle
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportSnapshot} className="gap-1">
          <Download className="h-3 w-3" />
          Export Snapshot
        </Button>
      </div>

      {/* Complete button */}
      <div className="text-center pt-4">
        <Button onClick={onComplete} size="lg" className="px-8">
          Complete Setup
        </Button>
      </div>
    </div>
  );
}
