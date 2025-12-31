import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Play, Radio, ExternalLink } from 'lucide-react';
import { TTNConfig } from '@/lib/ttn-payload';
import { ProvisioningSummary } from '../TTNProvisioningWizard';

interface StepCompletionProps {
  summary: ProvisioningSummary;
  ttnConfig?: TTNConfig;
  onComplete: () => void;
}

export default function StepCompletion({
  summary,
  ttnConfig,
  onComplete,
}: StepCompletionProps) {
  const ttnConsoleUrl = `https://${ttnConfig?.cluster || 'eu1'}.cloud.thethings.network/console/applications/${ttnConfig?.applicationId}/devices`;

  const successCount = summary.created + summary.already_exists;
  const hasFailures = summary.failed > 0;

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
            {successCount} device(s) are now registered in TTN
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
                    Manage devices in The Things Network
                  </p>
                </div>
              </CardContent>
            </Card>
          </a>
        </div>
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
