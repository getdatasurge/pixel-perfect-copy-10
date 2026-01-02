import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, User, AlertCircle, RefreshCw, Thermometer, CheckCircle2, Download, FileDown, ChevronDown, Terminal, Copy } from 'lucide-react';
import { WebhookConfig, GatewayConfig as GatewayConfigType, LoRaWANDevice } from '@/lib/ttn-payload';
import { fetchOrgState, trackEntityChanges, OrgStateResponse, FrostGuardErrorDetails, generateCurlCommand, backfillMissingCredentials } from '@/lib/frostguardOrgSync';
import { toast } from '@/hooks/use-toast';
import UserSearchDialog, { UserProfile } from './UserSearchDialog';
import { debug, log, clearDebugContext, setDebugContext } from '@/lib/debugLogger';
import { buildSupportSnapshot, downloadSnapshot } from '@/lib/supportSnapshot';

const STORAGE_KEY_USER_CONTEXT = 'lorawan-emulator-user-context';

interface StoredUserContext {
  selectedUserId: string;
  selectedUserDisplayName: string;
  testOrgId: string;
  testSiteId?: string;
  orgName?: string;
  ttnConfig?: {
    enabled: boolean;
    applicationId: string;
    cluster: string;
    api_key_last4?: string | null;
    webhook_secret_last4?: string | null;
  };
  selectedUserSites: Array<{ site_id: string; site_name: string | null; is_default: boolean }>;
  syncedAt: string;
  syncRunId: string;
  lastSyncSummary?: string;
  syncVersion: number;
  // Pulled entities from FrostGuard
  pulledGateways: Array<{
    id: string;
    name: string;
    eui: string;
    isOnline: boolean;
  }>;
  pulledDevices: Array<{
    id: string;
    name: string;
    devEui: string;
    joinEui: string;
    appKey: string;
    type: 'temperature' | 'door';
    gatewayId: string;
    credentialSource?: 'frostguard_pull' | 'frostguard_generated' | 'local_generated' | 'manual_override';
    credentialsLockedFromFrostguard?: boolean;
  }>;
  devicesMissingCredentials?: string[]; // dev_eui list for backfill tracking
}

interface UserSelectionGateProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  gateways: GatewayConfigType[];
  devices: LoRaWANDevice[];
  onGatewaysChange: (gateways: GatewayConfigType[]) => void;
  onDevicesChange: (devices: LoRaWANDevice[]) => void;
  children: React.ReactNode;
}

