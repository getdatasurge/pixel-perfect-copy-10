import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, User, AlertCircle, RefreshCw, Radio, Thermometer, CheckCircle2, Download } from 'lucide-react';
import { WebhookConfig, GatewayConfig as GatewayConfigType, LoRaWANDevice } from '@/lib/ttn-payload';
import { fetchOrgState, trackEntityChanges, OrgStateResponse } from '@/lib/frostguardOrgSync';
import { toast } from '@/hooks/use-toast';
import UserSearchDialog, { UserProfile } from './UserSearchDialog';
import { debug, log, logStateReplacement, setDebugContext, clearDebugContext } from '@/lib/debugLogger';

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
  }>;
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
  const [error, setError] = useState<string | null>(null);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<UserProfile | null>(null);

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
        throw new Error(result.error || 'Failed to fetch org state from FrostGuard');
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

      const pulledDevices: LoRaWANDevice[] = (orgState.sensors || []).map(s => ({
        id: s.id,
        name: s.name,
        devEui: s.dev_eui,
        joinEui: s.join_eui,
        appKey: s.app_key,
        type: s.type === 'door' ? 'door' : 'temperature',
        gatewayId: s.gateway_id || '',
      }));

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

      // Show toast with removal info if applicable
      let toastDescription = summary;
      if (gatewayChanges.removed > 0 || deviceChanges.removed > 0) {
        toastDescription += ' (entities removed due to upstream changes)';
      }

      toast({
        title: 'Context Ready',
        description: toastDescription,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[UserSelectionGate] Pull sync failed:', message);
      setError(message);
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
    console.log('[UserSelectionGate] User selected:', user.id);
    setPendingUser(user);
    setShowUserSearch(false);
    executeSync(user);
  }, [executeSync]);

  // Clear context and return to selection
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
          {/* Error state */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Sync Failed</AlertTitle>
              <AlertDescription className="mt-2">
                {error}
              </AlertDescription>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pendingUser && executeSync(pendingUser)}
                  disabled={isLoading || !pendingUser}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setPendingUser(null);
                  }}
                >
                  Change User
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
