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
  Radio, Cloud, AlertCircle, ShieldCheck, ShieldX, Save, Info, Wand2, RefreshCw
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WebhookConfig, TTNConfig, buildTTNPayload, createDevice, createGateway, LoRaWANDevice } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { debug } from '@/lib/debugLogger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TTNSetupWizard, { WizardConfig } from './TTNSetupWizard';

interface WebhookSettingsProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
  currentDevEui?: string;
  orgId?: string;
  devices?: LoRaWANDevice[];
}

const TTN_CLUSTERS = [
  { value: 'nam1', label: 'North America (nam1)' },
  { value: 'eu1', label: 'Europe (eu1)' },
];

interface TTNTestResult {
  ok: boolean;
  requestId: string;
  error?: string;
  code?: string;
  hint?: string;
  cluster_hint?: string;
  baseUrl?: string;
  application_id?: string;
  cluster?: string;
  connected?: boolean;
  message?: string;
  ttn_status?: number;
  ttn_message?: string;
  required_permissions?: string[];
}

interface TTNSettingsFromDB {
  enabled: boolean;
  cluster: string;
  application_id: string | null;
  api_key_preview: string | null;
  api_key_set: boolean;
  webhook_secret_preview: string | null;
  webhook_secret_set: boolean;
  updated_at: string;
  last_test_at: string | null;
  last_test_success: boolean | null;
}

