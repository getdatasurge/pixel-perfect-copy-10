import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Webhook, TestTube, Check, X, Loader2, Copy, ExternalLink } from 'lucide-react';
import { WebhookConfig, buildTTNPayload, createDevice, createGateway } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface WebhookSettingsProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
}

export default function WebhookSettings({ config, onConfigChange, disabled }: WebhookSettingsProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Get the local ttn-webhook URL
  const localWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ttn-webhook`;

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const copyLocalUrl = () => {
    navigator.clipboard.writeText(localWebhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied', description: 'Webhook URL copied to clipboard' });
  };

  const useLocalWebhook = () => {
    update({ targetUrl: localWebhookUrl, enabled: true });
    toast({ title: 'Set', description: 'Using local ttn-webhook function' });
  };

  const testConnection = async () => {
    const targetUrl = config.enabled && config.targetUrl ? config.targetUrl : localWebhookUrl;

    setIsTesting(true);
    
    try {
      // Create test device and gateway
      const testGateway = createGateway('Test Gateway');
      const testDevice = createDevice('Test Device', 'temperature', testGateway.id);
      
      // Build test payload
      const payload = buildTTNPayload(
        testDevice,
        testGateway,
        {
          temperature: 38.5,
          humidity: 45.0,
          battery_level: 95,
          signal_strength: -65,
          test: true,
        },
        config.applicationId || 'cold-chain-app'
      );

      // If using local webhook (no external URL or disabled), use supabase.functions.invoke
      if (!config.enabled || !config.targetUrl) {
        const { data, error } = await supabase.functions.invoke('ttn-webhook', {
          body: payload,
        });

        const lastStatus = {
          code: error ? 500 : 200,
          message: error ? error.message : 'Connection successful',
          timestamp: new Date(),
        };

        update({ lastStatus });

        if (error) {
          toast({ title: 'Failed', description: error.message, variant: 'destructive' });
        } else {
          toast({ title: 'Success', description: 'Test payload sent to local ttn-webhook' });
        }
      } else {
        // External webhook
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const lastStatus = {
          code: response.status,
          message: response.ok ? 'Connection successful' : `Error: ${response.statusText}`,
          timestamp: new Date(),
        };

        update({ lastStatus });

        if (response.ok) {
          toast({ title: 'Success', description: 'Test payload sent successfully' });
        } else {
          toast({ title: 'Failed', description: `Server returned ${response.status}`, variant: 'destructive' });
        }
      }
    } catch (err: any) {
      const lastStatus = {
        code: 0,
        message: `Network error: ${err.message}`,
        timestamp: new Date(),
      };
      update({ lastStatus });
      toast({ title: 'Connection failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          TTN Webhook Integration
        </h3>
        <p className="text-sm text-muted-foreground">
          All data flows through TTN-formatted webhooks for production-ready architecture
        </p>
      </div>

      {/* Local Webhook URL */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label>Local ttn-webhook URL</Label>
            <p className="text-xs text-muted-foreground mb-2">
              This is your project's webhook endpoint. Use this URL in TTN console when connecting real sensors.
            </p>
            <div className="flex gap-2">
              <Input
                value={localWebhookUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={copyLocalUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Connection Status</Label>
                {config.lastStatus && (
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={config.lastStatus.code === 200 ? 'default' : 'destructive'}>
                      {config.lastStatus.code === 200 ? (
                        <Check className="h-3 w-3 mr-1" />
                      ) : (
                        <X className="h-3 w-3 mr-1" />
                      )}
                      {config.lastStatus.code || 'Error'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {config.lastStatus.message}
                    </span>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={disabled || isTesting}
                className="flex items-center gap-1"
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4" />
                )}
                Test Local Webhook
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* External Webhook (Optional) */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                External Webhook (Cross-Project Testing)
              </Label>
              <p className="text-xs text-muted-foreground">
                Optionally send payloads to a different project's ttn-webhook endpoint
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookUrl">External URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="webhookUrl"
                placeholder="https://other-project.supabase.co/functions/v1/ttn-webhook"
                value={config.targetUrl}
                onChange={e => update({ targetUrl: e.target.value, enabled: !!e.target.value })}
                disabled={disabled}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={useLocalWebhook}
                disabled={disabled}
              >
                Use Local
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appId">TTN Application ID</Label>
            <Input
              id="appId"
              placeholder="cold-chain-app"
              value={config.applicationId}
              onChange={e => update({ applicationId: e.target.value })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Included in payloads for routing
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