export default function UserSelectionGate({
  config,
  onConfigChange,
  gateways,
  devices,
  onGatewaysChange,
  onDevicesChange,
  children,
}: UserSelectionGateProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; details?: FrostGuardErrorDetails } | null>(null);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<UserProfile | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Check for stored context on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY_USER_CONTEXT);
    if (stored) {
      try {
        const context: StoredUserContext = JSON.parse(stored);
        const syncedAt = new Date(context.syncedAt);
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

        // If context is recent (< 1 hour), restore it
        if (syncedAt > hourAgo && context.selectedUserId) {
          console.log('[UserSelectionGate] Restoring context from session:', context.selectedUserId);
          
          // Restore pulled gateways and devices
          if (context.pulledGateways?.length > 0) {
            onGatewaysChange(context.pulledGateways);
          }
          if (context.pulledDevices?.length > 0) {
            onDevicesChange(context.pulledDevices);
          }
          
          // Restore config from stored context
          onConfigChange({
            ...config,
            testOrgId: context.testOrgId,
            testSiteId: context.testSiteId,
            orgName: context.orgName,
            selectedUserId: context.selectedUserId,
            selectedUserDisplayName: context.selectedUserDisplayName,
            selectedUserSites: context.selectedUserSites,
            ttnConfig: context.ttnConfig,
            contextSetAt: context.syncedAt,
            isHydrated: true,
            lastSyncAt: context.syncedAt,
            lastSyncRunId: context.syncRunId,
            lastSyncSummary: context.lastSyncSummary,
            lastSyncVersion: context.syncVersion,
          });
          
          setSyncSummary(context.lastSyncSummary || null);
          setIsHydrated(true);
          return;
        }
      } catch (e) {
        console.error('[UserSelectionGate] Failed to parse stored context:', e);
        sessionStorage.removeItem(STORAGE_KEY_USER_CONTEXT);
      }
    }
    
    // No valid stored context - show selection UI
    console.log('[UserSelectionGate] No valid stored context, showing selection UI');
  }, []);

  // Execute PULL-BASED sync when user is selected
  const executeSync = useCallback(async (user: UserProfile) => {
    debug.context('User selected - starting pull-based sync', {
      user_id: user.id,
      email: user.email,
      organization_id: user.organization_id,
    });
    
    setIsLoading(true);
    setError(null);
    setSyncSummary(null);

    const syncRunId = crypto.randomUUID();
    const syncedAt = new Date().toISOString();

    try {
      // PULL authoritative state from FrostGuard
      console.log('[UserSelectionGate] Pulling org state from FrostGuard...');
      const result = await fetchOrgState(user.organization_id);

      if (!result.ok || !result.data) {
        // Set structured error with full details - do NOT update any local state
        setError({
          message: result.error || 'Failed to fetch org state from FrostGuard',
          details: result.errorDetails,
        });
        setIsLoading(false);
        return; // Early exit, no state mutation on failure
      }

      const orgState: OrgStateResponse = result.data;
      console.log('[UserSelectionGate] Received org state:', {
        sync_version: orgState.sync_version,
        sites: orgState.sites?.length || 0,
        sensors: orgState.sensors?.length || 0,
        gateways: orgState.gateways?.length || 0,
      });

      // Track entity changes for UI feedback
      const previousGatewayIds = new Set(gateways.map(g => g.id));
      const previousDeviceIds = new Set(devices.map(d => d.id));
      const newGatewayIds = new Set(orgState.gateways?.map(g => g.id) || []);
      const newDeviceIds = new Set(orgState.sensors?.map(s => s.id) || []);

      const gatewayChanges = trackEntityChanges(previousGatewayIds, newGatewayIds, 'gateways');
      const deviceChanges = trackEntityChanges(previousDeviceIds, newDeviceIds, 'sensors');

      // COMPLETELY REPLACE local state with pulled data (authoritative replace semantics)
      const pulledGateways: GatewayConfigType[] = (orgState.gateways || []).map(g => ({
        id: g.id,
        name: g.name,
        eui: g.gateway_eui,
        isOnline: g.is_online,
      }));

      const pulledDevices: LoRaWANDevice[] = (orgState.sensors || []).map(s => {
        const hasFrostguardCredentials = !!s.join_eui && !!s.app_key;
        return {
          id: s.id,
          name: s.name,
          devEui: s.dev_eui,
          joinEui: s.join_eui || '',
          appKey: s.app_key || '',
          type: s.type === 'door' ? 'door' : 'temperature',
          gatewayId: s.gateway_id || '',
          credentialSource: hasFrostguardCredentials ? 'frostguard_pull' as const : undefined,
          credentialsLockedFromFrostguard: hasFrostguardCredentials,
        };
      });

      // Identify devices missing credentials for backfill
      const devicesMissingCredentials = pulledDevices.filter(d => !d.joinEui || !d.appKey);
      if (devicesMissingCredentials.length > 0) {
        debug.sync('Devices missing OTAA credentials - will trigger backfill', {
          count: devicesMissingCredentials.length,
          devEuis: devicesMissingCredentials.map(d => d.devEui.slice(-4)),
        });
      }

      // Update local state (complete replacement, not merge)
      onGatewaysChange(pulledGateways);
      onDevicesChange(pulledDevices);

      // Clear localStorage cache - it's stale after pull
      localStorage.removeItem('lorawan-emulator-gateways');
      localStorage.removeItem('lorawan-emulator-devices');

      // Build sites array from pulled data
      const sites = (orgState.sites || []).map(s => ({
        site_id: s.id,
        site_name: s.name || null,
        is_default: s.is_default || false,
      }));

      // Determine site to use
      let siteToSelect: string | undefined = undefined;
      const defaultSite = sites.find(s => s.is_default);
      if (defaultSite) {
        siteToSelect = defaultSite.site_id;
      } else if (sites.length > 0) {
        siteToSelect = sites[0].site_id;
      } else if (user.default_site_id) {
        siteToSelect = user.default_site_id;
      }

      // Build TTN config from pulled data
      const ttnConfig = orgState.ttn ? {
        enabled: orgState.ttn.enabled || false,
        applicationId: orgState.ttn.application_id || '',
        cluster: orgState.ttn.cluster || 'eu1',
        api_key_last4: orgState.ttn.api_key_last4 || null,
        webhook_secret_last4: orgState.ttn.webhook_secret_last4 || null,
      } : undefined;

      // Build summary message
      const summaryParts: string[] = [];
      summaryParts.push(`v${orgState.sync_version}`);
      summaryParts.push(`${pulledGateways.length} gateways`);
      summaryParts.push(`${pulledDevices.length} sensors`);
      if (gatewayChanges.removed > 0) {
        summaryParts.push(`-${gatewayChanges.removed} gw removed`);
      }
      if (deviceChanges.removed > 0) {
        summaryParts.push(`-${deviceChanges.removed} sensors removed`);
      }
      const summary = `Pulled: ${summaryParts.join(', ')}`;
      console.log('[UserSelectionGate] Sync complete:', summary);

      // Build the fully hydrated config
      const hydratedConfig: WebhookConfig = {
        ...config,
        testOrgId: user.organization_id,
        testSiteId: siteToSelect,
        orgName: orgState.organization?.name,
        selectedUserId: user.id,
        selectedUserDisplayName: user.full_name || user.email || user.id,
        selectedUserSites: sites,
        ttnConfig,
        contextSetAt: syncedAt,
        isHydrated: true,
        lastSyncAt: syncedAt,
        lastSyncRunId: syncRunId,
        lastSyncSummary: summary,
        lastSyncVersion: orgState.sync_version,
      };

      // Store in session (including pulled entities for restoration)
      const storedContext: StoredUserContext = {
        selectedUserId: user.id,
        selectedUserDisplayName: user.full_name || user.email || user.id,
        testOrgId: user.organization_id,
        testSiteId: siteToSelect,
        orgName: orgState.organization?.name,
        ttnConfig,
        selectedUserSites: sites,
        syncedAt,
        syncRunId,
        lastSyncSummary: summary,
        syncVersion: orgState.sync_version,
        pulledGateways,
        pulledDevices,
      };
      sessionStorage.setItem(STORAGE_KEY_USER_CONTEXT, JSON.stringify(storedContext));

      // Update parent config
      onConfigChange(hydratedConfig);
      setSyncSummary(summary);
      setIsHydrated(true);
      setPendingUser(null);
      setRetryCount(0); // Reset retry count on success

      // Show toast with removal info if applicable
      let toastDescription = summary;
      if (gatewayChanges.removed > 0 || deviceChanges.removed > 0) {
        toastDescription += ' (entities removed due to upstream changes)';
      }

      toast({
        title: 'Context Ready',
        description: toastDescription,
      });

      // Trigger async backfill for devices missing credentials (non-blocking)
      if (devicesMissingCredentials.length > 0) {
        backfillMissingCredentials(
          user.organization_id,
          devicesMissingCredentials.map(d => ({ id: d.id, devEui: d.devEui }))
        ).then(backfillResults => {
          if (backfillResults.length > 0) {
            // Merge backfilled credentials into devices
            const updatedDevices = pulledDevices.map(device => {
              const backfilled = backfillResults.find(r => r.id === device.id);
              if (backfilled) {
                return {
                  ...device,
                  joinEui: backfilled.joinEui,
                  appKey: backfilled.appKey,
                  credentialSource: 'frostguard_generated' as const,
                  credentialsLockedFromFrostguard: true,
                };
              }
              return device;
            });
            
            onDevicesChange(updatedDevices);
            
            // Update session storage with backfilled devices
            const currentContext = sessionStorage.getItem(STORAGE_KEY_USER_CONTEXT);
            if (currentContext) {
              const parsed = JSON.parse(currentContext);
              parsed.pulledDevices = updatedDevices;
              sessionStorage.setItem(STORAGE_KEY_USER_CONTEXT, JSON.stringify(parsed));
            }
            
            toast({
              title: 'Credentials Resolved',
              description: `${backfillResults.length} device(s) now have OTAA credentials from FrostGuard`,
            });
          }
        }).catch(err => {
          debug.error('Backfill failed', { error: err instanceof Error ? err.message : String(err) });
          // Don't show error toast - devices still work, just without FrostGuard credentials
        });
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[UserSelectionGate] Pull sync failed:', message);
      setError({ message });
      toast({
        title: 'Sync Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [config, gateways, devices, onConfigChange, onGatewaysChange, onDevicesChange]);

  // Handle user selection from dialog
  const handleUserSelect = useCallback((user: UserProfile) => {
    // Set debug context immediately on user selection
    setDebugContext({
      userId: user.id,
      userEmail: user.email,
      orgId: user.organization_id,
    });
    
    debug.context('User selected from search', { 
      userId: user.id, 
      email: user.email,
      orgId: user.organization_id,
    });
    console.log('[UserSelectionGate] User selected:', user.id);
    setPendingUser(user);
    setShowUserSearch(false);
    executeSync(user);
  }, [executeSync]);

  // Handle retry with backoff for 5xx errors
  const handleRetry = useCallback(async () => {
    if (!pendingUser) return;
    
    const lastStatus = error?.details?.status_code;
    
    // For 5xx errors, add exponential backoff
    if (lastStatus && lastStatus >= 500 && retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000;
      toast({
        title: `Retrying in ${delay / 1000}s...`,
        description: 'Server error - automatic retry with backoff',
      });
      await new Promise(r => setTimeout(r, delay));
      setRetryCount(prev => prev + 1);
    }
    
    executeSync(pendingUser);
  }, [pendingUser, error, retryCount, executeSync]);

  // Export snapshot for support
  const handleExportErrorSnapshot = useCallback(() => {
    const snapshot = buildSupportSnapshot({
      errorEntryId: `sync-error-${Date.now()}`,
    });
    downloadSnapshot(snapshot);
    toast({
      title: 'Support snapshot exported',
      description: 'Redacted diagnostic data saved to file',
    });
  }, []);

  // Copy cURL command for debugging
  const handleCopyCurl = useCallback(() => {
    const orgId = pendingUser?.organization_id || '[ORG_ID]';
    const curlCommand = generateCurlCommand(orgId);
    navigator.clipboard.writeText(curlCommand);
    toast({
      title: 'cURL command copied',
      description: 'Paste in terminal to reproduce the request',
    });
  }, [pendingUser, error]);

  // Copy request ID for support
  const handleCopyRequestId = useCallback(() => {
    const requestId = error?.details?.request_id;
    if (requestId) {
      navigator.clipboard.writeText(requestId);
      toast({
        title: 'Request ID copied',
        description: requestId,
      });
    }
  }, [error]);

  // Clear context and reset to selection
  const handleClearAndReset = useCallback(() => {
    console.log('[UserSelectionGate] Clearing context and resetting');
    sessionStorage.removeItem(STORAGE_KEY_USER_CONTEXT);
    localStorage.removeItem('lorawan-emulator-gateways');
    localStorage.removeItem('lorawan-emulator-devices');
    
    clearDebugContext();
    setIsHydrated(false);
    setSyncSummary(null);
    setError(null);
    setPendingUser(null);
    setRetryCount(0);
    
    onConfigChange({
      ...config,
      testOrgId: undefined,
      testSiteId: undefined,
      orgName: undefined,
      selectedUserId: undefined,
      selectedUserDisplayName: undefined,
      selectedUserSites: undefined,
      ttnConfig: undefined,
      contextSetAt: undefined,
      isHydrated: false,
      lastSyncAt: undefined,
      lastSyncRunId: undefined,
      lastSyncSummary: undefined,
      lastSyncVersion: undefined,
    });
    
    debug.context('User context reset - ready for new selection');
  }, [config, onConfigChange]);

  // Clear context and return to selection (keeps original for compatibility)
  const handleClearContext = useCallback(() => {
    console.log('[UserSelectionGate] Clearing context');
    sessionStorage.removeItem(STORAGE_KEY_USER_CONTEXT);
    // Also clear localStorage cache for entities
    localStorage.removeItem('lorawan-emulator-gateways');
    localStorage.removeItem('lorawan-emulator-devices');
    
    setIsHydrated(false);
    setSyncSummary(null);
    setError(null);
    setPendingUser(null);
    
    // Clear hydration fields from config
    onConfigChange({
      ...config,
      testOrgId: undefined,
      testSiteId: undefined,
      orgName: undefined,
      selectedUserId: undefined,
      selectedUserDisplayName: undefined,
      selectedUserSites: undefined,
      ttnConfig: undefined,
      contextSetAt: undefined,
      isHydrated: false,
      lastSyncAt: undefined,
      lastSyncRunId: undefined,
      lastSyncSummary: undefined,
      lastSyncVersion: undefined,
    });
  }, [config, onConfigChange]);

  // If hydrated, render children
  if (isHydrated) {
    return <>{children}</>;
  }

  // Blocking selection/sync UI
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Thermometer className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">LoRaWAN Device Emulator</CardTitle>
          <CardDescription>
            Select a user to pull organization state from FrostGuard
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Error state - Enhanced with structured details */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="flex items-center gap-2">
                Sync Failed
                {error.details?.status_code && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {error.details.status_code}
                  </Badge>
                )}
                {error.details?.error_code && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {error.details.error_code}
                  </Badge>
                )}
              </AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                {/* Error message */}
                <p className="font-medium">{error.message}</p>
                
                {/* Hint */}
                {error.details?.hint && (
                  <p className="text-sm opacity-90">{error.details.hint}</p>
                )}

                {/* Request diagnostics */}
                <div className="text-xs opacity-75 space-y-1 pt-2 border-t border-destructive/20">
                  {error.details?.request_id && (
                    <p>Request ID: <code className="bg-muted px-1 rounded text-[10px]">{error.details.request_id}</code></p>
                  )}
                  <p>Endpoint: <code className="bg-muted px-1 rounded text-[10px]">fetch-org-state</code></p>
                  <p>Target: <code className="bg-muted px-1 rounded text-[10px]">FrostGuard org-state-api</code></p>
                  {error.details?.diagnostics?.duration_ms && (
                    <p>Duration: <code className="bg-muted px-1 rounded text-[10px]">{error.details.diagnostics.duration_ms}ms</code></p>
                  )}
                  {error.details?.diagnostics?.frostguard_host && (
                    <p>Host: <code className="bg-muted px-1 rounded text-[10px]">{error.details.diagnostics.frostguard_host}</code></p>
                  )}
                </div>
                
                {/* Expandable technical details */}
                {(error.details?.details || error.details?.diagnostics) && (
                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center gap-1 text-xs underline hover:no-underline">
                      <ChevronDown className="h-3 w-3" />
                      Show technical details
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-auto max-h-40 whitespace-pre-wrap">
                        {JSON.stringify({
                          diagnostics: error.details?.diagnostics,
                          details: error.details?.details,
                        }, null, 2)}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </AlertDescription>
              
              {/* Action buttons */}
              <div className="mt-4 flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  disabled={isLoading || !pendingUser}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCurl}
                >
                  <Terminal className="h-4 w-4 mr-2" />
                  Copy cURL
                </Button>
                {error.details?.request_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyRequestId}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Request ID
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportErrorSnapshot}
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Export Snapshot
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAndReset}
                >
                  Reset & Change User
                </Button>
              </div>
            </Alert>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center py-8 gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Pulling from FrostGuard...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {pendingUser?.full_name || pendingUser?.email || 'Loading organization state'}
                </p>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Download className="h-3 w-3" />
                <span>Fetching sites, sensors, gateways, TTN config</span>
              </div>
            </div>
          )}

          {/* Selection UI */}
          {!isLoading && !error && (
            <>
              <div className="space-y-4">
                <Button
                  className="w-full h-12"
                  onClick={() => setShowUserSearch(true)}
                >
                  <User className="h-5 w-5 mr-2" />
                  Select User
                </Button>

                <div className="text-center text-sm text-muted-foreground">
                  <p>User context is required to:</p>
                  <ul className="mt-2 space-y-1">
                    <li className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Pull organization & site settings from FrostGuard
                    </li>
                    <li className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Load authoritative sensors and gateways
                    </li>
                    <li className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Enable TTN integration (if configured)
                    </li>
                  </ul>
                </div>
              </div>

              {/* Pull-based info */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Download className="h-4 w-4" />
                  <span>Pull-based sync — FrostGuard is the source of truth</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <UserSearchDialog
        open={showUserSearch}
        onClose={() => setShowUserSearch(false)}
        onUserSelect={handleUserSelect}
        disabled={isLoading}
        cachedUserCount={null}
      />
    </div>
  );
}

// Export the storage key and clear function for use by UserContextBar
export { STORAGE_KEY_USER_CONTEXT };
