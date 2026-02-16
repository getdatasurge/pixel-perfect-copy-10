import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Webhook, TestTube, Check, X, Loader2, Copy, ExternalLink, 
  Radio, Cloud, AlertCircle, ShieldCheck, ShieldX, Save, Info, Wand2, RefreshCw,
  Globe, ArrowRightLeft, HardDrive, Clock, KeyRound, CheckCircle2, ChevronDown, Bug, CloudDownload,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
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

// Source tracking type for TTN configuration
type TTNConfigSource = 'user' | 'org' | 'not_set';

// Resolved TTN config with source tracking for each field
interface ResolvedTTNConfig {
  cluster: string;
  cluster_source: TTNConfigSource;
  application_id: string;
  application_id_source: TTNConfigSource;
  api_key_last4: string | null;
  api_key_source: TTNConfigSource;
  gateway_api_key_last4: string | null;
  gateway_api_key_source: TTNConfigSource;
  webhook_secret_last4: string | null;
  webhook_secret_source: TTNConfigSource;
  gateway_owner_type: 'user' | 'organization' | null;
  gateway_owner_id: string | null;
  gateway_owner_source: TTNConfigSource;
  
  // Flag for FrostGuard sync badge
  gateway_api_key_from_frostguard: boolean;
  
  // Raw data for diagnostics
  raw_user_ttn: Record<string, unknown> | null;
  raw_org_settings: Record<string, unknown> | null;
  resolved_at: string;
}

// CurrentValueBadge - Reusable component for showing "Current:" values consistently
interface CurrentValueBadgeProps {
  value: string | null | undefined;
  isMasked?: boolean;
  label?: string;
  source?: TTNConfigSource;
}

