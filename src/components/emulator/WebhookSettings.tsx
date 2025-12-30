import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Webhook, TestTube, Check, X, Loader2 } from 'lucide-react';
import { WebhookConfig, buildTTNPayload, createDevice, createGateway } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';

interface WebhookSettingsProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
}

export default function WebhookSettings({ config, onConfigChange, disabled }: WebhookSettingsProps) {
  const [isTesting, setIsTesting] = useState(false);

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const testConnection = async () => {
    if (!config.targetUrl) {
      toast({ title: 'No URL', description: 'Enter a webhook URL first', variant: 'destructive' });
      return;
    }

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
        config.applicationId || 'test-app'
      );

      const response = await fetch(config.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        toast({ 
          title: 'Failed', 
          description: `Server returned ${response.status}`, 
          variant: 'destructive' 
        });
      }
    } catch (err: any) {
      const lastStatus = {
        code: 0,
        message: `Network error: ${err.message}`,
        timestamp: new Date(),
      };
      update({ lastStatus });
      toast({ 
        title: 'Connection failed', 
        description: err.message, 
        variant: 'destructive' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          Webhook Settings
        </h3>
        <p className="text-sm text-muted-foreground">
          Configure where to send TTN-formatted webhook payloads
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable External Webhook</Label>
              <p className="text-xs text-muted-foreground">
                Send payloads to an external endpoint
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={enabled => update({ enabled })}
              disabled={disabled}
            />
          </div>

          {config.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Target URL</Label>
                <Input
                  id="webhookUrl"
                  placeholder="https://your-app.supabase.co/functions/v1/ttn-webhook"
                  value={config.targetUrl}
                  onChange={e => update({ targetUrl: e.target.value })}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  The Edge Function URL that will receive TTN-formatted payloads
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="appId">TTN Application ID</Label>
                <Input
                  id="appId"
                  placeholder="my-cold-chain-app"
                  value={config.applicationId}
                  onChange={e => update({ applicationId: e.target.value })}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Included in payloads for routing in your app
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Also Send to Local Database</Label>
                  <p className="text-xs text-muted-foreground">
                    Keep storing data locally for monitoring
                  </p>
                </div>
                <Switch
                  checked={config.sendToLocal}
                  onCheckedChange={sendToLocal => update({ sendToLocal })}
                  disabled={disabled}
                />
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
                    disabled={disabled || isTesting || !config.targetUrl}
                    className="flex items-center gap-1"
                  >
                    {isTesting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4" />
                    )}
                    Test Connection
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