export default function WebhookSettings({ config, onConfigChange, disabled, currentDevEui, orgId, devices = [] }: WebhookSettingsProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingTTN, setIsTestingTTN] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedDevEui, setCopiedDevEui] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  
  // Local form state for TTN settings
  const [ttnEnabled, setTtnEnabled] = useState(false);
  const [ttnCluster, setTtnCluster] = useState<string>('eu1');
  const [ttnApplicationId, setTtnApplicationId] = useState('');
  const [ttnApiKey, setTtnApiKey] = useState('');
  const [ttnWebhookSecret, setTtnWebhookSecret] = useState('');
  const [ttnApiKeyPreview, setTtnApiKeyPreview] = useState<string | null>(null);
  const [ttnApiKeySet, setTtnApiKeySet] = useState(false);
  const [ttnWebhookSecretSet, setTtnWebhookSecretSet] = useState(false);
  
  // Connection status tracking
  const [lastTestAt, setLastTestAt] = useState<Date | string | null>(null);
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  
  // Test result state
  const [testResult, setTestResult] = useState<TTNTestResult | null>(null);

  // Handle wizard completion
  const handleWizardComplete = async (wizardConfig: WizardConfig) => {
    setTtnCluster(wizardConfig.cluster);
    setTtnApplicationId(wizardConfig.applicationId);
    setTtnApiKey(wizardConfig.apiKey);
    if (wizardConfig.webhookSecret) {
      setTtnWebhookSecret(wizardConfig.webhookSecret);
    }
    setTtnEnabled(true);
    
    // Auto-save settings
    if (orgId) {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'save',
          org_id: orgId,
          enabled: true,
          cluster: wizardConfig.cluster,
          application_id: wizardConfig.applicationId,
          api_key: wizardConfig.apiKey,
          webhook_secret: wizardConfig.webhookSecret,
        },
      });
      
      if (!error && data?.ok) {
        toast({ title: 'TTN Setup Complete', description: 'Settings saved successfully' });
        setTtnApiKeyPreview(data.api_key_preview || `****${wizardConfig.apiKey.slice(-4)}`);
        setTtnApiKeySet(true);
        setTtnApiKey('');
        updateTTN({ enabled: true, applicationId: wizardConfig.applicationId, cluster: wizardConfig.cluster });
        
        // Mark wizard complete
        localStorage.setItem(`ttn-wizard-complete-${orgId}`, 'true');
      }
    }
  };
  
  // Get the local ttn-webhook URL
  const localWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ttn-webhook`;

  // Initialize TTN config if not present (for backward compatibility)
  const ttnConfig: TTNConfig = config.ttnConfig || {
    enabled: false,
    applicationId: '',
    cluster: 'eu1',
  };

  // Load settings from config or database on mount or org/user change
  useEffect(() => {
    // If TTN config is already in the config prop (from Testing page), use it directly
    if (config.ttnConfig?.applicationId) {
      console.log('[WebhookSettings] Using TTN config from props:', config.ttnConfig);
      setTtnEnabled(config.ttnConfig.enabled || false);
      setTtnCluster(config.ttnConfig.cluster || 'eu1');
      setTtnApplicationId(config.ttnConfig.applicationId || '');
      setTtnApiKeyPreview(config.ttnConfig.api_key_last4 ? `****${config.ttnConfig.api_key_last4}` : null);
      setTtnApiKeySet(!!(config.ttnConfig.api_key_last4));
      setTtnWebhookSecretSet(!!(config.ttnConfig.webhook_secret_last4));
      // Don't load actual secrets from config
      setTtnApiKey('');
      setTtnWebhookSecret('');

      // Update connection status if available
      if (config.ttnConfig.lastTestAt) {
        setLastTestAt(config.ttnConfig.lastTestAt);
        setLastTestSuccess(config.ttnConfig.lastTestSuccess ?? null);
      }

      setIsLoading(false);
    } else if (orgId) {
      // Fallback to database query (for backward compatibility)
      loadSettings();
    } else {
      // No config and no orgId - just set loading to false
      setIsLoading(false);
    }
  }, [orgId, config.selectedUserId, config.ttnConfig]);

  const loadSettings = async () => {
    if (!orgId) return;

    setIsLoading(true);
    try {
      // Load TTN settings from synced_users table (synced from FrostGuard)
      // Query by user_id if available, otherwise by organization_id
      const userId = config.selectedUserId;

      let query = supabase
        .from('synced_users')
        .select('ttn, source_organization_id, id, email');

      if (userId) {
        console.log('[WebhookSettings] Loading TTN settings for user:', userId);
        query = query.eq('id', userId);
      } else {
        console.log('[WebhookSettings] Loading TTN settings for org:', orgId);
        query = query.eq('source_organization_id', orgId);
      }

      const { data: syncedUser, error: fetchError } = await query.limit(1).maybeSingle();

      if (fetchError) {
        console.error('[WebhookSettings] Failed to load TTN settings from synced_users:', fetchError);
        toast({
          title: 'Load Failed',
          description: 'Could not load TTN settings from FrostGuard',
          variant: 'destructive',
        });
        return;
      }

      if (syncedUser?.ttn) {
        const ttn = syncedUser.ttn as any;
        console.log('[WebhookSettings] Loaded TTN settings from synced_users:', { ttn, user: syncedUser.email });

        setTtnEnabled(ttn.enabled || false);
        setTtnCluster(ttn.cluster || 'eu1');
        setTtnApplicationId(ttn.application_id || '');
        setTtnApiKeyPreview(ttn.api_key_last4 ? `****${ttn.api_key_last4}` : null);
        setTtnApiKeySet(!!(ttn.api_key_last4));
        setTtnWebhookSecretSet(!!(ttn.webhook_secret_last4));
        // Don't load actual secrets, just show preview
        setTtnApiKey(''); // Reset to empty, user must enter new value to change
        setTtnWebhookSecret('');

        // Load connection status
        if (ttn.updated_at) {
          setLastTestAt(new Date(ttn.updated_at));
        }

        // Update parent config
        if (ttn.enabled) {
          updateTTN({
            enabled: ttn.enabled,
            applicationId: ttn.application_id || '',
            cluster: ttn.cluster || 'eu1',
          });
        }
      } else {
        console.log('[WebhookSettings] No TTN settings found in synced_users for', userId ? `user ${userId}` : `org ${orgId}`);
        toast({
          title: 'No TTN Settings',
          description: 'No TTN configuration found for selected user. Make sure user is synced from FrostGuard.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      console.error('[WebhookSettings] Error loading settings:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to load TTN settings',
        variant: 'destructive',
      });
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

    // Validate new API key format if provided
    if (ttnApiKey) {
      if (!ttnApiKey.startsWith('NNSXS.') && !ttnApiKey.startsWith('nnsxs.')) {
        toast({
          title: 'Invalid API Key Format',
          description: 'TTN API keys should start with "NNSXS."',
          variant: 'destructive',
        });
        return;
      }
      if (ttnApiKey.length < 50) {
        toast({
          title: 'API Key Too Short',
          description: 'TTN API keys are typically 100+ characters',
          variant: 'destructive',
        });
        return;
      }
    }

    setIsSaving(true);
    
    // Debug logging - request
    const apiKeyLast4New = ttnApiKey ? ttnApiKey.slice(-4) : null;
    debug.ttn('TTN_SETTINGS_SAVE_REQUEST', {
      orgId,
      cluster: ttnCluster,
      appId: ttnApplicationId,
      apiKeyLast4_new: apiKeyLast4New ? `****${apiKeyLast4New}` : null,
      hasNewKey: !!ttnApiKey,
    });

    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'save',
          org_id: orgId,
          enabled: ttnEnabled,
          cluster: ttnCluster,
          application_id: ttnApplicationId,
          api_key: ttnApiKey || undefined, // Only send if new value provided
          webhook_secret: ttnWebhookSecret || undefined,
        },
      });

      if (error) {
        const errorMsg = data?.error || error.message || 'Failed to save settings';
        debug.ttn('TTN_SETTINGS_SAVE_FAILURE', {
          error: errorMsg,
          code: data?.code || 'UNKNOWN_ERROR',
        });
        toast({
          title: 'Save Failed',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      if (data?.ok) {
        // Debug logging - success
        debug.ttn('TTN_SETTINGS_SAVE_SUCCESS', {
          updated_at: data.updated_at,
          apiKeyLast4_saved: data.api_key_last4 ? `****${data.api_key_last4}` : null,
          api_key_set: data.api_key_set,
        });

        // Update local state from response
        if (data.api_key_set !== undefined) {
          setTtnApiKeySet(data.api_key_set);
        }
        if (data.api_key_preview) {
          setTtnApiKeyPreview(data.api_key_preview);
        }
        if (data.webhook_secret_set !== undefined) {
          setTtnWebhookSecretSet(data.webhook_secret_set);
        }
        
        // Clear input fields after successful save (security)
        setTtnApiKey('');
        setTtnWebhookSecret('');
        
        // Update parent config with new last4 for cache key tracking
        updateTTN({ 
          enabled: ttnEnabled, 
          applicationId: ttnApplicationId, 
          cluster: ttnCluster,
          api_key_last4: data.api_key_last4,
          updated_at: data.updated_at,
        });

        // Show toast with new key last4
        const toastDescription = data.api_key_last4 
          ? `API key updated (****${data.api_key_last4})`
          : 'TTN configuration saved successfully';
        
        toast({
          title: 'Settings Saved',
          description: toastDescription,
        });
      } else {
        debug.ttn('TTN_SETTINGS_SAVE_FAILURE', {
          error: data?.error || 'Unknown error',
          code: data?.code,
        });
        toast({
          title: 'Save Failed',
          description: data?.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      debug.ttn('TTN_SETTINGS_SAVE_FAILURE', {
        error: err.message || 'Network error',
        code: 'NETWORK_ERROR',
      });
      toast({
        title: 'Save Error',
        description: err.message || 'Network error saving settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Test connection using stored API key (no key in request)
  const testTTNConnectionStored = async () => {
    if (!orgId) {
      toast({ title: 'No Organization', description: 'Select an organization first', variant: 'destructive' });
      return;
    }

    setIsTestingTTN(true);
    setTestResult(null);

    try {
      const requestBody = {
        action: 'test_stored' as const,
        org_id: orgId,
        // Note: Always test org's TTN settings, not user-specific
        // User selector is for context (org/site/unit selection)
      };

      console.log('[WebhookSettings] Testing TTN connection with:', {
        ...requestBody,
        ttnApplicationId: ttnApplicationId,
        ttnCluster: ttnCluster,
        configSelectedUserId: config.selectedUserId,
      });

      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: requestBody,
      });

      if (error) {
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

      const result: TTNTestResult = data;
      setTestResult(result);

      console.log('[WebhookSettings] Test result:', {
        ok: result.ok,
        connected: result.connected,
        application_id: result.application_id,
        cluster: result.cluster,
        expected_app: ttnApplicationId,
      });

      // Update connection status
      const now = new Date();
      setLastTestAt(now);

      if (result.ok && result.connected) {
        setLastTestSuccess(true);
        toast({
          title: 'TTN Connected',
          description: result.message || 'Successfully connected to The Things Network',
        });
        updateTTN({
          lastStatus: {
            code: 200,
            message: result.message || 'Connected',
            timestamp: now,
          },
          lastTestAt: now,
          lastTestSuccess: true,
        });
      } else {
        setLastTestSuccess(false);
        toast({
          title: 'TTN Test Failed',
          description: result.error || result.ttn_message || 'Unknown error',
          variant: 'destructive',
        });
        updateTTN({
          lastStatus: {
            code: result.ttn_status || 500,
            message: result.error || result.ttn_message || 'Unknown error',
            timestamp: now,
          },
          lastTestAt: now,
          lastTestSuccess: false,
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

  // Test connection with a new API key (key in request)
  const testTTNConnectionWithKey = async () => {
    if (!ttnApplicationId) {
      toast({ title: 'Missing Config', description: 'Enter TTN Application ID first', variant: 'destructive' });
      return;
    }

    if (!ttnApiKey) {
      toast({ title: 'Enter API Key', description: 'Enter your TTN API key to test the connection', variant: 'destructive' });
      return;
    }

    setIsTestingTTN(true);
    setTestResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test',
          org_id: orgId,
          cluster: ttnCluster,
          application_id: ttnApplicationId,
          api_key: ttnApiKey,
        },
      });

      if (error) {
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

      const result: TTNTestResult = data;
      setTestResult(result);

      console.log('[WebhookSettings] Test result:', {
        ok: result.ok,
        connected: result.connected,
        application_id: result.application_id,
        cluster: result.cluster,
        expected_app: ttnApplicationId,
      });

      // Update connection status
      const now = new Date();
      setLastTestAt(now);

      if (result.ok && result.connected) {
        setLastTestSuccess(true);
        toast({
          title: 'TTN Connected',
          description: result.message || 'Successfully connected to The Things Network',
        });
        updateTTN({
          lastStatus: {
            code: 200,
            message: result.message || 'Connected',
            timestamp: now,
          },
          lastTestAt: now,
          lastTestSuccess: true,
        });
      } else {
        setLastTestSuccess(false);
        toast({
          title: 'TTN Test Failed',
          description: result.error || result.ttn_message || 'Unknown error',
          variant: 'destructive',
        });
        updateTTN({
          lastStatus: {
            code: result.ttn_status || 500,
            message: result.error || result.ttn_message || 'Unknown error',
            timestamp: now,
          },
          lastTestAt: now,
          lastTestSuccess: false,
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

  // Main test connection handler - decides which method to use
  const handleTestConnection = () => {
    if (ttnApiKey) {
      // User entered a new key - test with that
      testTTNConnectionWithKey();
    } else if (ttnApiKeySet) {
      // No new key entered, but one is stored - test with stored key
      testTTNConnectionStored();
    } else {
      toast({ 
        title: 'No API Key', 
        description: 'Enter an API key and save before testing', 
        variant: 'destructive' 
      });
    }
  };

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const updateTTN = (updates: Partial<TTNConfig>) => {
    update({ ttnConfig: { ...ttnConfig, ...updates } });
  };

  // Format relative time for display
  const formatRelativeTime = (date: Date | string | null | undefined): string => {
    if (!date) return 'Never';
    
    // Handle string dates from JSON
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    // Validate it's a valid date
    if (isNaN(dateObj.getTime())) return 'Invalid date';
    
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return dateObj.toLocaleDateString();
  };

  // Auto-refresh connection status every 5 minutes
  useEffect(() => {
    if (!autoRefreshEnabled || !ttnEnabled || !ttnApiKeySet || !orgId) {
      return;
    }

    const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    const intervalId = setInterval(() => {
      console.log('[TTN] Auto-refreshing connection status...');
      testTTNConnectionStored();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [autoRefreshEnabled, ttnEnabled, ttnApiKeySet, orgId]);

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

    // Success case
    if (testResult.ok && testResult.connected) {
      return (
        <Alert className="border-green-500/50 bg-green-500/10">
          <ShieldCheck className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-600">Connected Successfully</AlertTitle>
          <AlertDescription className="text-sm space-y-1">
            <p>Application: <code className="bg-muted px-1 rounded">{testResult.application_id}</code></p>
            <p>Cluster: <code className="bg-muted px-1 rounded">{testResult.cluster}</code></p>
            <p>Endpoint: <code className="bg-muted px-1 rounded text-xs">{testResult.baseUrl}</code></p>
            {testResult.required_permissions && (
              <p className="text-xs text-muted-foreground">
                Required permissions: {testResult.required_permissions.join(', ')}
              </p>
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
          <p className="font-medium">{testResult.error}</p>
          {testResult.ttn_status && (
            <p>TTN Status: <Badge variant="destructive">{testResult.ttn_status}</Badge></p>
          )}
          {testResult.hint && (
            <p className="bg-background/50 rounded p-2 text-xs">{testResult.hint}</p>
          )}
          {testResult.cluster_hint && (
            <p className="bg-amber-500/10 border border-amber-500/30 rounded p-2 text-xs text-amber-700">
              {testResult.cluster_hint}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Request ID: {testResult.requestId}</p>
        </AlertDescription>
      </Alert>
    );
  };

  // Check if we can test connection
  const canTestConnection = !disabled && !isTestingTTN && ttnApplicationId && (ttnApiKey || ttnApiKeySet);
  
  // Check if we can save - allow saving if we have app ID and either a new key or an existing key
  const canSave = !disabled && !isSaving && orgId && (!ttnEnabled || (ttnApplicationId && (ttnApiKey || ttnApiKeySet)));

  return (
    <div className="space-y-4">
      {/* Setup Wizard Modal */}
      <TTNSetupWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        orgId={orgId}
        devices={devices}
        onComplete={handleWizardComplete}
        initialConfig={{
          cluster: ttnCluster,
          applicationId: ttnApplicationId,
        }}
      />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            TTN Integration
          </h3>
          <p className="text-sm text-muted-foreground">
            Route emulator data through The Things Network for production-ready testing
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowWizard(true)}
          className="gap-2"
        >
          <Wand2 className="h-4 w-4" />
          Guided Setup
        </Button>
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
                  <Label htmlFor="ttnApiKey" className="flex items-center gap-2">
                    API Key
                    {ttnApiKeySet && (
                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                        Saved
                      </Badge>
                    )}
                  </Label>
                  <Input
                    id="ttnApiKey"
                    type="password"
                    placeholder={ttnApiKeySet ? "Enter new key to replace..." : "NNSXS.XXXXXXX..."}
                    value={ttnApiKey}
                    onChange={e => setTtnApiKey(e.target.value)}
                    disabled={disabled || isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ttnApiKeySet 
                      ? `Current: ${ttnApiKeyPreview} (leave blank to keep, enter new to replace)` 
                      : 'From TTN Console → API keys'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ttnWebhookSecret" className="flex items-center gap-2">
                    Webhook Secret (optional)
                    {ttnWebhookSecretSet && (
                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                        Saved
                      </Badge>
                    )}
                  </Label>
                  <Input
                    id="ttnWebhookSecret"
                    type="password"
                    placeholder={ttnWebhookSecretSet ? "Enter new to replace..." : "Optional"}
                    value={ttnWebhookSecret}
                    onChange={e => setTtnWebhookSecret(e.target.value)}
                    disabled={disabled || isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    For webhook signature verification
                  </p>
                </div>
              </div>

              {/* TTN Connection Status Indicator */}
              {ttnApiKeySet && (
                <TooltipProvider>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                    <div className="flex items-center gap-3">
                      {/* Status Icon */}
                      {lastTestSuccess === null ? (
                        <div className="h-3 w-3 rounded-full bg-gray-400" />
                      ) : lastTestSuccess ? (
                        <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                      ) : (
                        <div className="h-3 w-3 rounded-full bg-red-500" />
                      )}
                      
                      {/* Status Text */}
                      <div className="text-sm">
                        {lastTestSuccess === null ? (
                          <span className="text-muted-foreground">Not tested yet</span>
                        ) : lastTestSuccess ? (
                          <span className="text-green-600 font-medium">Connected</span>
                        ) : (
                          <span className="text-red-600 font-medium">Disconnected</span>
                        )}
                      </div>
                      
                      {/* Last Test Timestamp */}
                      {lastTestAt && (
                        <span className="text-xs text-muted-foreground">
                          Last checked: {formatRelativeTime(lastTestAt)}
                        </span>
                      )}
                    </div>
                    
                    {/* Auto-refresh indicator and manual refresh button */}
                    <div className="flex items-center gap-2">
                      {autoRefreshEnabled && ttnEnabled && ttnApiKeySet && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs gap-1 cursor-help">
                              <RefreshCw className="h-3 w-3" />
                              Auto
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Connection status refreshes every 5 minutes</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={!canTestConnection}
                        className="gap-1"
                      >
                        {isTestingTTN ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Refresh
                      </Button>
                    </div>
                  </div>
                </TooltipProvider>
              )}

              {/* Test Result Diagnostics */}
              {renderTestDiagnostics()}

              {/* TTN Device Registration Notice */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                  <div className="text-sm space-y-2">
                    <p className="font-medium text-blue-700">Device Registration Required</p>
                    <p className="text-xs text-muted-foreground">
                      Register the device in TTN Console using the DevEUI before uplinks will work.
                      Devices are NOT auto-created — "Pending Provisioning" is expected until registration.
                    </p>
                  </div>
                </div>
                
                {currentDevEui && (
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
                )}
              </div>

              {/* Action Buttons */}
              <div className="border-t pt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={!canTestConnection}
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
                  disabled={!canSave}
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

              {ttnEnabled && (!ttnApplicationId || (!ttnApiKey && !ttnApiKeySet)) && (
                <p className="text-xs text-amber-600">
                  {!ttnApplicationId 
                    ? 'Enter Application ID to save settings'
                    : 'Enter API Key and save to enable TTN integration'}
                </p>
              )}

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