function CurrentValueBadge({ value, isMasked, label, source }: CurrentValueBadgeProps) {
  if (!value) return null;
  
  const displayValue = isMasked ? `****${value.replace(/^\*+/, '')}` : value;
  
  // Source badge styling
  const sourceBadge = source && source !== 'not_set' ? (
    <span className={cn(
      "text-[10px] px-1 py-0.5 rounded font-medium ml-1",
      source === 'user' ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
    )}>
      {source === 'user' ? 'User' : 'Org'}
    </span>
  ) : null;
  
  return (
    <span className="text-xs text-muted-foreground flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3 text-green-500" />
      {label || 'Current:'} {displayValue}
      {sourceBadge}
    </span>
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
  const autoSyncDoneRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [copiedDevEui, setCopiedDevEui] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  
  // Local form state for TTN settings
  const [ttnEnabled, setTtnEnabled] = useState(false);
  const [ttnCluster, setTtnCluster] = useState<string>('nam1');
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
  
  // Canonical values from FrostGuard (source of truth for "Current:" display)
  const [canonicalCluster, setCanonicalCluster] = useState<string | null>(null);
  const [canonicalApplicationId, setCanonicalApplicationId] = useState<string | null>(null);
  const [canonicalApiKeyLast4, setCanonicalApiKeyLast4] = useState<string | null>(null);
  const [canonicalOwnerType, setCanonicalOwnerType] = useState<'user' | 'organization' | null>(null);
  const [canonicalOwnerId, setCanonicalOwnerId] = useState<string | null>(null);
  const [canonicalWebhookSecretLast4, setCanonicalWebhookSecretLast4] = useState<string | null>(null);
  const [canonicalGatewayApiKeyLast4, setCanonicalGatewayApiKeyLast4] = useState<string | null>(null);
  const [canonicalLastSyncAt, setCanonicalLastSyncAt] = useState<string | null>(null);
  const [isRefreshingCanonical, setIsRefreshingCanonical] = useState(false);
  
  // Resolved config with source tracking (for diagnostics and "Current:" display)
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedTTNConfig | null>(null);
  
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

  // Clear local draft state when user changes to prevent stale data
  useEffect(() => {
    // Reset all form fields to empty
    setTtnApiKey('');
    setTtnWebhookSecret('');
    setGatewayApiKey('');
    
    // Reset resolved config - it will be repopulated by loadSettings
    setResolvedConfig(null);
    
    // Reset test results
    setTestResult(null);
    setPermissionResult(null);
    setGatewayKeyTestResult(null);
    
    console.log('[WebhookSettings] User switched, cleared draft state:', config.selectedUserId);
  }, [config.selectedUserId]);

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
        
        // If owner was auto-discovered, update form fields and save
        if (data.discovered && data.discovered_owner_id) {
          console.log('[WebhookSettings] Auto-discovered gateway owner:', data.discovered_owner_type, data.discovered_owner_id);
          setGatewayOwnerType(data.discovered_owner_type);
          setGatewayOwnerId(data.discovered_owner_id);
          
          // Auto-save the discovered owner to ttn_settings
          const { error: saveError } = await supabase.functions.invoke('manage-ttn-settings', {
            body: {
              action: 'save',
              org_id: orgId,
              gateway_owner_type: data.discovered_owner_type,
              gateway_owner_id: data.discovered_owner_id,
            },
          });
          
          if (!saveError) {
            toast({
              title: 'Gateway Owner Discovered',
              description: `Auto-detected TTN ${data.discovered_owner_type}: ${data.discovered_owner_id}`,
            });
          }
        }
      } else {
        // Check if discovery found something even if permissions failed
        if (data?.discovered && data?.discovered_owner_id) {
          console.log('[WebhookSettings] Discovered owner but permissions failed:', data.discovered_owner_type, data.discovered_owner_id);
          setGatewayOwnerType(data.discovered_owner_type);
          setGatewayOwnerId(data.discovered_owner_id);
          
          toast({
            title: 'Gateway Owner Discovered',
            description: `Found TTN ${data.discovered_owner_type}: ${data.discovered_owner_id}. Check API key permissions.`,
            variant: 'default',
          });
        }
        
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
    cluster: 'nam1',
  };

  // Load gateway-specific settings from ttn_settings (source of truth for gateway config)
  const loadGatewaySettings = async () => {
    if (!orgId) return;
    
    try {
      const { data: ttnSettings, error } = await supabase
        .from('ttn_settings')
        .select('gateway_owner_type, gateway_owner_id, gateway_api_key, webhook_secret, updated_at, api_key, cluster, application_id')
        .eq('org_id', orgId)
        .maybeSingle();
        
      if (error) {
        console.error('[WebhookSettings] Failed to load gateway settings from ttn_settings:', error);
        return;
      }
      
      if (ttnSettings) {
        console.log('[WebhookSettings] Loaded gateway settings from ttn_settings:', {
          gateway_owner_type: ttnSettings.gateway_owner_type,
          gateway_owner_id: ttnSettings.gateway_owner_id,
          gateway_api_key_set: !!ttnSettings.gateway_api_key,
          webhook_secret_set: !!ttnSettings.webhook_secret,
          api_key_set: !!ttnSettings.api_key,
          updated_at: ttnSettings.updated_at,
        });
        
        // Update ONLY gateway-specific canonical values from ttn_settings
        // IMPORTANT: Do NOT overwrite cluster, api_key, application_id - those come from synced_users.ttn
        setCanonicalOwnerType(ttnSettings.gateway_owner_type as 'user' | 'organization' || null);
        setCanonicalOwnerId(ttnSettings.gateway_owner_id || null);
        setCanonicalGatewayApiKeyLast4(ttnSettings.gateway_api_key?.slice(-4) || null);
        
        // Only set webhook secret from ttn_settings if we don't have it from synced_users
        if (!canonicalWebhookSecretLast4 && ttnSettings.webhook_secret) {
          setCanonicalWebhookSecretLast4(ttnSettings.webhook_secret.slice(-4));
        }
        
        // Update form state for gateway owner if not already set
        if (ttnSettings.gateway_owner_type && !gatewayOwnerType) {
          setGatewayOwnerType(ttnSettings.gateway_owner_type as 'user' | 'organization');
        }
        if (ttnSettings.gateway_owner_id && !gatewayOwnerId) {
          setGatewayOwnerId(ttnSettings.gateway_owner_id);
        }
        setGatewayApiKeySet(!!ttnSettings.gateway_api_key);
        setGatewayApiKeyPreview(ttnSettings.gateway_api_key ? `****${ttnSettings.gateway_api_key.slice(-4)}` : null);
        setTtnWebhookSecretSet(!!ttnSettings.webhook_secret);
        
        // NOTE: We intentionally DO NOT update canonicalCluster, canonicalApiKeyLast4, or 
        // canonicalApplicationId here. Those values should come from synced_users.ttn (FrostGuard sync)
        // and are already set by loadSettings() or from props. This function only loads gateway-specific config.
        
        console.log('[WebhookSettings] loadGatewaySettings: Only gateway-specific fields updated, core TTN values preserved');
      }
    } catch (err: any) {
      console.error('[WebhookSettings] Error loading gateway settings:', err);
    }
  };

  // Load settings from config or database on mount or org/user change
  // Load settings from database on mount or when org/user changes
  // NOTE: Do NOT include config.ttnConfig in deps - loadSettings() updates ttnConfig via updateTTN,
  // which would cause an infinite loop.
  useEffect(() => {
    if (orgId) {
      // Always load from database to get authoritative values
      // This corrects any stale applicationId from localStorage
      loadSettings();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, config.selectedUserId]);

  const loadSettings = async () => {
    if (!orgId) return;

    setIsLoading(true);
    let usingSelectedUser = false; // Track if we're actually using the selected user's data
    
    try {
      // ====== STEP 1: Load from synced_users (FrostGuard sync) ======
      const userId = config.selectedUserId;

      let syncedUser: { ttn: unknown; source_organization_id: string; id: string; source_user_id: string; email: string } | null = null;
      let fetchError: Error | null = null;

      if (userId) {
        console.log('[WebhookSettings] Loading TTN settings for user:', userId);
        
        // Try source_user_id first (FrostGuard user id - this is what the picker returns)
        const { data: bySourceId, error: err1 } = await supabase
          .from('synced_users')
          .select('ttn, source_organization_id, id, source_user_id, email')
          .eq('source_user_id', userId)
          .limit(1)
          .maybeSingle();
        
        if (bySourceId) {
          syncedUser = bySourceId;
          usingSelectedUser = true;
          console.log('[WebhookSettings] Found user by source_user_id:', bySourceId.email);
        } else {
          // Fallback: try row id (for backward compatibility with older sessions)
          const { data: byRowId, error: err2 } = await supabase
            .from('synced_users')
            .select('ttn, source_organization_id, id, source_user_id, email')
            .eq('id', userId)
            .limit(1)
            .maybeSingle();
          
          if (byRowId) {
            syncedUser = byRowId;
            usingSelectedUser = true;
            console.log('[WebhookSettings] Found user by row id (legacy):', byRowId.email);
          } else {
            fetchError = err1 || err2;
          }
        }
        
        // If user-specific query returned empty, try org-level fallback
        if (!syncedUser) {
          console.warn('[WebhookSettings] Selected user not found by source_user_id or id, trying org fallback');
          const { data: orgSyncedUser } = await supabase
            .from('synced_users')
            .select('ttn, source_organization_id, id, source_user_id, email')
            .eq('source_organization_id', orgId)
            .limit(1)
            .maybeSingle();
          
          if (orgSyncedUser?.ttn) {
            syncedUser = orgSyncedUser;
            usingSelectedUser = false; // Important: we're NOT using the selected user
            console.log('[WebhookSettings] Loaded TTN from org-level user:', orgSyncedUser.email);
            // Only show warning toast if we actually had a userId but couldn't find it
            toast({
              title: 'User sync data not found',
              description: `Using org-level data from ${orgSyncedUser.email}. Re-select user to refresh.`,
            });
          }
        }
      } else {
        console.log('[WebhookSettings] Loading TTN settings for org:', orgId);
        const { data, error } = await supabase
          .from('synced_users')
          .select('ttn, source_organization_id, id, source_user_id, email')
          .eq('source_organization_id', orgId)
          .limit(1)
          .maybeSingle();
        
        syncedUser = data;
        fetchError = error;
        usingSelectedUser = false;
      }

      if (fetchError) {
        console.error('[WebhookSettings] Failed to load TTN settings from synced_users:', fetchError);
      }

      // ====== STEP 2: Load from ttn_settings (gateway owner config) ======
      const { data: ttnSettings, error: ttnSettingsError } = await supabase
        .from('ttn_settings')
        .select('gateway_owner_type, gateway_owner_id, gateway_api_key, webhook_secret, cluster, enabled, application_id, api_key')
        .eq('org_id', orgId)
        .limit(1)
        .maybeSingle();

      if (ttnSettingsError) {
        console.error('[WebhookSettings] Failed to load from ttn_settings:', ttnSettingsError);
      }

      console.log('[WebhookSettings] Data sources loaded:', {
        synced_users_ttn: syncedUser?.ttn,
        ttn_settings: ttnSettings ? {
          gateway_owner_type: ttnSettings.gateway_owner_type,
          gateway_owner_id: ttnSettings.gateway_owner_id,
          gateway_api_key_set: !!ttnSettings.gateway_api_key,
          webhook_secret_set: !!ttnSettings.webhook_secret,
          cluster: ttnSettings.cluster,
        } : null,
      });

      // ====== STEP 3: Build resolved config with source tracking ======
      const rawUserTTN = (syncedUser?.ttn as Record<string, unknown>) || null;
      const rawOrgSettings = ttnSettings || null;
      
      // Determine API key source with deterministic precedence:
      // If user TTN is enabled AND has api_key_last4 => use user config
      // Else if org has api_key => use org config
      // Else show Not set
      const userHasValidApiKey = rawUserTTN?.enabled && rawUserTTN?.api_key_last4;
      const orgHasValidApiKey = !!rawOrgSettings?.api_key;
      
      let resolvedApiKeyLast4: string | null = null;
      let apiKeySource: TTNConfigSource = 'not_set';
      
      if (userHasValidApiKey) {
        resolvedApiKeyLast4 = rawUserTTN.api_key_last4 as string;
        apiKeySource = 'user';
      } else if (orgHasValidApiKey) {
        resolvedApiKeyLast4 = rawOrgSettings.api_key.slice(-4);
        apiKeySource = 'org';
      }
      
      // Determine cluster source
      // Cluster: prefer fresh pull > synced_users > ttn_settings > default
      const freshPullCluster = config.ttnConfig?.cluster || null;
      const clusterSource: TTNConfigSource = freshPullCluster ? 'user' : (rawUserTTN?.cluster ? 'user' : (rawOrgSettings?.cluster ? 'org' : 'not_set'));
      const effectiveCluster = freshPullCluster || (rawUserTTN?.cluster as string) || rawOrgSettings?.cluster || 'nam1';
      
      // Determine app ID source
      // Priority: fresh FrostGuard pull (config.ttnConfig) > synced_users.ttn > ttn_settings
      // The synced_users mirror can be stale if the user-sync pipeline hasn't run recently
      const freshPullAppId = config.ttnConfig?.applicationId || null;
      let effectiveAppId: string;
      let appIdSource: TTNConfigSource;
      
      if (freshPullAppId) {
        effectiveAppId = freshPullAppId;
        appIdSource = 'user';
        // Log if there's a mismatch between fresh pull and synced_users mirror
        const mirrorAppId = rawUserTTN?.application_id as string | undefined;
        if (mirrorAppId && mirrorAppId !== freshPullAppId) {
          console.warn(`[WebhookSettings] Application ID mismatch: fresh pull=${freshPullAppId}, synced_users=${mirrorAppId}. Using fresh pull value.`);
        }
      } else if (rawUserTTN?.application_id) {
        effectiveAppId = rawUserTTN.application_id as string;
        appIdSource = 'user';
      } else if (rawOrgSettings?.application_id) {
        effectiveAppId = rawOrgSettings.application_id;
        appIdSource = 'org';
      } else {
        effectiveAppId = '';
        appIdSource = 'not_set';
      }
      
      const effectiveEnabled = !!(rawUserTTN?.enabled || rawOrgSettings?.enabled);
      
      // Gateway config: Priority order:
      // 1. Full gateway key from synced_users.ttn (FrostGuard push)
      // 2. Full gateway key from ttn_settings (local org config)
      // 3. Fallback to last4 for display only
      const userHasFullGatewayKey = !!(rawUserTTN?.gateway_api_key);
      const orgHasFullGatewayKey = !!(rawOrgSettings?.gateway_api_key);
      
      let gatewayKeyLast4: string | null = null;
      let gatewayKeySource: TTNConfigSource = 'not_set';
      let fullGatewayKeyFromSync: string | null = null;
      
      if (userHasFullGatewayKey) {
        fullGatewayKeyFromSync = rawUserTTN.gateway_api_key as string;
        gatewayKeyLast4 = fullGatewayKeyFromSync.slice(-4);
        gatewayKeySource = 'user';
      } else if (orgHasFullGatewayKey) {
        gatewayKeyLast4 = rawOrgSettings.gateway_api_key.slice(-4);
        gatewayKeySource = 'org';
      } else if (rawUserTTN?.gateway_api_key_last4) {
        gatewayKeyLast4 = rawUserTTN.gateway_api_key_last4 as string;
        gatewayKeySource = 'user';
      }
      
      // Prefer synced_users.ttn for gateway owner config, fall back to ttn_settings
      const ownerType = (rawUserTTN?.gateway_owner_type as string) || rawOrgSettings?.gateway_owner_type || null;
      const ownerId = (rawUserTTN?.gateway_owner_id as string) || rawOrgSettings?.gateway_owner_id || null;
      const webhookSecretLast4 = rawOrgSettings?.webhook_secret?.slice(-4) || (rawUserTTN?.webhook_secret_last4 as string) || null;
      
      // Build the resolved config for diagnostics
      const resolved: ResolvedTTNConfig = {
        cluster: effectiveCluster,
        cluster_source: clusterSource,
        application_id: effectiveAppId,
        application_id_source: appIdSource,
        api_key_last4: resolvedApiKeyLast4,
        api_key_source: apiKeySource,
        gateway_api_key_last4: gatewayKeyLast4,
        gateway_api_key_source: gatewayKeySource,
        webhook_secret_last4: webhookSecretLast4,
        webhook_secret_source: rawOrgSettings?.webhook_secret ? 'org' : (rawUserTTN?.webhook_secret_last4 ? 'user' : 'not_set'),
        gateway_owner_type: ownerType as 'user' | 'organization' | null,
        gateway_owner_id: ownerId as string | null,
        gateway_owner_source: rawUserTTN?.gateway_owner_type ? 'user' : (rawOrgSettings?.gateway_owner_type ? 'org' : 'not_set'),
        gateway_api_key_from_frostguard: !!fullGatewayKeyFromSync,
        raw_user_ttn: rawUserTTN,
        raw_org_settings: rawOrgSettings ? {
          cluster: rawOrgSettings.cluster,
          application_id: rawOrgSettings.application_id,
          api_key_set: !!rawOrgSettings.api_key,
          api_key_last4: rawOrgSettings.api_key?.slice(-4) || null,
          gateway_api_key_set: !!rawOrgSettings.gateway_api_key,
          gateway_api_key_last4: rawOrgSettings.gateway_api_key?.slice(-4) || null,
          webhook_secret_set: !!rawOrgSettings.webhook_secret,
          webhook_secret_last4: rawOrgSettings.webhook_secret?.slice(-4) || null,
          gateway_owner_type: rawOrgSettings.gateway_owner_type,
          gateway_owner_id: rawOrgSettings.gateway_owner_id,
        } : null,
        resolved_at: new Date().toISOString(),
      };
      
      setResolvedConfig(resolved);
      
      console.log('[WebhookSettings] Resolved config with sources:', {
        api_key_source: apiKeySource,
        api_key_last4: resolvedApiKeyLast4 ? `****${resolvedApiKeyLast4}` : null,
        cluster_source: clusterSource,
        app_id_source: appIdSource,
        raw_user_api_key_last4: rawUserTTN?.api_key_last4 ? `****${rawUserTTN.api_key_last4}` : null,
        raw_org_api_key_set: !!rawOrgSettings?.api_key,
      });
      
      // ====== STEP 4: Apply values to form state ======
      setTtnEnabled(effectiveEnabled);
      setTtnCluster(effectiveCluster);
      setTtnApplicationId(effectiveAppId);
      setTtnApiKeyPreview(resolvedApiKeyLast4 ? `****${resolvedApiKeyLast4}` : null);
      setTtnApiKeySet(!!resolvedApiKeyLast4);
      
      if (ownerType) setGatewayOwnerType(ownerType as 'user' | 'organization');
      if (ownerId) setGatewayOwnerId(ownerId as string);
      setGatewayApiKeyPreview(gatewayKeyLast4 ? `****${gatewayKeyLast4}` : null);
      setGatewayApiKeySet(!!gatewayKeyLast4);
      setTtnWebhookSecretSet(!!webhookSecretLast4);
      
      // Don't load actual secrets, just show preview
      setTtnApiKey('');
      setTtnWebhookSecret('');
      setGatewayApiKey('');
      
      // ====== STEP 5: Set canonical values for "Current:" display ======
      setCanonicalCluster(effectiveCluster);
      setCanonicalApplicationId(effectiveAppId || null);
      setCanonicalApiKeyLast4(resolvedApiKeyLast4);
      setCanonicalOwnerType(ownerType as 'user' | 'organization' | null);
      setCanonicalOwnerId(ownerId as string | null);
      setCanonicalWebhookSecretLast4(webhookSecretLast4);
      setCanonicalGatewayApiKeyLast4(gatewayKeyLast4);
      setCanonicalLastSyncAt((rawUserTTN?.updated_at as string) || null);
      
      console.log('[WebhookSettings] Canonical values merged from synced_users + ttn_settings:', {
        cluster: effectiveCluster,
        appId: effectiveAppId,
        apiKeyLast4: resolvedApiKeyLast4 ? `****${resolvedApiKeyLast4}` : null,
        apiKeySource,
        ownerType,
        ownerId,
        gatewayKeyLast4: gatewayKeyLast4 ? `****${gatewayKeyLast4}` : null,
        webhookSecretLast4: webhookSecretLast4 ? 'set' : null,
        gatewayKeySource,
        fullGatewayKeyFromSync: fullGatewayKeyFromSync ? 'present' : 'none',
      });

      // ====== STEP 6: Auto-sync FrostGuard data to ttn_settings ======
      // This ensures ttn_settings stays in sync with FrostGuard-pushed values
      // IMPORTANT: Only sync if we're actually using the selected user's data (not org fallback)
      // Only auto-sync once per component mount to prevent repeated toasts
      if (orgId && rawUserTTN && usingSelectedUser && !autoSyncDoneRef.current) {
        const updatePayload: Record<string, unknown> = {
          action: 'save',
          org_id: orgId,
        };
        
        let needsUpdate = false;
        const changes: string[] = [];
        
        // Check if gateway key needs sync
        if (fullGatewayKeyFromSync) {
          updatePayload.gateway_api_key = fullGatewayKeyFromSync;
          updatePayload.gateway_owner_type = ownerType || 'organization';
          updatePayload.gateway_owner_id = ownerId || '';
          needsUpdate = true;
          changes.push('gateway_api_key');
        }
        
        // Check if application_id needs sync to org table
        // Use effectiveAppId (which respects precedence: fresh FrostGuard pull > synced_users > org)
        // instead of rawUserTTN.application_id which can be a stale mirror
        const bestAppId = effectiveAppId;
        const orgAppId = rawOrgSettings?.application_id as string | undefined;
        if (bestAppId && orgAppId && bestAppId !== orgAppId) {
          updatePayload.application_id = bestAppId;
          needsUpdate = true;
          changes.push(`application_id: ${orgAppId} → ${bestAppId}`);
        } else if (bestAppId && !orgAppId) {
          // No org value yet, set it from best available source
          updatePayload.application_id = bestAppId;
          needsUpdate = true;
          changes.push(`application_id: (empty) → ${bestAppId}`);
        }
        
        // Check if cluster needs sync
        const userCluster = rawUserTTN?.cluster as string;
        const orgCluster = rawOrgSettings?.cluster as string | undefined;
        if (userCluster && orgCluster && userCluster !== orgCluster) {
          updatePayload.cluster = userCluster;
          needsUpdate = true;
          changes.push(`cluster: ${orgCluster} → ${userCluster}`);
        } else if (userCluster && !orgCluster) {
          updatePayload.cluster = userCluster;
          needsUpdate = true;
          changes.push(`cluster: (empty) → ${userCluster}`);
        }
        
        // Perform sync if any values need updating
        if (needsUpdate) {
          console.log('[WebhookSettings] Auto-syncing FrostGuard values to ttn_settings:', changes);
          
          try {
            const { error: saveError } = await supabase.functions.invoke('manage-ttn-settings', {
              body: updatePayload,
            });
            
            if (saveError) {
              console.error('[WebhookSettings] Failed to auto-sync to ttn_settings:', saveError);
            } else {
              console.log('[WebhookSettings] Successfully synced FrostGuard values to ttn_settings');
              toast({
                title: 'Config Synced from FrostGuard',
                description: `Updated local settings: ${changes.join(', ')}`,
              });
              
              // Update UI state to reflect synced values
              if (fullGatewayKeyFromSync) {
                setGatewayApiKeySet(true);
                setGatewayApiKeyPreview(`****${gatewayKeyLast4}`);
              }
            }
          } catch (autoSaveErr) {
            console.error('[WebhookSettings] Exception auto-syncing:', autoSaveErr);
          }
        }
        autoSyncDoneRef.current = true;
      }

      // Load connection status
      if (rawUserTTN?.updated_at) {
        setLastTestAt(new Date(rawUserTTN.updated_at as string));
      }

      // Update parent config
      if (effectiveEnabled) {
        updateTTN({
          enabled: effectiveEnabled,
          applicationId: effectiveAppId,
          cluster: effectiveCluster,
        });
      }

      if (rawUserTTN?.webhook_secret) {
        update({ ttnWebhookSecret: rawUserTTN.webhook_secret as string });
      }
      
      // Show info if no data found at all
      if (!syncedUser?.ttn && !ttnSettings) {
        console.log('[WebhookSettings] No TTN settings found in either source for', userId ? `user ${userId}` : `org ${orgId}`);
        toast({
          title: 'No TTN Settings',
          description: 'No TTN configuration found. Make sure user is synced from FrostGuard.',
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

      // Update canonical values to reflect saved state (for "Current:" display)
      setCanonicalCluster(ttnCluster);
      setCanonicalApplicationId(ttnApplicationId);
      setCanonicalApiKeyLast4(savedApiKeyLast4 || null);
      if (gatewayOwnerType) setCanonicalOwnerType(gatewayOwnerType);
      if (gatewayOwnerId) setCanonicalOwnerId(gatewayOwnerId);
      if (savedGatewayApiKeyLast4) setCanonicalGatewayApiKeyLast4(savedGatewayApiKeyLast4);
      if (ttnWebhookSecret) setCanonicalWebhookSecretLast4(ttnWebhookSecret.slice(-4));
      setCanonicalLastSyncAt(new Date().toISOString());
      
      console.log('[WebhookSettings] Canonical values updated after save:', {
        cluster: ttnCluster,
        appId: ttnApplicationId,
        apiKeyLast4: savedApiKeyLast4 ? `****${savedApiKeyLast4}` : null,
        ownerType: gatewayOwnerType,
        ownerId: gatewayOwnerId,
        gatewayApiKeyLast4: savedGatewayApiKeyLast4 ? `****${savedGatewayApiKeyLast4}` : null,
        webhookSecretLast4: ttnWebhookSecret ? 'set' : null,
      });

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
        // Include user context so backend tests the correct user-specific app
        selected_user_id: config.selectedUserId || undefined,
        cluster: ttnCluster,
        application_id: ttnApplicationId,
      };

      console.log('[WebhookSettings] Testing TTN connection with:', {
        ...requestBody,
        expected_app: ttnApplicationId,
        expected_cluster: ttnCluster,
        hasSelectedUser: !!config.selectedUserId,
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
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Route emulator data through The Things Network for production-ready testing
            </p>
            {canonicalLastSyncAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last synced: {formatRelativeTime(canonicalLastSyncAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              setIsRefreshingCanonical(true);
              
              // Clear existing state first to force fresh fetch
              setResolvedConfig(null);
              setCanonicalApiKeyLast4(null);
              setCanonicalGatewayApiKeyLast4(null);
              setCanonicalWebhookSecretLast4(null);
              
              try {
                // Load both sources: synced_users (app config) and ttn_settings (gateway config)
                await loadSettings();
                await loadGatewaySettings();
                toast({
                  title: 'Refreshed',
                  description: 'TTN settings reloaded from database',
                });
              } finally {
                setIsRefreshingCanonical(false);
              }
            }}
            disabled={isRefreshingCanonical || !orgId || isLoading}
            className="gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshingCanonical ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
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
              onCheckedChange={(checked) => {
                setTtnEnabled(checked);
                updateTTN({ enabled: checked });
              }}
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
                  {canonicalCluster 
                    ? <CurrentValueBadge value={canonicalCluster} source={resolvedConfig?.cluster_source} />
                    : <p className="text-xs text-muted-foreground">Select your TTN Console region</p>
                  }
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
                  {canonicalApplicationId 
                    ? <CurrentValueBadge value={canonicalApplicationId} source={resolvedConfig?.application_id_source} />
                    : <p className="text-xs text-muted-foreground">From your TTN Console application</p>
                  }
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
                  {canonicalApiKeyLast4 
                    ? <CurrentValueBadge value={canonicalApiKeyLast4} isMasked source={resolvedConfig?.api_key_source} />
                    : <p className="text-xs text-muted-foreground">From TTN Console → API keys</p>
                  }
                  {ttnApiKeySet && !canonicalApiKeyLast4 && (
                    <p className="text-xs text-muted-foreground">Leave blank to keep, enter new to replace</p>
                  )}
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
                  {canonicalWebhookSecretLast4 
                    ? <CurrentValueBadge value={canonicalWebhookSecretLast4} isMasked source={resolvedConfig?.webhook_secret_source} />
                    : <p className="text-xs text-muted-foreground">For webhook signature verification. Leave blank if not set.</p>
                  }
                  {ttnWebhookSecretSet && !canonicalWebhookSecretLast4 && (
                    <p className="text-xs text-muted-foreground">Leave blank to keep, enter new to replace</p>
                  )}
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
                    {canonicalOwnerType 
                      ? <CurrentValueBadge value={canonicalOwnerType === 'organization' ? 'Organization' : 'Personal (User)'} source={resolvedConfig?.gateway_owner_source} />
                      : <p className="text-xs text-muted-foreground">Select gateway owner type</p>
                    }
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
                    {canonicalOwnerId 
                      ? <CurrentValueBadge value={canonicalOwnerId} source={resolvedConfig?.gateway_owner_source} />
                      : <p className="text-xs text-muted-foreground">Required for gateway provisioning</p>
                    }
                  </div>
                </div>

                {/* Gateway API Key - separate from Application API Key */}
                <div className="space-y-2 mt-4">
                  <Label htmlFor="gatewayApiKey" className="flex items-center gap-2 flex-wrap">
                    Gateway API Key
                    {gatewayApiKeySet && (
                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                        Saved
                      </Badge>
                    )}
                    {resolvedConfig?.gateway_api_key_from_frostguard && (
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-200">
                        <CloudDownload className="h-3 w-3 mr-1" />
                        Synced from FrostGuard
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
                  {canonicalGatewayApiKeyLast4 
                    ? <CurrentValueBadge value={canonicalGatewayApiKeyLast4} isMasked source={resolvedConfig?.gateway_api_key_source} />
                    : <p className="text-xs text-muted-foreground">Personal/Organization API key with gateways:read + gateways:write rights. NOT an Application API key.</p>
                  }
                  {gatewayApiKeySet && !canonicalGatewayApiKeyLast4 && (
                    <p className="text-xs text-muted-foreground">Leave blank to keep, enter new to replace</p>
                  )}
                  
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

              {/* Application ID Mismatch Warning */}
              {resolvedConfig?.raw_user_ttn?.application_id && 
               resolvedConfig?.raw_org_settings?.application_id &&
               resolvedConfig.raw_user_ttn.application_id !== (resolvedConfig.raw_org_settings as any).application_id && (
                <Alert className="border-amber-500/50 bg-amber-500/10">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-700">Application ID Mismatch</AlertTitle>
                  <AlertDescription className="text-amber-600 text-xs">
                    <p className="mb-2">
                      User config has "<span className="font-mono font-medium">{String(resolvedConfig.raw_user_ttn.application_id)}</span>" 
                      but local ttn_settings has "<span className="font-mono font-medium">{(resolvedConfig.raw_org_settings as any).application_id}</span>".
                    </p>
                    <p>
                      Using <span className="font-medium">{resolvedConfig.application_id_source === 'user' ? 'User' : 'Org'}</span> value: 
                      "<span className="font-mono font-medium">{resolvedConfig.application_id}</span>".
                      {resolvedConfig.application_id_source === 'org' && 
                       " Click Refresh to reload local data."}
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Compare to FrostGuard Diagnostics */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <Bug className="h-4 w-4" />
                      Compare to FrostGuard
                    </span>
                    <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-md border bg-muted/30 p-3 mt-2 space-y-3">
                    <div className="text-xs font-medium text-muted-foreground">Source Comparison</div>
                    
                    {/* Header Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="font-medium">Field</div>
                      <div className="font-medium text-blue-600">User (synced_users.ttn)</div>
                      <div className="font-medium text-amber-600">Org (ttn_settings)</div>
                    </div>
                    
                    {/* API Key Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2">
                      <div>API Key</div>
                      <div className="font-mono">
                        {resolvedConfig?.raw_user_ttn?.api_key_last4 
                          ? <span className="text-green-600">****{String(resolvedConfig.raw_user_ttn.api_key_last4)}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="font-mono">
                        {(resolvedConfig?.raw_org_settings as any)?.api_key_last4
                          ? <span className="text-green-600">****{(resolvedConfig.raw_org_settings as any).api_key_last4}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    
                    {/* Application ID Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2">
                      <div>Application ID</div>
                      <div className="font-mono truncate">
                        {resolvedConfig?.raw_user_ttn?.application_id 
                          ? String(resolvedConfig.raw_user_ttn.application_id)
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="font-mono truncate">
                        {(resolvedConfig?.raw_org_settings as any)?.application_id 
                          ? (resolvedConfig.raw_org_settings as any).application_id
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    
                    {/* Cluster Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2">
                      <div>Cluster</div>
                      <div className="font-mono">
                        {resolvedConfig?.raw_user_ttn?.cluster 
                          ? String(resolvedConfig.raw_user_ttn.cluster)
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="font-mono">
                        {(resolvedConfig?.raw_org_settings as any)?.cluster 
                          ? (resolvedConfig.raw_org_settings as any).cluster
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    
                    {/* Gateway API Key Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2">
                      <div>Gateway API Key</div>
                      <div className="font-mono">
                        {resolvedConfig?.raw_user_ttn?.gateway_api_key_last4 
                          ? <span className="text-green-600">****{String(resolvedConfig.raw_user_ttn.gateway_api_key_last4)}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="font-mono">
                        {(resolvedConfig?.raw_org_settings as any)?.gateway_api_key_last4
                          ? <span className="text-green-600">****{(resolvedConfig.raw_org_settings as any).gateway_api_key_last4}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    
                    {/* Gateway Owner Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs border-t pt-2">
                      <div>Gateway Owner</div>
                      <div className="font-mono truncate">
                        {resolvedConfig?.raw_user_ttn?.gateway_owner_type 
                          ? `${resolvedConfig.raw_user_ttn.gateway_owner_type}:${resolvedConfig.raw_user_ttn.gateway_owner_id || '?'}`
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="font-mono truncate">
                        {(resolvedConfig?.raw_org_settings as any)?.gateway_owner_type 
                          ? `${(resolvedConfig.raw_org_settings as any).gateway_owner_type}:${(resolvedConfig.raw_org_settings as any).gateway_owner_id || '?'}`
                          : <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    
                    {/* Resolved Value Summary */}
                    <div className="border-t pt-2 mt-2">
                      <div className="text-xs font-medium mb-1 flex items-center gap-2">
                        Active Config: 
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-medium",
                          resolvedConfig?.api_key_source === 'user' ? "bg-blue-100 text-blue-700" : 
                          resolvedConfig?.api_key_source === 'org' ? "bg-amber-100 text-amber-700" : 
                          "bg-gray-100 text-gray-600"
                        )}>
                          {resolvedConfig?.api_key_source === 'user' ? 'Using User Config' : 
                           resolvedConfig?.api_key_source === 'org' ? 'Using Org Config' : 'Not Set'}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Resolved at: {resolvedConfig?.resolved_at ? formatRelativeTime(resolvedConfig.resolved_at) : 'Never'}
                      </div>
                    </div>
                    
                    {/* Mismatch Warning */}
                    {resolvedConfig?.raw_user_ttn?.api_key_last4 && 
                     (resolvedConfig?.raw_org_settings as any)?.api_key_last4 && 
                     resolvedConfig.raw_user_ttn.api_key_last4 !== (resolvedConfig.raw_org_settings as any).api_key_last4 && (
                      <Alert className="bg-amber-500/10 border-amber-500/30 py-2">
                        <AlertCircle className="h-3 w-3 text-amber-600" />
                        <AlertDescription className="text-xs text-amber-700">
                          User and Org API keys differ. User key (****{String(resolvedConfig.raw_user_ttn.api_key_last4)}) takes precedence.
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    {/* Stale Data Warning - Show when user data is older than 1 day */}
                    {resolvedConfig?.raw_user_ttn && (() => {
                      const updatedAt = resolvedConfig.raw_user_ttn.updated_at as string | undefined;
                      if (!updatedAt) return null;
                      const ageMs = Date.now() - new Date(updatedAt).getTime();
                      const ageHours = ageMs / (1000 * 60 * 60);
                      if (ageHours < 24) return null;
                      return (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-3 w-3" />
                          <AlertDescription className="text-xs flex items-center justify-between">
                            <span>
                              User data is {Math.floor(ageHours / 24)}+ days old. 
                              TTN credentials may be stale.
                            </span>
                          </AlertDescription>
                        </Alert>
                      );
                    })()}
                  </div>
                </CollapsibleContent>
              </Collapsible>

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
