import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, MapPin, Box, AlertTriangle, Radio, Star, ChevronDown, Bug, Database, AlertCircle, Copy } from 'lucide-react';
import { WebhookConfig, GatewayConfig, LoRaWANDevice } from '@/lib/ttn-payload';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { UserSite, TTNConnection } from './UserSearchDialog';
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
}

export default function TestContextConfig({ 
  config, 
  onConfigChange, 
  disabled,
  gateways = [],
  devices = [],
}: TestContextConfigProps) {
  // Site dropdown options from selected user
  const [selectedUserSites, setSelectedUserSites] = useState<UserSite[]>([]);
  const [selectedUserDefaultSite, setSelectedUserDefaultSite] = useState<string | null>(null);
  
  // TTN data from user sync payload
  const [selectedUserTTN, setSelectedUserTTN] = useState<TTNConnection | null>(null);
  
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
  });
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

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

  // Sync TTN data from global config to local state (for display in Testing tab)
  useEffect(() => {
    if (config.ttnConfig) {
      setSelectedUserTTN({
        enabled: config.ttnConfig.enabled,
        cluster: config.ttnConfig.cluster,
        application_id: config.ttnConfig.applicationId,
        api_key_last4: config.ttnConfig.api_key_last4 || null,
        webhook_secret_last4: config.ttnConfig.webhook_secret_last4 || null,
        provisioning_status: null,
        webhook_id: null,
        webhook_url: null,
        updated_at: null,
      });
    } else if (!config.selectedUserId) {
      setSelectedUserTTN(null);
    }
  }, [config.ttnConfig, config.selectedUserId]);

  // Sync user sites and diagnostics from global config
  useEffect(() => {
    if (config.selectedUserSites) {
      const sites: UserSite[] = config.selectedUserSites.map(s => ({
        site_id: s.site_id,
        site_name: s.site_name,
        is_default: s.is_default,
      }));
      setSelectedUserSites(sites);
      const defaultSite = sites.find(s => s.is_default);
      setSelectedUserDefaultSite(defaultSite?.site_id || null);

      setDiagnostics({
        selectedUserId: config.selectedUserId || null,
        selectedOrgId: config.testOrgId || null,
        selectedSiteId: config.testSiteId || null,
        userSitesCount: sites.length,
        userSitesRaw: sites,
        ttnEnabled: config.ttnConfig?.enabled || false,
        ttnCluster: config.ttnConfig?.cluster || null,
        lastUserSelectAt: config.contextSetAt || null,
      });
    } else if (!config.selectedUserId) {
      setSelectedUserSites([]);
      setSelectedUserDefaultSite(null);
    }
  }, [config.selectedUserSites, config.selectedUserId, config.testOrgId, config.testSiteId, config.ttnConfig, config.contextSetAt]);

  const update = (updates: Partial<WebhookConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const hasEntities = gateways.length > 0 || devices.length > 0;

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

        {/* User context is now managed by UserSelectionGate at app load */}

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

        {/* Sync validation status - sync happens at user selection */}
        <div className="border-t pt-4 space-y-3">
          {/* Sync Readiness Panel */}
          {hasEntities && (
            <SyncReadinessPanel validation={validationResult} />
          )}

          {/* Sync status from initial hydration */}
          {config.lastSyncSummary && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-700 dark:text-green-400">
                ✓ {config.lastSyncSummary}
              </p>
              {config.lastSyncAt && (
                <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                  Synced at {new Date(config.lastSyncAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          )}

          {!hasEntities && !disabled && (
            <p className="text-xs text-muted-foreground">
              No gateways or devices configured
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
