import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Webhook, TestTube, Check, X, Loader2, Copy, ExternalLink, 
  Radio, Cloud, AlertCircle 
} from 'lucide-react';
import { WebhookConfig, TTNConfig, buildTTNPayload, createDevice, createGateway } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WebhookSettingsProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
}

const TTN_CLUSTERS = [
  { value: 'eu1', label: 'Europe 1 (eu1.cloud.thethings.network)' },
  { value: 'nam1', label: 'North America 1 (nam1.cloud.thethings.network)' },
  { value: 'au1', label: 'Australia 1 (au1.cloud.thethings.network)' },
];

export default function WebhookSettings({ config, onConfigChange, disabled }: WebhookSettingsProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingTTN, setIsTestingTTN] = useState(false);
  const [copied, setCopied] = useState(false);

  // Get the local ttn-webhook URL
  const localWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ttn-webhook`;

  // Initialize TTN config if not present
  const ttnConfig: TTNConfig = config.ttnConfig || {
    enabled: false,
    applicationId: '',
    cluster: 'eu1',
  };

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const updateTTN = (updates: Partial<TTNConfig>) => {
    update({ ttnConfig: { ...ttnConfig, ...updates } });
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

  const testTTNConnection = async () => {
    if (!ttnConfig.applicationId) {
      toast({ title: 'Missing Config', description: 'Enter TTN Application ID first', variant: 'destructive' });
      return;
    }

    setIsTestingTTN(true);
    
    try {
      // Create test device
      const testGateway = createGateway('Test Gateway');
      const testDevice = createDevice('Test Device', 'temperature', testGateway.id);
      
      // Call our ttn-simulate edge function
      const { data, error } = await supabase.functions.invoke('ttn-simulate', {
        body: {
          applicationId: ttnConfig.applicationId,
          deviceId: `eui-${testDevice.devEui.toLowerCase()}`,
          cluster: ttnConfig.cluster,
          decodedPayload: {
            temperature: 38.5,
            humidity: 45.0,
            battery_level: 95,
            signal_strength: -65,
            test: true,
          },
          fPort: 1,
        },
      });

      if (error) {
        updateTTN({
          lastStatus: {
            code: 500,
            message: error.message,
            timestamp: new Date(),
          }
        });
        toast({ 
          title: 'TTN Connection Failed', 
          description: error.message, 
          variant: 'destructive' 
        });
      } else if (data?.success) {
        updateTTN({
          lastStatus: {
            code: 200,
            message: 'TTN API connection successful',
            timestamp: new Date(),
          }
        });
        toast({ 
          title: 'TTN Connected', 
          description: 'Successfully connected to The Things Network' 
        });
      } else {
        const errorMsg = data?.error || 'Unknown error';
        updateTTN({
          lastStatus: {
            code: data?.status || 500,
            message: errorMsg,
            timestamp: new Date(),
          }
        });
        toast({ 
          title: 'TTN Error', 
          description: errorMsg, 
          variant: 'destructive' 
        });
      }
    } catch (err: any) {
      updateTTN({
        lastStatus: {
          code: 0,
          message: `Network error: ${err.message}`,
          timestamp: new Date(),
        }
      });
      toast({ title: 'Connection failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsTestingTTN(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          TTN Integration
        </h3>
        <p className="text-sm text-muted-foreground">
          Route emulator data through The Things Network for production-ready testing
        </p>
      </div>

      {/* TTN API Integration - Primary */}
      <Card className="border-primary/50">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2 text-base">
                <Cloud className="h-5 w-5 text-primary" />
                Route Through TTN
              </Label>
              <p className="text-xs text-muted-foreground">
                Send data via TTN's Simulate Uplink API → TTN processes it → Webhook to your dashboard
              </p>
            </div>
            <Switch
              checked={ttnConfig.enabled}
              onCheckedChange={(enabled) => updateTTN({ enabled })}
              disabled={disabled}
            />
          </div>

          {ttnConfig.enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ttnAppId">TTN Application ID</Label>
                  <Input
                    id="ttnAppId"
                    placeholder="freshtrack-coldchain"
                    value={ttnConfig.applicationId}
                    onChange={e => updateTTN({ applicationId: e.target.value })}
                    disabled={disabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    From your TTN Console application
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>TTN Cluster</Label>
                  <Select
                    value={ttnConfig.cluster}
                    onValueChange={(cluster) => updateTTN({ cluster })}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select cluster" />
                    </SelectTrigger>
                    <SelectContent>
                      {TTN_CLUSTERS.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Your TTN region
                  </p>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>Devices must be registered in TTN</strong> with matching DevEUI for uplinks to succeed.</p>
                  <p>The TTN API Key is stored securely in your backend secrets.</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>TTN API Status</Label>
                    {ttnConfig.lastStatus && (
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={ttnConfig.lastStatus.code === 200 ? 'default' : 'destructive'}>
                          {ttnConfig.lastStatus.code === 200 ? (
                            <Check className="h-3 w-3 mr-1" />
                          ) : (
                            <X className="h-3 w-3 mr-1" />
                          )}
                          {ttnConfig.lastStatus.code || 'Error'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {ttnConfig.lastStatus.message}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testTTNConnection}
                    disabled={disabled || isTestingTTN || !ttnConfig.applicationId}
                    className="flex items-center gap-1"
                  >
                    {isTestingTTN ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Radio className="h-4 w-4" />
                    )}
                    Test TTN Connection
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Local Webhook URL - For Reference */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Your Webhook URL (for TTN Console)
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Configure this URL in TTN Console → Integrations → Webhooks for real hardware
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

          {!ttnConfig.enabled && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Direct Webhook Status</Label>
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
                  Test Direct Webhook
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* External Webhook for cross-project testing - only when TTN not enabled */}
      {!ttnConfig.enabled && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  External Webhook (Cross-Project)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Send payloads directly to another project (bypasses TTN)
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
              <Label htmlFor="appId">TTN Application ID (for payload)</Label>
              <Input
                id="appId"
                placeholder="cold-chain-app"
                value={config.applicationId}
                onChange={e => update({ applicationId: e.target.value })}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
