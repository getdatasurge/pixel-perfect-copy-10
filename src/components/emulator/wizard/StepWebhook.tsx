import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink, Copy, Check, Webhook, Info } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';
import { toast } from '@/hooks/use-toast';

interface StepWebhookProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
}

export default function StepWebhook({
  config,
  updateConfig,
  markStepPassed,
  stepStatus,
}: StepWebhookProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ttn-webhook`;
  
  const ttnWebhooksUrl = `https://${config.cluster}.cloud.thethings.network/console/applications/${config.applicationId}/integrations/webhooks/add`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied', description: 'Webhook URL copied to clipboard' });
  };

  const handleConfirm = (checked: boolean) => {
    setConfirmed(checked);
    markStepPassed(5, checked);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Webhook Configuration</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure a webhook in TTN Console to receive uplink messages. This enables real hardware support.
        </p>
      </div>

      {/* Webhook URL */}
      <div className="space-y-2">
        <Label>Your Webhook URL</Label>
        <div className="flex gap-2">
          <Input
            value={webhookUrl}
            readOnly
            className="font-mono text-xs"
          />
          <Button variant="outline" size="icon" onClick={copyUrl}>
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-muted/50 rounded-lg p-4 space-y-4">
        <Label className="font-medium">Setup Instructions</Label>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Open TTN Console → Integrations → Webhooks</li>
          <li>Click <strong>"Add webhook"</strong> → Choose <strong>"Custom webhook"</strong></li>
          <li>Set a Webhook ID (e.g., <code className="bg-background px-1 rounded">frostguard-webhook</code>)</li>
          <li>Set <strong>Base URL</strong> to the URL shown above</li>
          <li>Enable <strong>"Uplink message"</strong> event</li>
          <li>Optionally set <strong>X-Downlink-Apikey</strong> header for security</li>
          <li>Click <strong>Create webhook</strong></li>
        </ol>
      </div>

      <Button
        variant="outline"
        size="sm"
        asChild
      >
        <a href={ttnWebhooksUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-2" />
          Open TTN Webhooks Page
        </a>
      </Button>

      {/* Optional Webhook Secret */}
      <div className="space-y-2">
        <Label htmlFor="webhookSecret">Webhook Secret (optional)</Label>
        <Input
          id="webhookSecret"
          type="password"
          placeholder="Optional - for signature verification"
          value={config.webhookSecret || ''}
          onChange={(e) => updateConfig({ webhookSecret: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          If you set a secret in TTN, enter it here for signature verification
        </p>
      </div>

      {/* Confirmation */}
      <div className="flex items-start gap-3 p-4 border rounded-lg">
        <Checkbox
          id="confirm"
          checked={confirmed}
          onCheckedChange={(checked) => handleConfirm(checked === true)}
        />
        <div className="space-y-1">
          <Label htmlFor="confirm" className="font-medium cursor-pointer">
            I've configured the webhook in TTN Console
          </Label>
          <p className="text-xs text-muted-foreground">
            Check this box to confirm you've added the webhook URL to TTN
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Note</AlertTitle>
        <AlertDescription className="text-sm">
          The webhook is needed for real hardware. For emulator-only testing using the Simulate Uplink API,
          the webhook is optional but recommended for a complete setup.
        </AlertDescription>
      </Alert>
    </div>
  );
}
