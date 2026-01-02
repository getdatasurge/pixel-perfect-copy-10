import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, User, AlertCircle, RefreshCw, Radio, Thermometer, CheckCircle2 } from 'lucide-react';
import { WebhookConfig, GatewayConfig as GatewayConfigType, LoRaWANDevice, SyncBundle } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import UserSearchDialog, { UserProfile, TTNConnection } from './UserSearchDialog';

const STORAGE_KEY_USER_CONTEXT = 'lorawan-emulator-user-context';

interface StoredUserContext {
  selectedUserId: string;
  selectedUserDisplayName: string;
  testOrgId: string;
  testSiteId?: string;
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
}

interface UserSelectionGateProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  gateways: GatewayConfigType[];
  devices: LoRaWANDevice[];
  children: React.ReactNode;
}

export default function UserSelectionGate({
  config,
  onConfigChange,
  gateways,
  devices,
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
          
          // Restore config from stored context
          onConfigChange({
            ...config,
            testOrgId: context.testOrgId,
            testSiteId: context.testSiteId,
            selectedUserId: context.selectedUserId,
            selectedUserDisplayName: context.selectedUserDisplayName,
            selectedUserSites: context.selectedUserSites,
            ttnConfig: context.ttnConfig,
            contextSetAt: context.syncedAt,
            isHydrated: true,
            lastSyncAt: context.syncedAt,
            lastSyncRunId: context.syncRunId,
            lastSyncSummary: context.lastSyncSummary,
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

  // Execute sync when user is selected
  const executeSync = useCallback(async (user: UserProfile) => {
    console.log('[UserSelectionGate] Executing sync for user:', user.id);
    setIsLoading(true);
    setError(null);
    setSyncSummary(null);

    const syncRunId = crypto.randomUUID();
    const syncedAt = new Date().toISOString();

    // Determine site to use
    let siteToSelect: string | undefined = undefined;
    const sites = user.user_sites || [];
    if (user.default_site_id) {
      siteToSelect = user.default_site_id;
    } else if (sites.length > 0) {
      siteToSelect = sites[0].site_id;
    } else if (user.site_id) {
      siteToSelect = user.site_id;
    }

    // Build TTN config from user data
    const ttn = user.ttn;
    const ttnConfig = ttn ? {
      enabled: ttn.enabled || false,
      applicationId: ttn.application_id || '',
      cluster: ttn.cluster || 'eu1',
      api_key_last4: ttn.api_key_last4 || null,
      webhook_secret_last4: ttn.webhook_secret_last4 || null,
    } : undefined;

    try {
      // Build sync bundle
      const syncBundle: SyncBundle = {
        metadata: {
          sync_run_id: syncRunId,
          initiated_at: syncedAt,
          source_project: 'lorawan-emulator',
        },
        context: {
          org_id: user.organization_id,
          site_id: siteToSelect,
          selected_user_id: user.id,
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

      console.log('[UserSelectionGate] Calling sync-to-frostguard...');
      const { data, error: syncError } = await supabase.functions.invoke('sync-to-frostguard', {
        body: syncBundle,
      });

      if (syncError) {
        throw new Error(syncError.message || 'Sync failed');
      }

      if (!data?.ok && !data?.success) {
        throw new Error(data?.error || 'Sync returned failure status');
      }

      const summary = data.summary || `Synced ${gateways.length} gateways, ${devices.length} devices`;
      console.log('[UserSelectionGate] Sync complete:', summary);

      // Build the fully hydrated config
      const hydratedConfig: WebhookConfig = {
        ...config,
        testOrgId: user.organization_id,
        testSiteId: siteToSelect,
        selectedUserId: user.id,
        selectedUserDisplayName: user.full_name || user.email || user.id,
        selectedUserSites: sites.map(s => ({
          site_id: s.site_id,
          site_name: s.site_name || null,
          is_default: s.site_id === user.default_site_id || s.is_default || false,
        })),
        ttnConfig,
        contextSetAt: syncedAt,
        isHydrated: true,
        lastSyncAt: syncedAt,
        lastSyncRunId: syncRunId,
        lastSyncSummary: summary,
      };

      // Store in session
      const storedContext: StoredUserContext = {
        selectedUserId: user.id,
        selectedUserDisplayName: user.full_name || user.email || user.id,
        testOrgId: user.organization_id,
        testSiteId: siteToSelect,
        ttnConfig,
        selectedUserSites: hydratedConfig.selectedUserSites || [],
        syncedAt,
        syncRunId,
        lastSyncSummary: summary,
      };
      sessionStorage.setItem(STORAGE_KEY_USER_CONTEXT, JSON.stringify(storedContext));

      // Update parent config
      onConfigChange(hydratedConfig);
      setSyncSummary(summary);
      setIsHydrated(true);
      setPendingUser(null);

      toast({
        title: 'Context Ready',
        description: summary,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[UserSelectionGate] Sync failed:', message);
      setError(message);
      toast({
        title: 'Sync Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [config, gateways, devices, onConfigChange]);

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
    setIsHydrated(false);
    setSyncSummary(null);
    setError(null);
    setPendingUser(null);
    
    // Clear hydration fields from config
    onConfigChange({
      ...config,
      testOrgId: undefined,
      testSiteId: undefined,
      selectedUserId: undefined,
      selectedUserDisplayName: undefined,
      selectedUserSites: undefined,
      ttnConfig: undefined,
      contextSetAt: undefined,
      isHydrated: false,
      lastSyncAt: undefined,
      lastSyncRunId: undefined,
      lastSyncSummary: undefined,
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
            Select a user to load organization context and sync devices
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
                <p className="font-medium">Syncing to FrostGuard...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {pendingUser?.full_name || pendingUser?.email || 'Loading user context'}
                </p>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Radio className="h-3 w-3" />
                  {gateways.length} gateways
                </span>
                <span className="flex items-center gap-1">
                  <Thermometer className="h-3 w-3" />
                  {devices.length} devices
                </span>
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
                      Load organization & site settings
                    </li>
                    <li className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Sync devices and gateways to FrostGuard
                    </li>
                    <li className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Enable TTN integration (if configured)
                    </li>
                  </ul>
                </div>
              </div>

              {/* Entity count preview */}
              <div className="border-t pt-4">
                <p className="text-xs text-muted-foreground text-center mb-2">
                  Entities to sync:
                </p>
                <div className="flex justify-center gap-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{gateways.length}</span>
                    <span className="text-muted-foreground">gateways</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Thermometer className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{devices.length}</span>
                    <span className="text-muted-foreground">devices</span>
                  </span>
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

// Export the clear function for use by UserContextBar
export { STORAGE_KEY_USER_CONTEXT };
