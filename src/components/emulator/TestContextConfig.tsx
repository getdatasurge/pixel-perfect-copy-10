import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, MapPin, Box, Cloud, Loader2, Check, AlertTriangle, User, X, RefreshCw, Star } from 'lucide-react';
import { WebhookConfig, GatewayConfig, LoRaWANDevice, SyncBundle, SyncResult } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import UserSearchDialog, { UserSite } from './UserSearchDialog';
import SyncReadinessPanel from './SyncReadinessPanel';
import { validateSyncBundle, ValidationResult } from '@/lib/sync-validation';

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
  onSyncResult
}: TestContextConfigProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [cachedUserCount, setCachedUserCount] = useState<number | null>(null);
  
  // Site dropdown options from selected user
  const [selectedUserSites, setSelectedUserSites] = useState<UserSite[]>([]);
  const [selectedUserDefaultSite, setSelectedUserDefaultSite] = useState<string | null>(null);
  
  // Sync run ID for idempotency - persists across retries
  const [currentSyncRunId, setCurrentSyncRunId] = useState<string | null>(null);
  const lastSyncMethodRef = useRef<'endpoint' | 'direct' | null>(null);

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
              // Store user sites for dropdown
              setSelectedUserSites(user.user_sites || []);
              setSelectedUserDefaultSite(user.default_site_id || null);
              
              // Auto-select site logic
              let siteToSelect: string | undefined = undefined;
              if (user.default_site_id) {
                siteToSelect = user.default_site_id;
              } else if (user.user_sites && user.user_sites.length === 1) {
                siteToSelect = user.user_sites[0].site_id;
              } else if (user.site_id) {
                // Fallback to legacy single site
                siteToSelect = user.site_id;
              }
              
              update({
                testOrgId: user.organization_id,
                testSiteId: siteToSelect,
                testUnitId: user.unit_id || undefined,
                selectedUserId: user.id,
                selectedUserDisplayName: user.full_name || user.email || user.id,
                contextSetAt: new Date().toISOString(),
              });
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
            <p className="text-xs text-muted-foreground">
              {selectedUserSites.length > 0 
                ? `${selectedUserSites.length} site(s) for selected user`
                : config.selectedUserId 
                  ? 'No sites available for this user'
                  : 'Select a user to see available sites'}
            </p>
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
