import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Webhook, TestTube, Check, X, Loader2, Copy, ExternalLink, 
  Radio, Cloud, AlertCircle, Shield, ShieldCheck, ShieldX, Save
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
  currentDevEui?: string;
  orgId?: string; // Organization ID for scoped settings
}

const TTN_CLUSTERS = [
  { value: 'eu1', label: 'Europe 1 (eu1)' },
  { value: 'nam1', label: 'North America 1 (nam1)' },
  { value: 'au1', label: 'Australia 1 (au1)' },
  { value: 'as1', label: 'Asia 1 (as1)' },
];

interface TTNTestResult {
  ok: boolean;
  requestId: string;
  step?: string;
  ttn_status?: number;
  ttn_message?: string;
  hint?: string;
  baseUrl?: string;
  application_id?: string;
  rights_ok?: boolean;
  rights_check_failed?: boolean;
  granted_rights?: string[];
  missing_rights?: string[];
  next_steps?: string[];
  error?: string;
  code?: string;
}

interface TTNSettingsFromDB {
  enabled: boolean;
  cluster: string;
  application_id: string | null;
  api_key_preview: string | null;
  webhook_secret_preview: string | null;
  updated_at: string;
}

export default function WebhookSettings({ config, onConfigChange, disabled, currentDevEui, orgId }: WebhookSettingsProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingTTN, setIsTestingTTN] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedDevEui, setCopiedDevEui] = useState(false);
  
  // Local form state for TTN settings
  const [ttnEnabled, setTtnEnabled] = useState(false);
  const [ttnCluster, setTtnCluster] = useState<string>('eu1');
  const [ttnApplicationId, setTtnApplicationId] = useState('');
  const [ttnApiKey, setTtnApiKey] = useState('');
  const [ttnWebhookSecret, setTtnWebhookSecret] = useState('');
  const [ttnApiKeyPreview, setTtnApiKeyPreview] = useState<string | null>(null);
  
  // Test result state
  const [testResult, setTestResult] = useState<TTNTestResult | null>(null);
  
  // Get the local ttn-webhook URL
  const localWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ttn-webhook`;

  // Initialize TTN config if not present (for backward compatibility)
  const ttnConfig: TTNConfig = config.ttnConfig || {
    enabled: false,
    applicationId: '',
    cluster: 'eu1',
  };

  // Load settings from database on mount or org change
  useEffect(() => {
    if (orgId) {
      loadSettings();
    }
  }, [orgId]);

  const loadSettings = async () => {
    if (!orgId) return;
    
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.log('No auth session, skipping settings load');
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: 'load', org_id: orgId },
      });

      if (error) {
        console.error('Failed to load TTN settings:', error);
        toast({
          title: 'Load Failed',
          description: error.message || 'Could not load TTN settings',
          variant: 'destructive',
        });
        return;
      }

      if (data?.ok && data?.settings) {
        const settings: TTNSettingsFromDB = data.settings;
        setTtnEnabled(settings.enabled);
        setTtnCluster(settings.cluster);
        setTtnApplicationId(settings.application_id || '');
        setTtnApiKeyPreview(settings.api_key_preview);
        // Don't load actual secrets, just show preview
        setTtnApiKey(''); // Reset to empty, user must re-enter to save
        setTtnWebhookSecret('');
      }
    } catch (err: any) {
      console.error('Error loading settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!orgId) {
      toast({
        title: 'No Organization',
        description: 'Select an organization in Test Context first',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({
          title: 'Not Authenticated',
          description: 'Please log in to save settings',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          action: 'save',
          org_id: orgId,
          enabled: ttnEnabled,
          cluster: ttnCluster,
          application_id: ttnApplicationId,
          api_key: ttnApiKey || undefined, // Only send if user entered new value
          webhook_secret: ttnWebhookSecret || undefined,
        },
      });

      if (error) {
        // Parse the JSON error if available
        const errorMsg = data?.error || error.message || 'Failed to save settings';
        toast({
          title: 'Save Failed',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      if (data?.ok) {
        toast({
          title: 'Settings Saved',
          description: 'TTN configuration saved successfully',
        });
        // Update preview after save
        if (ttnApiKey) {
          setTtnApiKeyPreview(`****${ttnApiKey.slice(-4)}`);
          setTtnApiKey(''); // Clear the input after save
        }
        
        // Also update the local config for compatibility
        updateTTN({ 
          enabled: ttnEnabled, 
          applicationId: ttnApplicationId, 
          cluster: ttnCluster 
        });
      } else {
        toast({
          title: 'Save Failed',
          description: data?.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Save Error',
        description: err.message || 'Network error saving settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const testTTNConnection = async () => {
    if (!ttnApplicationId) {
      toast({ title: 'Missing Config', description: 'Enter TTN Application ID first', variant: 'destructive' });
      return;
    }

    if (!ttnApiKey && !ttnApiKeyPreview) {
      toast({ title: 'Missing Config', description: 'Enter TTN API Key first', variant: 'destructive' });
      return;
    }

    setIsTestingTTN(true);
    setTestResult(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Build request - use entered API key or indicate we want to use stored one
      const requestBody: any = {
        action: 'test',
        org_id: orgId,
        cluster: ttnCluster,
        application_id: ttnApplicationId,
        api_key: ttnApiKey, // User must enter key to test
      };

      if (!ttnApiKey) {
        toast({ 
          title: 'Enter API Key', 
          description: 'Enter your TTN API key to test the connection', 
          variant: 'destructive' 
        });
        setIsTestingTTN(false);
        return;
      }

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        headers,
        body: requestBody,
      });

      if (error) {
        // Even on error, try to parse the response
        const result: TTNTestResult = {
          ok: false,
          requestId: data?.requestId || 'unknown',
          error: data?.error || error.message,
          code: data?.code || 'UNKNOWN_ERROR',
          hint: data?.hint,
        };
        setTestResult(result);
        
        toast({
          title: 'Connection Test Failed',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }

      // Process successful response
      const result: TTNTestResult = data;
      setTestResult(result);

      if (result.ok && result.rights_ok) {
        toast({
          title: 'TTN Connected',
          description: 'Successfully connected to The Things Network with full rights',
        });
        updateTTN({
          lastStatus: {
            code: 200,
            message: 'Connected with full rights',
            timestamp: new Date(),
          }
        });
      } else if (result.ok && !result.rights_ok) {
        toast({
          title: 'TTN Connected (Limited)',
          description: 'Connected but some rights are missing',
        });
        updateTTN({
          lastStatus: {
            code: 200,
            message: 'Connected with limited rights',
            timestamp: new Date(),
          }
        });
      } else {
        toast({
          title: 'TTN Test Failed',
          description: result.ttn_message || result.error || 'Unknown error',
          variant: 'destructive',
        });
        updateTTN({
          lastStatus: {
            code: result.ttn_status || 500,
            message: result.ttn_message || result.error || 'Unknown error',
            timestamp: new Date(),
          }
        });
      }
    } catch (err: any) {
      const result: TTNTestResult = {
        ok: false,
        requestId: 'network-error',
        error: `Network error: ${err.message}`,
        hint: 'Check your internet connection',
      };
      setTestResult(result);
      toast({ title: 'Connection failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsTestingTTN(false);
    }
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

  const copyDevEui = () => {
    if (!currentDevEui) return;
    navigator.clipboard.writeText(currentDevEui);
    setCopiedDevEui(true);
    setTimeout(() => setCopiedDevEui(false), 2000);
    toast({ title: 'Copied', description: 'DevEUI copied - use this when registering in TTN Console' });
  };

  const useLocalWebhook = () => {
    update({ targetUrl: localWebhookUrl, enabled: true });
    toast({ title: 'Set', description: 'Using local ttn-webhook function' });
  };

  const testDirectWebhook = async () => {
    const targetUrl = config.enabled && config.targetUrl ? config.targetUrl : localWebhookUrl;

    setIsTesting(true);
    
    try {
      const testGateway = createGateway('Test Gateway');
      const testDevice = createDevice('Test Device', 'temperature', testGateway.id);
      
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

  // Render test result diagnostics
  const renderTestDiagnostics = () => {
    if (!testResult) return null;

    if (testResult.ok && testResult.rights_ok) {
      return (
        <Alert className="border-green-500/50 bg-green-500/10">
          <ShieldCheck className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-600">Connected Successfully</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>Application: <code className="bg-muted px-1 rounded">{testResult.application_id}</code></p>
            <p>Endpoint: <code className="bg-muted px-1 rounded text-xs">{testResult.baseUrl}</code></p>
            <p className="text-xs text-muted-foreground">Request ID: {testResult.requestId}</p>
          </AlertDescription>
        </Alert>
      );
    }

    if (testResult.ok && !testResult.rights_ok) {
      return (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <Shield className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-600">Connected with Limited Rights</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>Your API key works but is missing some permissions.</p>
            {testResult.missing_rights && testResult.missing_rights.length > 0 && (
              <div>
                <p className="font-medium">Missing rights:</p>
                <ul className="list-disc list-inside text-xs">
                  {testResult.missing_rights.map((r, i) => (
                    <li key={i}><code>{r}</code></li>
                  ))}
                </ul>
              </div>
            )}
            {testResult.next_steps && testResult.next_steps.length > 0 && (
              <div className="bg-background/50 rounded p-2 text-xs">
                <p className="font-medium mb-1">Next steps:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  {testResult.next_steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Request ID: {testResult.requestId}</p>
          </AlertDescription>
        </Alert>
      );
    }

    // Error case
    return (
      <Alert variant="destructive">
        <ShieldX className="h-4 w-4" />
        <AlertTitle>Connection Failed</AlertTitle>
        <AlertDescription className="text-sm space-y-2">
          {testResult.step && (
            <p>Failed at step: <code className="bg-muted px-1 rounded">{testResult.step}</code></p>
          )}
          {testResult.ttn_status && (
            <p>TTN Status: <Badge variant="destructive">{testResult.ttn_status}</Badge></p>
          )}
          <p>{testResult.ttn_message || testResult.error}</p>
          {testResult.hint && (
            <p className="bg-background/50 rounded p-2 text-xs">{testResult.hint}</p>
          )}
          <p className="text-xs text-muted-foreground">Request ID: {testResult.requestId}</p>
        </AlertDescription>
      </Alert>
    );
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

      {/* TTN Settings - Primary */}
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
              checked={ttnEnabled}
              onCheckedChange={setTtnEnabled}
              disabled={disabled || isLoading}
            />
          </div>

          {ttnEnabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ttnCluster">TTN Cluster</Label>
                  <Select
                    value={ttnCluster}
                    onValueChange={setTtnCluster}
                    disabled={disabled || isLoading}
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
                    Base URL: https://{ttnCluster}.cloud.thethings.network
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ttnAppId">Application ID</Label>
                  <Input
                    id="ttnAppId"
                    placeholder="frostguard"
                    value={ttnApplicationId}
                    onChange={e => setTtnApplicationId(e.target.value)}
                    disabled={disabled || isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    From your TTN Console application
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ttnApiKey">API Key</Label>
                  <Input
                    id="ttnApiKey"
                    type="password"
                    placeholder={ttnApiKeyPreview || "NNSXS.XXXXXXX..."}
                    value={ttnApiKey}
                    onChange={e => setTtnApiKey(e.target.value)}
                    disabled={disabled || isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ttnApiKeyPreview 
                      ? `Current: ${ttnApiKeyPreview} (enter new value to change)` 
                      : 'From TTN Console → API keys'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ttnWebhookSecret">Webhook Secret (optional)</Label>
                  <Input
                    id="ttnWebhookSecret"
                    type="password"
                    placeholder="Optional"
                    value={ttnWebhookSecret}
                    onChange={e => setTtnWebhookSecret(e.target.value)}
                    disabled={disabled || isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    For webhook signature verification
                  </p>
                </div>
              </div>

              {/* Test Result Diagnostics */}
              {renderTestDiagnostics()}

              {/* TTN Device Registration Helper */}
              {currentDevEui && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                    <div className="text-sm space-y-2">
                      <p className="font-medium text-amber-700">Device Must Be Registered in TTN</p>
                      <p className="text-xs text-muted-foreground">
                        Register this device in TTN Console with the exact DevEUI.
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Current Temperature Sensor DevEUI</Label>
                    <div className="flex gap-2">
                      <Input
                        value={currentDevEui}
                        readOnly
                        className="font-mono text-sm bg-background"
                      />
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={copyDevEui}
                        title="Copy DevEUI"
                      >
                        {copiedDevEui ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="border-t pt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testTTNConnection}
                    disabled={disabled || isTestingTTN || !ttnApplicationId || (!ttnApiKey && !ttnApiKeyPreview)}
                    className="flex items-center gap-1"
                  >
                    {isTestingTTN ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Radio className="h-4 w-4" />
                    )}
                    Test Connection
                  </Button>
                </div>

                <Button
                  size="sm"
                  onClick={saveSettings}
                  disabled={disabled || isSaving || !orgId}
                  className="flex items-center gap-1"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Settings
                </Button>
              </div>

              {!orgId && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>No Organization Selected</AlertTitle>
                  <AlertDescription>
                    Select an organization in the Test Context tab to save TTN settings.
                  </AlertDescription>
                </Alert>
              )}
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

          {!ttnEnabled && (
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
                  onClick={testDirectWebhook}
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
      {!ttnEnabled && (
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
                placeholder="frostguard"
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
