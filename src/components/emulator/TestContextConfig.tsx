import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, MapPin, Box, Loader2, Check, AlertTriangle, User, X, Radio, Star, Cloud, RefreshCw, ChevronDown, Bug, Database, AlertCircle, Copy } from 'lucide-react';
import { WebhookConfig, GatewayConfig, LoRaWANDevice, SyncBundle, SyncResult } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import UserSearchDialog, { UserSite, TTNConnection, UserProfile } from './UserSearchDialog';
import SyncReadinessPanel from './SyncReadinessPanel';
import { validateSyncBundle, ValidationResult } from '@/lib/sync-validation';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Context debug logger - always logs to help diagnose silent failures
const contextDebug = {
  log: (...args: unknown[]) => {
    console.log('[EMULATOR_CONTEXT_DEBUG]', new Date().toISOString(), ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn('[EMULATOR_CONTEXT_DEBUG]', ...args);
  },
  error: (...args: unknown[]) => {
    console.error('[EMULATOR_CONTEXT_DEBUG]', ...args);
  },
};

interface ContextDiagnostics {
  selectedUserId: string | null;
  selectedOrgId: string | null;
  selectedSiteId: string | null;
  userSitesCount: number;
  userSitesRaw: UserSite[];
  ttnEnabled: boolean;
  ttnCluster: string | null;
  lastUserSelectAt: string | null;
  rawUserPayload: UserProfile | null;
}

/**
 * TestContextConfig
 * ================================================
 * TTN settings are sourced EXCLUSIVELY from the user_sync flow.
 * There is NO snapshot-based fetch. All TTN data flows through user_sync.
 * 
 * When a user is selected via UserSearchDialog, their TTN configuration
 * (from synced_users.ttn column, populated by user-sync edge function)
 * is displayed in the "TTN Settings (from FrostGuard)" section.
 */

interface TestContextConfigProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
  gateways?: GatewayConfig[];
  devices?: LoRaWANDevice[];
  onSyncResult?: (result: SyncResult) => void;
}

type SyncStatus = 'success' | 'partial' | 'failed' | null;

interface SyncErrorDetail {
  path: string;
  message: string;
}

