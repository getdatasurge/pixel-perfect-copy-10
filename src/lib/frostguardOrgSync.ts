// FrostGuard Org State Sync Client
// This is the ONLY place that talks to FrostGuard for org state.
// Uses pull-based architecture with API key authentication (no JWT, no Service Role).

import { supabase } from '@/integrations/supabase/client';
import { debug, logTimed, log } from '@/lib/debugLogger';
import { logOrgSyncEvent, updateReconciliation } from '@/lib/supportSnapshot';

// Types for the org-state-api response
export interface OrgStateSite {
  id: string;
  name: string;
  is_default?: boolean;
}

export interface OrgStateSensor {
  id: string;
  name: string;
  dev_eui: string;
  join_eui: string;
  app_key: string;
  type: 'temp' | 'door' | 'combo';
  gateway_id?: string;
  site_id?: string;
  unit_id?: string;
}

export interface OrgStateGateway {
  id: string;
  name: string;
  gateway_eui: string;
  is_online: boolean;
  site_id?: string;
}

export interface OrgStateTTN {
  enabled: boolean;
  cluster: string;
  application_id: string;
  api_key_last4?: string;
  webhook_secret_last4?: string;
}

export interface OrgStateResponse {
  ok: boolean;
  sync_version: number;
  synced_at: string;
  organization: {
    id: string;
    name: string;
  };
  sites: OrgStateSite[];
  sensors: OrgStateSensor[];
  gateways: OrgStateGateway[];
  ttn?: OrgStateTTN;
  error?: string;
}

export interface OrgState {
  sync_version: number;
  last_pulled_at: string;
  organization: { id: string; name: string };
  sites: OrgStateSite[];
  sensors: OrgStateSensor[];
  gateways: OrgStateGateway[];
  ttn?: OrgStateTTN;
}

export interface FetchOrgStateResult {
  ok: boolean;
  data?: OrgStateResponse;
  error?: string;
}

// Maximum retry attempts for transient failures
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Fetches the authoritative org state from FrostGuard via the fetch-org-state edge function.
 * This is the single source of truth for all entity data.
 * 
 * @param orgId - The organization ID to fetch state for
 * @returns FetchOrgStateResult with the org state or error
 */
export async function fetchOrgState(orgId: string): Promise<FetchOrgStateResult> {
  let lastError: string = 'Unknown error';
  const startTime = performance.now();
  
  debug.sync('Starting org state fetch', { org_id: orgId });
  const endTiming = logTimed('org-sync', 'Fetch org state from FrostGuard', { org_id: orgId });
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      debug.network(`Calling fetch-org-state edge function (attempt ${attempt + 1}/${MAX_RETRIES})`, { org_id: orgId });
      
      const { data, error } = await supabase.functions.invoke('fetch-org-state', {
        body: { org_id: orgId },
      });

      if (error) {
        lastError = error.message || 'Edge function error';
        log('network', 'error', 'Edge function error', { error: lastError, attempt: attempt + 1 });
        
        // Don't retry on auth/permission errors
        if (error.message?.includes('401') || error.message?.includes('403')) {
          debug.error('Auth/permission error - not retrying', { error: lastError });
          endTiming();
          // Log sync event for snapshot
          logOrgSyncEvent({
            timestamp: new Date().toISOString(),
            status: 'error',
            duration_ms: Math.round(performance.now() - startTime),
            error: lastError,
          });
          return { ok: false, error: lastError };
        }
        
        // Wait before retrying for transient errors
        if (attempt < MAX_RETRIES - 1) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          log('network', 'warn', `Retrying in ${backoff}ms...`, { attempt: attempt + 1, backoff_ms: backoff });
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        endTiming();
        // Log sync event for snapshot
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: lastError,
        });
        return { ok: false, error: lastError };
      }

      if (!data) {
        lastError = 'No data returned from fetch-org-state';
        debug.error(lastError, { org_id: orgId });
        endTiming();
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: lastError,
        });
        return { ok: false, error: lastError };
      }

      if (!data.ok) {
        lastError = data.error || 'FrostGuard returned failure status';
        debug.error('FrostGuard API error', { error: lastError, org_id: orgId });
        endTiming();
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: lastError,
        });
        return { ok: false, error: lastError };
      }

      const duration = Math.round(performance.now() - startTime);
      debug.sync('Successfully fetched org state', {
        sync_version: data.sync_version,
        sites_count: data.sites?.length || 0,
        sensors_count: data.sensors?.length || 0,
        gateways_count: data.gateways?.length || 0,
        ttn_enabled: data.ttn?.enabled || false,
        org_name: data.organization?.name,
      });

      endTiming();
      
      // Log successful sync event for snapshot
      logOrgSyncEvent({
        timestamp: new Date().toISOString(),
        status: 'success',
        duration_ms: duration,
        sync_version: data.sync_version,
        counts: {
          sites: data.sites?.length || 0,
          sensors: data.sensors?.length || 0,
          gateways: data.gateways?.length || 0,
        },
      });
      
      return { ok: true, data };
      
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log('network', 'error', 'Unexpected error during fetch', { error: lastError, attempt: attempt + 1 });
      
      // Wait before retrying
      if (attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  debug.error(`Failed after ${MAX_RETRIES} attempts`, { last_error: lastError });
  endTiming();
  logOrgSyncEvent({
    timestamp: new Date().toISOString(),
    status: 'error',
    duration_ms: Math.round(performance.now() - startTime),
    error: `Failed after ${MAX_RETRIES} attempts: ${lastError}`,
  });
  return { ok: false, error: `Failed after ${MAX_RETRIES} attempts: ${lastError}` };
}

/**
 * Compares sync versions to determine if state should be updated.
 * 
 * @param currentVersion - The current local sync version (or undefined if none)
 * @param newVersion - The new sync version from FrostGuard
 * @returns true if state should be updated
 */
export function shouldUpdateState(currentVersion: number | undefined, newVersion: number): boolean {
  if (currentVersion === undefined) {
    return true; // No local state, always update
  }
  return newVersion > currentVersion;
}

/**
 * Logs entity changes for debugging and UI feedback.
 * 
 * @param previousIds - Set of entity IDs before sync
 * @param newIds - Set of entity IDs after sync
 * @param entityType - Type of entity for logging
 * @returns Object with added and removed counts
 */
export function trackEntityChanges(
  previousIds: Set<string>,
  newIds: Set<string>,
  entityType: string
): { added: number; removed: number; removedIds: string[] } {
  const added = [...newIds].filter(id => !previousIds.has(id)).length;
  const removedIds = [...previousIds].filter(id => !newIds.has(id));
  const removed = removedIds.length;

  if (added > 0 || removed > 0) {
    console.log(`[frostguardOrgSync] ${entityType} changes: +${added} added, -${removed} removed`);
    if (removedIds.length > 0) {
      console.log(`[frostguardOrgSync] Removed ${entityType} IDs:`, removedIds);
    }
    
    // Update reconciliation summary for snapshot
    if (entityType === 'gateways' || entityType === 'gateway') {
      updateReconciliation({ gateways_added: added, gateways_removed: removed });
    } else if (entityType === 'sensors' || entityType === 'sensor' || entityType === 'devices') {
      updateReconciliation({ sensors_added: added, sensors_removed: removed });
    }
  }

  return { added, removed, removedIds };
}
