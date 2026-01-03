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
  Radio, Cloud, AlertCircle, ShieldCheck, ShieldX, Save, Info, Wand2, RefreshCw,
  Globe, ArrowRightLeft, HardDrive, Clock, KeyRound
} from 'lucide-react';
import { getGatewayApiKeyUrl, getGatewayKeyInstructions, getKeyTypeLabel, GATEWAY_PERMISSIONS, parseOrgFromUrl } from '@/lib/ttnConsoleLinks';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WebhookConfig, TTNConfig, buildTTNPayload, createDevice, createGateway, LoRaWANDevice } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { debug } from '@/lib/debugLogger';
import { setCanonicalConfig, getCanonicalConfig, markLocalDirty, subscribeToConfigChanges, getConfigSummary } from '@/lib/ttnConfigStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TTNSetupWizard, { WizardConfig } from './TTNSetupWizard';

// TTN Config Source Badge Component
interface ConfigSourceBadgeProps {
  source: string;
  localDirty: boolean;
  updatedAt: string | null;
  apiKeyLast4: string | null;
}

function TTNConfigSourceBadge({ source, localDirty, updatedAt, apiKeyLast4 }: ConfigSourceBadgeProps) {
  // Format relative time
  const formatRelativeTime = (timestamp: string | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Derive badge display based on source and dirty state
  const getBadgeConfig = () => {
    if (localDirty) {
      return {
        label: 'Local (pending)',
        variant: 'secondary' as const,
        icon: Clock,
        tooltip: 'Recently saved locally, not yet confirmed synced to FrostGuard',
        className: 'bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20',
      };
    }
    
    if (source.startsWith('LOCAL') || source === 'LOCAL_CACHE') {
      return {
        label: 'Local',
        variant: 'secondary' as const,
        icon: HardDrive,
        tooltip: 'Using locally saved configuration',
        className: 'bg-blue-500/15 text-blue-700 border-blue-500/30 hover:bg-blue-500/20',
      };
    }
    
    if (source.startsWith('FROSTGUARD') || source === 'FROSTGUARD_CANONICAL') {
      return {
        label: 'Synced',
        variant: 'default' as const,
        icon: Cloud,
        tooltip: 'Synced from FrostGuard',
        className: 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/20',
      };
    }
    
    return {
      label: 'Not Set',
      variant: 'outline' as const,
      icon: AlertCircle,
      tooltip: 'No TTN configuration found',
      className: 'text-muted-foreground',
    };
  };

  const config = getBadgeConfig();
  const IconComponent = config.icon;
  const timeString = formatRelativeTime(updatedAt);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={config.variant} 
            className={`gap-1.5 text-xs font-medium cursor-help ${config.className}`}
          >
            <IconComponent className="h-3 w-3" />
            {config.label}
            {timeString && <span className="opacity-70">• {timeString}</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p>{config.tooltip}</p>
          {apiKeyLast4 && (
            <p className="text-xs text-muted-foreground mt-1">
              Key: ****{apiKeyLast4}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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

interface PermissionStatus {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  granted: boolean;
}

interface PermissionCheckResult {
  ok: boolean;
  permissions?: PermissionStatus[];
  missing?: string[];
  can_simulate?: boolean;
  hint?: string;
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
  // Gateway-specific API key (Personal/Organization key with gateway rights)
  const [gatewayApiKey, setGatewayApiKey] = useState('');
  const [gatewayApiKeyPreview, setGatewayApiKeyPreview] = useState<string | null>(null);
  const [gatewayApiKeySet, setGatewayApiKeySet] = useState(false);
  // Gateway owner config
  const [gatewayOwnerType, setGatewayOwnerType] = useState<'user' | 'organization'>('user');
  const [gatewayOwnerId, setGatewayOwnerId] = useState('');
  const [ttnWebhookSecretSet, setTtnWebhookSecretSet] = useState(false);
  
  // Connection status tracking
  const [lastTestAt, setLastTestAt] = useState<Date | string | null>(null);
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  
  // Test result state
  const [testResult, setTestResult] = useState<TTNTestResult | null>(null);
  
  // Permission check state
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(false);
  const [permissionResult, setPermissionResult] = useState<PermissionCheckResult | null>(null);
  
  // Cluster detection state
  const [detectedCluster, setDetectedCluster] = useState<string | null>(null);
  const [consoleUrlInput, setConsoleUrlInput] = useState('');
  const [showClusterDetect, setShowClusterDetect] = useState(false);
  
  // Org URL paste helper state
  const [orgUrlInput, setOrgUrlInput] = useState('');
  const [showOrgUrlInput, setShowOrgUrlInput] = useState(false);
  
  // Gateway key testing state
  const [isTestingGatewayKey, setIsTestingGatewayKey] = useState(false);
  const [gatewayKeyTestResult, setGatewayKeyTestResult] = useState<{
    ok: boolean;
    message: string;
    permissions?: { gateway_read: boolean; gateway_write: boolean };
  } | null>(null);
  
  // Config source tracking for badge display
  const [configSource, setConfigSource] = useState(() => getConfigSummary());
  
  // Subscribe to config changes for badge updates
  useEffect(() => {
    const unsubscribe = subscribeToConfigChanges(() => {
      setConfigSource(getConfigSummary());
    });
    return unsubscribe;
  }, []);

  // Parse cluster from TTN Console URL
  const parseClusterFromUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      // Match nam1.cloud.thethings.network or console.nam1... patterns
      const match = host.match(/^(?:console\.)?(nam1|eu1|au1)\.cloud\.thethings\.network$/);
      if (match) return match[1];
    } catch {
      // Invalid URL
    }
    return null;
  };

  const handleDetectCluster = () => {
    if (!consoleUrlInput) return;
    const detected = parseClusterFromUrl(consoleUrlInput);
    if (detected) {
      setDetectedCluster(detected);
      if (detected !== ttnCluster) {
        debug.ttnPreflight('TTN_CLUSTER_MISMATCH_DETECTED', {
          configured: ttnCluster,
          detected,
          console_url: consoleUrlInput.slice(0, 50),
        });
      }
    } else {
      toast({
        title: 'Could not detect cluster',
        description: 'Paste a valid TTN Console URL like https://nam1.cloud.thethings.network/...',
        variant: 'destructive',
      });
    }
    setShowClusterDetect(false);
    setConsoleUrlInput('');
  };

  const handleSwitchCluster = (newCluster: string) => {
    setTtnCluster(newCluster);
    setDetectedCluster(null);
    toast({
      title: 'Cluster Updated',
      description: `Switched to ${newCluster}. Don't forget to save settings.`,
    });
  };

  const clusterMismatch = detectedCluster && detectedCluster !== ttnCluster;

  // Parse org ID from TTN Console URL
  const handleParseOrgUrl = () => {
    if (!orgUrlInput) return;
    const parsed = parseOrgFromUrl(orgUrlInput);
    if (parsed) {
      setGatewayOwnerId(parsed.orgId);
      setGatewayOwnerType('organization');
      if (parsed.cluster !== ttnCluster) {
        setTtnCluster(parsed.cluster);
      }
      toast({
        title: 'Organization ID Detected',
        description: `Set to "${parsed.orgId}" on ${parsed.cluster} cluster`,
      });
    } else {
      toast({
        title: 'Could not parse URL',
        description: 'Paste a valid TTN Console URL like https://nam1.cloud.thethings.network/console/organizations/my-org/...',
        variant: 'destructive',
      });
    }
    setShowOrgUrlInput(false);
    setOrgUrlInput('');
  };

  // Test gateway API key immediately
  const testGatewayKey = async () => {
    if (!orgId) {
      toast({
        title: 'No Organization',
        description: 'Select an organization first',
        variant: 'destructive',
      });
      return;
    }

    // Validate key format if a new one is being entered
    const keyToTest = gatewayApiKey || (gatewayApiKeySet ? 'stored' : '');
    if (!keyToTest) {
      toast({
        title: 'No Gateway Key',
        description: 'Enter a Gateway API Key first',
        variant: 'destructive',
      });
      return;
    }

    if (gatewayApiKey && !gatewayApiKey.startsWith('NNSXS.') && !gatewayApiKey.startsWith('nnsxs.')) {
      setGatewayKeyTestResult({
        ok: false,
        message: 'Invalid key format - TTN API keys start with "NNSXS."',
      });
      return;
    }

    setIsTestingGatewayKey(true);
    setGatewayKeyTestResult(null);

    try {
      // If we have a new key, save it first
      if (gatewayApiKey) {
        await supabase.functions.invoke('manage-ttn-settings', {
          body: {
            action: 'save',
            org_id: orgId,
            gateway_api_key: gatewayApiKey,
            gateway_owner_type: gatewayOwnerType,
            gateway_owner_id: gatewayOwnerId,
          },
        });
        setGatewayApiKeyPreview(`****${gatewayApiKey.slice(-4)}`);
        setGatewayApiKeySet(true);
        setGatewayApiKey('');
      }

      // Now test the stored key
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_gateway_permissions',
          org_id: orgId,
          cluster: ttnCluster,
        },
      });

      if (error) {
        setGatewayKeyTestResult({
          ok: false,
          message: `Test failed: ${error.message}`,
        });
        return;
      }

      if (data?.ok) {
        setGatewayKeyTestResult({
          ok: true,
          message: 'Gateway permissions verified ✓',
          permissions: data.permissions,
        });
        toast({
          title: 'Gateway Key Valid',
          description: 'Key has gateways:read and gateways:write permissions',
        });
      } else {
        setGatewayKeyTestResult({
          ok: false,
          message: data?.hint || data?.error || 'Permission check failed',
          permissions: data?.permissions,
        });
      }
    } catch (err: any) {
      setGatewayKeyTestResult({
        ok: false,
        message: `Error: ${err.message}`,
      });
    } finally {
      setIsTestingGatewayKey(false);
    }
  };

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
        if (wizardConfig.webhookSecret) {
          update({ ttnWebhookSecret: wizardConfig.webhookSecret });
        }
        
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
      // Load gateway API key if available
      const gwKeyLast4 = (config.ttnConfig as any).gateway_api_key_last4;
      setGatewayApiKeyPreview(gwKeyLast4 ? `****${gwKeyLast4}` : null);
      setGatewayApiKeySet(!!gwKeyLast4);
      // Don't load actual secrets from config
      setTtnApiKey('');
      setTtnWebhookSecret('');
      setGatewayApiKey('');

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
        // Load gateway API key if available
        setGatewayApiKeyPreview(ttn.gateway_api_key_last4 ? `****${ttn.gateway_api_key_last4}` : null);
        setGatewayApiKeySet(!!(ttn.gateway_api_key_last4));
        // Don't load actual secrets, just show preview
        setTtnApiKey(''); // Reset to empty, user must enter new value to change
        setTtnWebhookSecret('');
        setGatewayApiKey('');

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

        if (ttn.webhook_secret) {
          update({ ttnWebhookSecret: ttn.webhook_secret });
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

    // Validate gateway API key format if provided
    if (gatewayApiKey) {
      if (!gatewayApiKey.startsWith('NNSXS.') && !gatewayApiKey.startsWith('nnsxs.')) {
        toast({
          title: 'Invalid Gateway API Key Format',
          description: 'TTN API keys should start with "NNSXS."',
          variant: 'destructive',
        });
        return;
      }
      if (gatewayApiKey.length < 50) {
        toast({
          title: 'Gateway API Key Too Short',
          description: 'TTN API keys are typically 100+ characters',
          variant: 'destructive',
        });
        return;
      }
    }

    setIsSaving(true);
    
    // Debug logging - request
    const apiKeyLast4New = ttnApiKey ? ttnApiKey.slice(-4) : null;
    const gatewayApiKeyLast4New = gatewayApiKey ? gatewayApiKey.slice(-4) : null;
    debug.ttnSync('TTN_SAVE_REQUEST', {
      orgId,
      cluster: ttnCluster,
      appId: ttnApplicationId,
      apiKeyLast4_new: apiKeyLast4New ? `****${apiKeyLast4New}` : null,
      hasNewKey: !!ttnApiKey,
      gatewayApiKeyLast4_new: gatewayApiKeyLast4New ? `****${gatewayApiKeyLast4New}` : null,
      hasNewGatewayKey: !!gatewayApiKey,
    });

    try {
      // Step 1: Push settings to FrostGuard via new edge function
      debug.ttnSync('TTN_PUSH_TO_FROSTGUARD_START', {
        orgId,
        userId: config.selectedUserId,
        cluster: ttnCluster,
        application_id: ttnApplicationId,
        has_api_key: !!ttnApiKey,
        has_gateway_api_key: !!gatewayApiKey,
      });

      const { data: pushResult, error: pushError } = await supabase.functions.invoke('push-ttn-settings', {
        body: {
          org_id: orgId,
          user_id: config.selectedUserId || undefined, // Include user_id to update synced_users.ttn
          enabled: ttnEnabled,
          cluster: ttnCluster,
          application_id: ttnApplicationId,
          api_key: ttnApiKey || undefined, // Only send if new value provided
          gateway_api_key: gatewayApiKey || undefined, // Gateway-specific key for provisioning
          webhook_secret: ttnWebhookSecret || undefined,
          gateway_owner_type: gatewayOwnerType,
          gateway_owner_id: gatewayOwnerId || undefined,
        },
      });

      if (pushError || !pushResult?.ok) {
        const errorMsg = pushResult?.error || pushError?.message || 'Failed to save settings';
        debug.ttnSync('TTN_PUSH_FAILED', {
          error: errorMsg,
          error_code: pushResult?.error_code,
          step: pushResult?.step,
          request_id: pushResult?.request_id,
        });
        toast({
          title: 'Save Failed',
          description: pushResult?.hint || errorMsg,
          variant: 'destructive',
        });
        return;
      }

      // Log push success (local-only save now)
      debug.ttnSync('TTN_PUSH_SUCCESS', {
        request_id: pushResult.request_id,
        api_key_last4: pushResult.api_key_last4 ? `****${pushResult.api_key_last4}` : null,
        gateway_api_key_last4: pushResult.gateway_api_key_last4 ? `****${pushResult.gateway_api_key_last4}` : null,
        updated_at: pushResult.updated_at,
        local_updated: pushResult.local_updated,
        user_ttn_updated: pushResult.user_ttn_updated,
        frostguard_skipped: pushResult.frostguard_skipped,
      });

      // IMPORTANT: Use the LOCAL save result as canonical truth, NOT FrostGuard
      // FrostGuard may have stale data since we're doing local-only saves
      const savedApiKeyLast4 = pushResult.api_key_last4;
      const savedGatewayApiKeyLast4 = pushResult.gateway_api_key_last4;
      const savedUpdatedAt = pushResult.updated_at || new Date().toISOString();

      // Update local state immediately from push result
      if (savedApiKeyLast4) {
        setTtnApiKeyPreview(`****${savedApiKeyLast4}`);
        setTtnApiKeySet(true);
        debug.ttnSync('TTN_KEY_UPDATED_FROM_SAVE', {
          api_key_last4: `****${savedApiKeyLast4}`,
          source: 'LOCAL_SAVE_RESULT',
        });
      }

      // Update gateway API key state
      if (savedGatewayApiKeyLast4) {
        setGatewayApiKeyPreview(`****${savedGatewayApiKeyLast4}`);
        setGatewayApiKeySet(true);
        debug.ttnSync('TTN_GATEWAY_KEY_UPDATED_FROM_SAVE', {
          gateway_api_key_last4: `****${savedGatewayApiKeyLast4}`,
          source: 'LOCAL_SAVE_RESULT',
        });
      }

      // Update parent config with saved values (NOT from FrostGuard pull)
      updateTTN({ 
        enabled: ttnEnabled, 
        applicationId: ttnApplicationId, 
        cluster: ttnCluster,
        api_key_last4: savedApiKeyLast4 || undefined,
        updated_at: savedUpdatedAt,
      });
      if (ttnWebhookSecret) {
        update({ ttnWebhookSecret });
      }

      // Update centralized TTN config store with LOCAL saved values
      setCanonicalConfig({
        enabled: ttnEnabled,
        cluster: ttnCluster,
        applicationId: ttnApplicationId,
        apiKeyLast4: savedApiKeyLast4 || null,
        webhookSecretLast4: null, // We don't track webhook secret last4 from local save
        updatedAt: savedUpdatedAt,
        source: 'LOCAL_CACHE', // Mark as local since FrostGuard sync is skipped
        orgId,
        userId: config.selectedUserId || null,
        localDirty: true, // Mark as dirty to prevent canonical overwrite
        localSavedAt: savedUpdatedAt,
      });

      // Also mark dirty via dedicated function (ensures proper logging)
      if (savedApiKeyLast4) {
        markLocalDirty(savedApiKeyLast4);
      }

      debug.ttnSync('TTN_CONFIG_SOURCE', {
        source: 'LOCAL_SAVE_RESULT',
        api_key_last4: savedApiKeyLast4 ? `****${savedApiKeyLast4}` : null,
        cluster: ttnCluster,
        application_id: ttnApplicationId,
        localDirty: true,
      });

      // Show success toast with the NEW key
      toast({ 
        title: 'Settings Saved', 
        description: savedApiKeyLast4 
          ? `Saved (****${savedApiKeyLast4})`
          : 'TTN configuration saved',
      });

      // Clear sensitive input fields after successful save
      setTtnApiKey('');
      setTtnWebhookSecret('');
      setGatewayApiKey('');

      // Also clear any stale localStorage TTN cache
      localStorage.removeItem('lorawan-emulator-ttn-cache');

    } catch (err: any) {
      debug.ttnSync('TTN_SAVE_ERROR', {
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

  // Check API key permissions
  const checkPermissions = async () => {
    if (!orgId) {
      toast({ title: 'No Organization', description: 'Select an organization first', variant: 'destructive' });
      return;
    }

    if (!ttnApiKeySet && !ttnApiKey) {
      toast({ title: 'No API Key', description: 'Enter or save an API key first', variant: 'destructive' });
      return;
    }

    setIsCheckingPermissions(true);
    setPermissionResult(null);

    try {
      // If user entered a new key, use it directly; otherwise use stored key via test_stored first
      let apiKeyToUse = ttnApiKey;
      
      if (!apiKeyToUse && ttnApiKeySet) {
        // We need to call a different endpoint that loads the stored key
        // For now, just call check_app_permissions and let backend load stored key
        // Actually, check_app_permissions requires api_key - we'll need to call test_stored first
        // Let's just do the test and then permissions in one go
        toast({ 
          title: 'Permission Check', 
          description: 'Use "Test Connection" which includes permission checking', 
        });
        setIsCheckingPermissions(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_app_permissions',
          cluster: ttnCluster,
          application_id: ttnApplicationId,
          api_key: apiKeyToUse,
        },
      });

      if (error) {
        setPermissionResult({ ok: false, hint: error.message });
        toast({ title: 'Permission Check Failed', description: error.message, variant: 'destructive' });
        return;
      }

      const result: PermissionCheckResult = data;
      setPermissionResult(result);

      if (result.ok) {
        toast({ 
          title: 'All Permissions Granted', 
          description: result.can_simulate ? 'Ready for simulation!' : 'Connected successfully',
        });
      } else {
        toast({
          title: 'Missing Permissions',
          description: result.missing?.join(', ') || 'Some permissions are missing',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      setPermissionResult({ ok: false, hint: err.message });
      toast({ title: 'Check Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsCheckingPermissions(false);
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
          credentials: 'omit',
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

  // Render permission status
  const renderPermissionStatus = () => {
    if (!permissionResult?.permissions) return null;

    return (
      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">API Key Permissions</Label>
          {permissionResult.can_simulate ? (
            <Badge variant="outline" className="text-green-600 border-green-200">
              <Check className="h-3 w-3 mr-1" />
              Simulation Ready
            </Badge>
          ) : (
            <Badge variant="destructive">
              <X className="h-3 w-3 mr-1" />
              Missing Permissions
            </Badge>
          )}
        </div>
        <div className="grid gap-1.5">
          {permissionResult.permissions.map((perm) => (
            <div key={perm.key} className="flex items-center gap-2 text-sm">
              {perm.granted ? (
                <Check className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <X className="h-4 w-4 text-destructive shrink-0" />
              )}
              <span className={perm.granted ? 'text-muted-foreground' : 'text-destructive'}>
                {perm.label}
              </span>
              {!perm.granted && (
                <Badge variant="destructive" className="text-xs">Missing</Badge>
              )}
            </div>
          ))}
        </div>
        {permissionResult.hint && (
          <p className="text-xs bg-background/50 p-2 rounded">{permissionResult.hint}</p>
        )}
      </div>
    );
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
            <TTNConfigSourceBadge 
              source={configSource.source}
              localDirty={configSource.localDirty}
              updatedAt={configSource.updatedAt || configSource.localSavedAt}
              apiKeyLast4={configSource.apiKeyLast4}
            />
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
              {/* Cluster Mismatch Warning */}
              {clusterMismatch && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Cluster Mismatch Detected</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      Your TTN Console is on <code className="bg-background px-1 rounded">{detectedCluster}</code> but 
                      Emulator is set to <code className="bg-background px-1 rounded">{ttnCluster}</code>.
                      Uplinks will be dropped with "Entity not found".
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">{ttnCluster}</Badge>
                      <ArrowRightLeft className="h-4 w-4" />
                      <Badge variant="secondary">{detectedCluster}</Badge>
                    </div>
                    <Button 
                      size="sm" 
                      variant="secondary"
                      className="mt-2"
                      onClick={() => handleSwitchCluster(detectedCluster)}
                    >
                      Switch to {detectedCluster}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Active TTN Host Display */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Active TTN Host</span>
                </div>
                <code className="text-sm font-mono">{ttnCluster}.cloud.thethings.network</code>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ttnCluster">TTN Cluster</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowClusterDetect(!showClusterDetect)}
                    >
                      Detect from URL
                    </Button>
                  </div>
                  <Select
                    value={ttnCluster}
                    onValueChange={(v) => {
                      setTtnCluster(v);
                      setDetectedCluster(null); // Clear mismatch when manually changed
                    }}
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
                  {showClusterDetect && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Paste TTN Console URL..."
                        value={consoleUrlInput}
                        onChange={(e) => setConsoleUrlInput(e.target.value)}
                        className="text-xs"
                      />
                      <Button size="sm" onClick={handleDetectCluster}>
                        Detect
                      </Button>
                    </div>
                  )}
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

              {/* Gateway Owner Configuration */}
              <div className="pt-4 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">Gateway Owner (for provisioning)</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Gateways in TTN are owned by users or organizations. Set your TTN username or org ID to provision gateways.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {gatewayOwnerType === 'organization' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowOrgUrlInput(!showOrgUrlInput)}
                    >
                      Paste TTN URL
                    </Button>
                  )}
                </div>
                
                {/* URL paste helper for auto-parsing org ID */}
                {showOrgUrlInput && (
                  <div className="flex gap-2 p-3 bg-muted/50 rounded-lg">
                    <Input
                      placeholder="Paste TTN Console URL (e.g., https://nam1.cloud.thethings.network/console/organizations/my-org/...)"
                      value={orgUrlInput}
                      onChange={(e) => setOrgUrlInput(e.target.value)}
                      className="text-xs"
                    />
                    <Button size="sm" onClick={handleParseOrgUrl} disabled={!orgUrlInput}>
                      Parse
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowOrgUrlInput(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gatewayOwnerType">Owner Type</Label>
                    <Select
                      value={gatewayOwnerType}
                      onValueChange={(v) => setGatewayOwnerType(v as 'user' | 'organization')}
                      disabled={disabled || isLoading}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">Personal (User)</SelectItem>
                        <SelectItem value="organization">Organization</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gatewayOwnerId">
                      {gatewayOwnerType === 'organization' ? 'Organization ID' : 'TTN Username'}
                    </Label>
                    <Input
                      id="gatewayOwnerId"
                      placeholder={gatewayOwnerType === 'organization' ? 'my-org' : 'my-username'}
                      value={gatewayOwnerId}
                      onChange={e => setGatewayOwnerId(e.target.value)}
                      disabled={disabled || isLoading}
                    />
                    <p className="text-xs text-muted-foreground">
                      Required for gateway provisioning.
                    </p>
                  </div>
                </div>

                {/* Gateway API Key - separate from Application API Key */}
                <div className="space-y-2 mt-4">
                  <Label htmlFor="gatewayApiKey" className="flex items-center gap-2">
                    Gateway API Key
                    {gatewayApiKeySet && (
                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                        Saved
                      </Badge>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-medium mb-1">Personal or Organization API Key</p>
                          <p className="text-xs">Application API keys cannot have gateway permissions. You need a Personal or Organization API key with gateways:read and gateways:write rights.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="gatewayApiKey"
                      type="password"
                      placeholder={gatewayApiKeySet ? "Enter new key to replace..." : "NNSXS.XXXXXXX... (Personal/Org key with gateway rights)"}
                      value={gatewayApiKey}
                      onChange={e => {
                        setGatewayApiKey(e.target.value);
                        setGatewayKeyTestResult(null); // Clear previous result when typing
                      }}
                      disabled={disabled || isLoading}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testGatewayKey}
                      disabled={disabled || isLoading || isTestingGatewayKey || (!gatewayApiKey && !gatewayApiKeySet) || !gatewayOwnerId}
                      className="shrink-0"
                    >
                      {isTestingGatewayKey ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      Test
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {gatewayApiKeySet
                      ? `Current: ${gatewayApiKeyPreview} (leave blank to keep, enter new to replace)`
                      : 'Personal/Organization API key with gateways:read + gateways:write rights. NOT an Application API key.'}
                  </p>
                  
                  {/* Gateway Key Test Result */}
                  {gatewayKeyTestResult && (
                    <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                      gatewayKeyTestResult.ok 
                        ? 'bg-green-500/10 text-green-700 border border-green-500/30' 
                        : 'bg-red-500/10 text-red-700 border border-red-500/30'
                    }`}>
                      {gatewayKeyTestResult.ok ? (
                        <Check className="h-4 w-4 shrink-0" />
                      ) : (
                        <X className="h-4 w-4 shrink-0" />
                      )}
                      <span className="flex-1">{gatewayKeyTestResult.message}</span>
                      {gatewayKeyTestResult.permissions && (
                        <div className="flex gap-1">
                          <Badge variant="outline" className={gatewayKeyTestResult.permissions.gateway_read ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'}>
                            read
                          </Badge>
                          <Badge variant="outline" className={gatewayKeyTestResult.permissions.gateway_write ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'}>
                            write
                          </Badge>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Info box about API key types with Create in TTN Console button */}
                {!gatewayApiKeySet && (
                  <Alert className="bg-amber-500/10 border-amber-500/30">
                    <KeyRound className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-700 text-sm">Gateway API Key Required</AlertTitle>
                    <AlertDescription className="text-xs space-y-3">
                      <p className="text-muted-foreground">
                        To provision gateways, you need a <strong>{getKeyTypeLabel(gatewayOwnerType)}</strong> with gateway rights.
                        Application API keys only work for devices.
                      </p>
                      
                      {/* Step-by-step instructions */}
                      <div className="bg-background/50 rounded-lg p-3 space-y-2">
                        <p className="font-medium text-foreground text-xs">Steps to create:</p>
                        <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                          {getGatewayKeyInstructions(gatewayOwnerType).map((step, i) => (
                            <li key={i} className="text-xs">{step}</li>
                          ))}
                        </ol>
                        <div className="flex items-center gap-2 pt-2">
                          <span className="text-xs text-muted-foreground">Required permissions:</span>
                          {GATEWAY_PERMISSIONS.map(perm => (
                            <Badge key={perm} variant="outline" className="text-xs font-mono">
                              {perm}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      {/* Create in TTN Console button */}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-2 w-full"
                        onClick={() => {
                          const url = getGatewayApiKeyUrl(ttnCluster, gatewayOwnerType, gatewayOwnerId || undefined);
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        disabled={gatewayOwnerType === 'organization' && !gatewayOwnerId}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Create {getKeyTypeLabel(gatewayOwnerType)} in TTN Console
                      </Button>
                      {gatewayOwnerType === 'organization' && !gatewayOwnerId && (
                        <p className="text-xs text-amber-600">Enter Organization ID above to enable this button</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
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

              {/* Permission Status */}
              {renderPermissionStatus()}

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
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkPermissions}
                    disabled={!canTestConnection || isCheckingPermissions}
                    className="flex items-center gap-1"
                  >
                    {isCheckingPermissions ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Check Permissions
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