export default function TestContextConfig({ 
  config, 
  onConfigChange, 
  disabled,
  gateways = [],
  devices = [],
  onSyncResult,
}: TestContextConfigProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [cachedUserCount, setCachedUserCount] = useState<number | null>(null);
  
  // Site dropdown options from selected user
  const [selectedUserSites, setSelectedUserSites] = useState<UserSite[]>([]);
  const [selectedUserDefaultSite, setSelectedUserDefaultSite] = useState<string | null>(null);
  
  // TTN data from user sync payload (separate from TTN snapshot)
  const [selectedUserTTN, setSelectedUserTTN] = useState<TTNConnection | null>(null);
  
  // Sync run ID for idempotency - persists across retries
  const [currentSyncRunId, setCurrentSyncRunId] = useState<string | null>(null);
  const lastSyncMethodRef = useRef<'endpoint' | 'direct' | null>(null);
  
  // Diagnostics state for debugging
  const [diagnostics, setDiagnostics] = useState<ContextDiagnostics>({
    selectedUserId: null,
    selectedOrgId: null,
    selectedSiteId: null,
    userSitesCount: 0,
    userSitesRaw: [],
    ttnEnabled: false,
    ttnCluster: null,
    lastUserSelectAt: null,
    rawUserPayload: null,
  });
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  
  // Note: TTN data now comes exclusively from user_sync (selectedUserTTN state)
  // There is no snapshot hook - all TTN config flows through user-sync pipeline

  // Preflight validation
  const validationResult: ValidationResult = useMemo(() => {
    return validateSyncBundle(
      {
        org_id: config.testOrgId,
        site_id: config.testSiteId,
        selected_user_id: config.selectedUserId || undefined,
      },
      gateways.map(g => ({ id: g.id, name: g.name, eui: g.eui })),
      devices.map(d => ({
        id: d.id,
        name: d.name,
        dev_eui: d.devEui,
        join_eui: d.joinEui,
        app_key: d.appKey,
        type: d.type,
      }))
    );
  }, [config.testOrgId, config.testSiteId, config.selectedUserId, gateways, devices]);

  // Fetch synced user count
  const fetchUserCount = async () => {
    const { count, error } = await supabase
      .from('synced_users')
      .select('*', { count: 'exact', head: true });
    
    if (!error && count !== null) {
      setCachedUserCount(count);
    }
  };

  useEffect(() => {
    fetchUserCount();
  }, []);

  // Clear user sites when org changes (but keep sites if just switching org field)
  // Sites are populated when a user is selected via UserSearchDialog

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
    // Reset sync state when inputs change
    setSyncStatus(null);
    setLastSyncSummary(null);
    setLastSyncError(null);
    // Clear sync run ID so next sync gets a new one
    setCurrentSyncRunId(null);
  };

  // Clear selected user tracking (keeps input values)
  const clearSelectedUser = () => {
    update({
      selectedUserId: null,
      selectedUserDisplayName: null,
      contextSetAt: null,
      testSiteId: undefined, // Also clear site when clearing user
    });
    setSelectedUserSites([]);
    setSelectedUserDefaultSite(null);
    setSelectedUserTTN(null); // Clear TTN from sync payload
  };

  // Validation: require valid preflight + at least one entity
  const canSync = validationResult.isValid && (gateways.length > 0 || devices.length > 0);
  const hasEntities = gateways.length > 0 || devices.length > 0;

  const buildSyncBundlePayload = (syncRunId: string): SyncBundle => {
    return {
      metadata: {
        sync_run_id: syncRunId,
        initiated_at: new Date().toISOString(),
        source_project: 'pixel-perfect-copy-10',
      },
      context: {
        org_id: config.testOrgId!,
        site_id: config.testSiteId || undefined,
        unit_id_override: config.testUnitId,
        selected_user_id: config.selectedUserId || undefined,
      },
      entities: {
        gateways: gateways.map(g => ({
          id: g.id,
          name: g.name,
          eui: g.eui,
          is_online: g.isOnline,
        })),
        devices: devices.map(d => ({
          id: d.id,
          name: d.name,
          dev_eui: d.devEui,
          join_eui: d.joinEui,
          app_key: d.appKey,
          type: d.type,
          gateway_id: d.gatewayId,
        })),
      },
    };
  };

  const syncAll = async () => {
    // Block if validation fails
    if (!validationResult.isValid) {
      toast({ 
        title: 'Validation Failed', 
        description: `Fix ${validationResult.blockingErrors.length} issue(s) before syncing`, 
        variant: 'destructive' 
      });
      return;
    }

    if (!hasEntities) {
      toast({ 
        title: 'Nothing to Sync', 
        description: 'Add gateways or devices first', 
        variant: 'destructive' 
      });
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);
    setLastSyncSummary(null);
    setLastSyncError(null);

    // Generate new sync_run_id on first attempt, reuse on retry
    const syncRunId = currentSyncRunId || crypto.randomUUID();
    if (!currentSyncRunId) {
      setCurrentSyncRunId(syncRunId);
    }

    try {
      const syncBundle = buildSyncBundlePayload(syncRunId);
      console.log('Sending sync bundle:', JSON.stringify(syncBundle, null, 2));

      const { data, error } = await supabase.functions.invoke('sync-to-frostguard', {
        body: syncBundle,
      });

      // Extract detailed error from response
      if (error) {
        console.error('Sync function error:', error);
        
        let errorDetails = error.message || 'Unknown error';
        let validationErrors: SyncErrorDetail[] = [];
        
        // Try to extract structured error from the response body
        // The FunctionsHttpError may have context.body with our JSON
        if ((error as { context?: { body?: string } }).context?.body) {
          try {
            const parsed = JSON.parse((error as { context: { body: string } }).context.body);
            if (parsed.errors && Array.isArray(parsed.errors)) {
              validationErrors = parsed.errors;
              errorDetails = parsed.errors.map((e: SyncErrorDetail) => 
                `${e.path}: ${e.message}`
              ).join('\n');
            } else if (parsed.error) {
              errorDetails = parsed.error;
              if (parsed.upstream_body) {
                errorDetails += ` (upstream: ${JSON.stringify(parsed.upstream_body)})`;
              }
            }
          } catch {
            // Use original error message
          }
        }
        
        throw new Error(errorDetails);
      }

      // Handle successful response
      const { ok, success, results, summary, method } = data;
      lastSyncMethodRef.current = method;
      setLastSyncSummary(summary || null);
      
      // Handle both new format (ok, created/updated) and legacy format (success, synced)
      const totalFailed = (results?.gateways?.failed ?? 0) + (results?.devices?.failed ?? 0);
      const totalSynced = (results?.gateways?.synced ?? results?.gateways?.updated ?? 0) + 
                          (results?.devices?.synced ?? results?.devices?.updated ?? 0);
      const allErrors = [...(results?.gateways?.errors || []), ...(results?.devices?.errors || [])];
      
      // Build SyncResult for dashboard with synced entity details
      const buildSyncResult = (status: SyncStatus): SyncResult => ({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        sync_run_id: syncRunId,
        status: status!,
        method: method || null,
        stages: {
          emulator: 'success',
          api: method === 'endpoint' ? 'success' : method === 'direct' ? 'skipped' : 'failed',
          database: totalSynced > 0 ? 'success' : totalFailed > 0 ? 'failed' : 'pending',
          orgApplied: !!config.testOrgId,
        },
        counts: {
          gatewaysSynced: results?.gateways?.synced ?? results?.gateways?.updated ?? 0,
          gatewaysFailed: results?.gateways?.failed ?? 0,
          devicesSynced: results?.devices?.synced ?? results?.devices?.updated ?? 0,
          devicesFailed: results?.devices?.failed ?? 0,
        },
        errors: allErrors,
        summary: summary || '',
        // Include synced entity details (sanitized - no app_key)
        synced_entities: {
          gateways: gateways.map(g => ({
            id: g.id,
            name: g.name,
            eui: g.eui,
            is_online: g.isOnline,
          })),
          devices: devices.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            dev_eui: d.devEui,
            join_eui: d.joinEui,
            gateway_id: d.gatewayId,
          })),
        },
      });
      
      if (totalFailed > 0 && totalSynced > 0) {
        setSyncStatus('partial');
        onSyncResult?.(buildSyncResult('partial'));
        toast({ 
          title: 'Partial Sync', 
          description: `${summary}. Errors: ${allErrors.slice(0, 2).join('; ')}${allErrors.length > 2 ? '...' : ''}`, 
          variant: 'destructive' 
        });
      } else if (totalFailed > 0) {
        setSyncStatus('failed');
        onSyncResult?.(buildSyncResult('failed'));
        toast({ 
          title: 'Sync Failed', 
          description: allErrors.slice(0, 2).join('; '), 
          variant: 'destructive' 
        });
      } else if (ok || success) {
        setSyncStatus('success');
        // Clear sync run ID on success
        setCurrentSyncRunId(null);
        onSyncResult?.(buildSyncResult('success'));
        toast({ 
          title: 'Sync Complete', 
          description: `${summary}${method === 'endpoint' ? ' (via endpoint)' : ' (direct writes)'}` 
        });
      } else {
        // ok=false but no failures - treat as failed
        setSyncStatus('failed');
        setLastSyncError(data.error || 'Unknown error');
        onSyncResult?.(buildSyncResult('failed'));
        toast({ 
          title: 'Sync Failed', 
          description: data.error || 'Unknown error', 
          variant: 'destructive' 
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setLastSyncError(errorMessage);
      toast({ title: 'Sync Failed', description: errorMessage, variant: 'destructive' });
      setSyncStatus('failed');
      setLastSyncSummary(null);
      
      // Report error to dashboard
      onSyncResult?.({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        sync_run_id: syncRunId,
        status: 'failed',
        method: null,
        stages: {
          emulator: 'success',
          api: 'failed',
          database: 'pending',
          orgApplied: false,
        },
        counts: {
          gatewaysSynced: 0,
          gatewaysFailed: gateways.length,
          devicesSynced: 0,
          devicesFailed: devices.length,
        },
        errors: [errorMessage],
        summary: errorMessage,
      });
      // Keep sync run ID for retry
    } finally {
      setIsSyncing(false);
    }
  };

  const isRetry = syncStatus === 'failed' && currentSyncRunId !== null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <Label className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-primary" />
            Multi-Tenant Test Context
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Include organization context in payloads for multi-tenant testing with FrostGuard
          </p>
        </div>

        <div className="mb-2">
        <UserSearchDialog
            onSelectUser={(user) => {
              const selectTime = new Date().toISOString();
              
              // Debug log full user payload
              contextDebug.log('User selected:', {
                id: user.id,
                email: user.email,
                organization_id: user.organization_id,
                default_site_id: user.default_site_id,
                site_id: user.site_id,
                user_sites_count: user.user_sites?.length || 0,
                user_sites: user.user_sites,
                ttn_enabled: user.ttn?.enabled || false,
                ttn_cluster: user.ttn?.cluster || null,
                full_payload: user,
              });
              
              // Store user sites for dropdown
              const sites = user.user_sites || [];
              setSelectedUserSites(sites);
              setSelectedUserDefaultSite(user.default_site_id || null);
              
              // Store TTN data from sync payload
              const ttn = user.ttn || null;
              setSelectedUserTTN(ttn);
              
              // Update diagnostics
              setDiagnostics({
                selectedUserId: user.id,
                selectedOrgId: user.organization_id,
                selectedSiteId: user.default_site_id || (sites.length === 1 ? sites[0].site_id : null),
                userSitesCount: sites.length,
                userSitesRaw: sites,
                ttnEnabled: ttn?.enabled || false,
                ttnCluster: ttn?.cluster || null,
                lastUserSelectAt: selectTime,
                rawUserPayload: user,
              });
              
              // Warn if no sites
              if (sites.length === 0) {
                contextDebug.warn('No sites returned for user', {
                  userId: user.id,
                  orgId: user.organization_id,
                  hint: 'Check user_site_memberships table or sync from FrostGuard',
                });
              }
              
              // Warn if no TTN
              if (!ttn || !ttn.enabled) {
                contextDebug.warn('No TTN integration for user', {
                  userId: user.id,
                  orgId: user.organization_id,
                  ttnData: ttn,
                  hint: 'TTN data comes from synced_users.ttn column via user-sync',
                });
              }
              
              // Auto-select site logic
              let siteToSelect: string | undefined = undefined;
              if (user.default_site_id) {
                siteToSelect = user.default_site_id;
              } else if (sites.length === 1) {
                siteToSelect = sites[0].site_id;
              } else if (user.site_id) {
                // Fallback to legacy single site
                siteToSelect = user.site_id;
              }
              
              contextDebug.log('Site auto-selection:', {
                default_site_id: user.default_site_id,
                available_sites: sites.length,
                selected: siteToSelect,
              });
              
              // Build TTN config from user data
              const ttnConfig = ttn ? {
                enabled: ttn.enabled || false,
                applicationId: ttn.application_id || '',
                cluster: ttn.cluster || 'eu1',
                api_key_last4: ttn.api_key_last4 || null,
                webhook_secret_last4: ttn.webhook_secret_last4 || null,
              } : undefined;

              update({
                testOrgId: user.organization_id,
                testSiteId: siteToSelect,
                testUnitId: user.unit_id || undefined,
                selectedUserId: user.id,
                selectedUserDisplayName: user.full_name || user.email || user.id,
                contextSetAt: selectTime,
                ttnConfig, // Include TTN settings from selected user
              });
              
              // TTN data now comes from user.ttn via user_sync (already set in setSelectedUserTTN above)
            }}
            disabled={disabled}
            cachedUserCount={cachedUserCount}
          />
          
          {/* Selected user context indicator */}
          {config.selectedUserId && config.selectedUserDisplayName && (
            <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2 mt-2">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Context from:</span>
                <span className="font-medium">{config.selectedUserDisplayName}</span>
                {config.contextSetAt && (
                  <span className="text-xs text-muted-foreground">
                    ({new Date(config.contextSetAt).toLocaleTimeString()})
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={clearSelectedUser}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          
          <p className="text-xs text-muted-foreground mt-2">
            Users sync automatically from FrostGuard via database trigger
          </p>
        </div>

        {/* 
         * TTN Settings (from FrostGuard via user_sync)
         * ================================================
         * This is the ONLY source of TTN configuration data.
         * TTN settings are synced from Project 1 (FrostGuard) via the user-sync
         * edge function and stored in synced_users.ttn column.
         * 
         * There is NO snapshot-based fetch. All TTN data flows through user_sync.
         */}

        {/* TTN Settings from User Sync Payload (Read-Only) */}
        {config.selectedUserId && (
          <div className="border rounded-lg p-4 bg-muted/30">
            <Label className="flex items-center gap-2 text-sm font-medium mb-3">
              <Radio className="h-4 w-4 text-primary" />
              TTN Settings (from FrostGuard)
              {selectedUserTTN?.enabled && (
                <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                  Connected
                </span>
              )}
            </Label>
            
            <div className="grid gap-3 sm:grid-cols-2">
              {/* TTN Cluster */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">TTN Cluster</Label>
                <Input
                  value={selectedUserTTN?.cluster || '—'}
                  disabled
                  className="bg-muted/50 h-8 text-sm"
                />
              </div>
              
              {/* Application ID */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">TTN Application ID</Label>
                <Input
                  value={selectedUserTTN?.application_id || '—'}
                  disabled
                  className="bg-muted/50 h-8 text-sm font-mono"
                />
              </div>
              
              {/* Webhook URL */}
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">TTN Webhook URL</Label>
                <Input
                  value={selectedUserTTN?.webhook_url || '—'}
                  disabled
                  className="bg-muted/50 h-8 text-sm font-mono text-xs"
                />
              </div>
              
              {/* API Key (masked) */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">TTN API Key</Label>
                <Input
                  value={selectedUserTTN?.api_key_last4 
                    ? `Set (****${selectedUserTTN.api_key_last4})` 
                    : 'Not set'}
                  disabled
                  className="bg-muted/50 h-8 text-sm"
                />
              </div>
              
              {/* Webhook Secret (masked) */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Webhook Secret</Label>
                <Input
                  value={selectedUserTTN?.webhook_secret_last4 
                    ? `Set (****${selectedUserTTN.webhook_secret_last4})` 
                    : 'Not set'}
                  disabled
                  className="bg-muted/50 h-8 text-sm"
                />
              </div>
            </div>
            
            {/* No TTN hint - more specific messaging */}
            {!selectedUserTTN && (
              <div className="flex items-start gap-2 mt-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <p className="font-medium">TTN data not synced from FrostGuard</p>
                  <p className="mt-1 text-yellow-600 dark:text-yellow-500">
                    The <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">synced_users.ttn</code> column is null. 
                    Ensure Project 1 (FrostGuard) includes TTN metadata in the user-sync payload.
                  </p>
                </div>
              </div>
            )}
            {selectedUserTTN && !selectedUserTTN.enabled && (
              <p className="text-xs text-muted-foreground mt-3">
                TTN integration not enabled for this organization. Enable TTN in FrostGuard settings.
              </p>
            )}
            {selectedUserTTN?.updated_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Last synced: {new Date(selectedUserTTN.updated_at).toLocaleString()}
              </p>
            )}
          </div>
        )}
        
        {/* No user selected hint for TTN */}
        {!config.selectedUserId && (
          <p className="text-xs text-muted-foreground">
            Select a user to view TTN settings.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="testOrgId" className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              Organization ID
            </Label>
            <Input
              id="testOrgId"
              placeholder="org_abc123"
              value={config.testOrgId || ''}
              onChange={e => update({ testOrgId: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              FrostGuard org ID
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="testSiteId" className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Site ID
            </Label>
            <Select
              value={config.testSiteId || '__org_level__'}
              onValueChange={(val) => update({ testSiteId: val === '__org_level__' ? undefined : val })}
              disabled={disabled || !config.selectedUserId || selectedUserSites.length === 0}
            >
              <SelectTrigger id="testSiteId">
                <SelectValue placeholder={
                  !config.selectedUserId 
                    ? "Select user first" 
                    : selectedUserSites.length === 0
                      ? "No sites for user"
                      : "Select site..."
                } />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__org_level__">Org-level (no site)</SelectItem>
                {selectedUserSites.map(site => (
                  <SelectItem key={site.site_id} value={site.site_id}>
                    <span className="flex items-center gap-1">
                      {site.site_name || `Site ${site.site_id.slice(0, 8)}...`}
                      {site.is_default && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 ml-1" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Site count or warning */}
            {selectedUserSites.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {selectedUserSites.length} site(s) for selected user
              </p>
            ) : config.selectedUserId ? (
              <div className="flex items-start gap-1 mt-1">
                <AlertTriangle className="h-3 w-3 text-yellow-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-600 dark:text-yellow-500">
                  No sites returned for this user. Check <code className="bg-muted px-1 rounded">user_site_memberships</code> table.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select a user to see available sites
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="testUnitId" className="flex items-center gap-1">
              <Box className="h-3 w-3" />
              Unit ID Override
            </Label>
            <Input
              id="testUnitId"
              placeholder="freezer-01"
              value={config.testUnitId || ''}
              onChange={e => update({ testUnitId: e.target.value || undefined })}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Overrides device name
            </p>
          </div>
        </div>

        {(config.testOrgId || config.testSiteId) && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Active Context:</span>{' '}
              {config.testOrgId && <span className="font-mono">org={config.testOrgId}</span>}
              {config.testOrgId && config.testSiteId && ' • '}
              {config.testSiteId && <span className="font-mono">site={config.testSiteId}</span>}
            </p>
          </div>
        )}

        {/* Diagnostics Panel - Collapsible */}
        {config.selectedUserId && (
          <Collapsible open={isDiagnosticsOpen} onOpenChange={setIsDiagnosticsOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Bug className="h-3 w-3" />
                  Context Diagnostics
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isDiagnosticsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 p-3 bg-muted/30 rounded-lg border text-xs space-y-2 font-mono">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">selected_user_id:</span>
                  <span className="truncate">{diagnostics.selectedUserId || '—'}</span>
                  
                  <span className="text-muted-foreground">selected_org_id:</span>
                  <span className="truncate">{diagnostics.selectedOrgId || '—'}</span>
                  
                  <span className="text-muted-foreground">selected_site_id:</span>
                  <span className="truncate">{diagnostics.selectedSiteId || '(none)'}</span>
                  
                  <span className="text-muted-foreground">user_sites.length:</span>
                  <span className={diagnostics.userSitesCount === 0 ? 'text-yellow-600' : ''}>
                    {diagnostics.userSitesCount}
                    {diagnostics.userSitesCount === 0 && ' ⚠️'}
                  </span>
                  
                  <span className="text-muted-foreground">ttn.enabled:</span>
                  <span className={!diagnostics.ttnEnabled ? 'text-yellow-600' : 'text-green-600'}>
                    {diagnostics.ttnEnabled ? 'true ✓' : 'false ⚠️'}
                  </span>
                  
                  <span className="text-muted-foreground">ttn.cluster:</span>
                  <span>{diagnostics.ttnCluster || '(null)'}</span>
                  
                  <span className="text-muted-foreground">last_select_at:</span>
                  <span>{diagnostics.lastUserSelectAt ? new Date(diagnostics.lastUserSelectAt).toLocaleTimeString() : '—'}</span>
                </div>
                
                {/* Sites detail */}
                {diagnostics.userSitesRaw.length > 0 && (
                  <div className="pt-2 border-t border-muted">
                    <span className="text-muted-foreground">Sites:</span>
                    <ul className="mt-1 space-y-0.5">
                      {diagnostics.userSitesRaw.map(s => (
                        <li key={s.site_id} className="flex items-center gap-1">
                          <Database className="h-3 w-3 text-muted-foreground" />
                          <span className="truncate">{s.site_name || s.site_id}</span>
                          {s.is_default && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {/* Copy raw payload button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 h-7 text-xs"
                  onClick={() => {
                    const report = JSON.stringify({
                      diagnostics,
                      config: {
                        testOrgId: config.testOrgId,
                        testSiteId: config.testSiteId,
                        selectedUserId: config.selectedUserId,
                      },
                      timestamp: new Date().toISOString(),
                    }, null, 2);
                    navigator.clipboard.writeText(report);
                    toast({ title: 'Copied', description: 'Diagnostics copied to clipboard' });
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Debug Report
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="border-t pt-4 space-y-3">
          {/* Sync Readiness Panel */}
          {hasEntities && (
            <SyncReadinessPanel validation={validationResult} />
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-primary" />
                Sync to Dashboard
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Register all gateways and sensors in FrostGuard
              </p>
            </div>
            <Button
              onClick={syncAll}
              disabled={disabled || isSyncing || !canSync}
              variant={syncStatus === 'failed' ? 'destructive' : syncStatus === 'partial' ? 'outline' : 'default'}
              className="flex items-center gap-2"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : syncStatus === 'success' ? (
                <>
                  <Check className="h-4 w-4" />
                  Synced
                </>
              ) : syncStatus === 'partial' ? (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Partial
                </>
              ) : isRetry ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Retry Sync
                </>
              ) : syncStatus === 'failed' ? (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Retry
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4" />
                  Sync All ({gateways.length} gateways, {devices.length} sensors)
                </>
              )}
            </Button>
          </div>
          
          {/* Status messages */}
          {lastSyncSummary && syncStatus === 'success' && (
            <p className="text-xs text-green-600 dark:text-green-400">
              ✓ {lastSyncSummary}
            </p>
          )}
          {lastSyncSummary && syncStatus === 'partial' && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              ⚠ {lastSyncSummary}
            </p>
          )}
          {lastSyncError && syncStatus === 'failed' && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
              <span className="font-medium">Error: </span>
              <span className="whitespace-pre-wrap">{lastSyncError}</span>
            </div>
          )}
          {currentSyncRunId && syncStatus === 'failed' && (
            <p className="text-xs text-muted-foreground">
              Retry will use same sync ID: {currentSyncRunId.slice(0, 8)}...
            </p>
          )}
          {!hasEntities && !disabled && (
            <p className="text-xs text-muted-foreground">
              Add gateways or devices to sync
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
