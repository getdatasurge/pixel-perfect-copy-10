// FrostGuard Org State Sync Client
// This is the ONLY place that talks to FrostGuard for org state.
// Uses pull-based architecture with API key authentication (no JWT, no Service Role).

import { supabase } from '@/integrations/supabase/client';
import { debug, logTimed, log, setDebugContext } from '@/lib/debugLogger';
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

// Request diagnostics for debugging
export interface RequestDiagnostics {
  endpoint: string;
  target_url_redacted?: string;
  duration_ms?: number;
  response_status?: number;
  response_status_text?: string;
  response_content_type?: string;
  response_body_snippet?: string;
  auth_header_present?: boolean;
  auth_key_last4?: string;
  frostguard_host?: string;
}

// Structured error details for debugging and UI
export interface FrostGuardErrorDetails {
  status_code?: number;
  error_code?: string;
  request_id?: string;
  message: string;
  details?: unknown;
  hint: string;  // User-friendly next step
  diagnostics?: RequestDiagnostics;
}

export interface FetchOrgStateResult {
  ok: boolean;
  data?: OrgStateResponse;
  error?: string;
  errorDetails?: FrostGuardErrorDetails;
}

/**
 * Generates user-friendly hints based on error status codes and messages.
 */
function getErrorHint(status?: number, code?: string, message?: string): string {
  // Status-specific hints
  if (status === 401) {
    return 'Unauthorized: The SYNC API key is invalid or missing. Check PROJECT2_SYNC_API_KEY in project secrets.';
  }
  if (status === 403) {
    return 'Forbidden: The API key lacks permissions for this organization. Verify the key has access to org-state-api.';
  }
  if (status === 400) {
    if (code === 'MISSING_ORG_ID') return 'Bad request: No organization ID was provided. Try selecting a different user.';
    if (code === 'INVALID_ORG_ID') return 'Bad request: The organization ID format is invalid. Must be a valid UUID.';
    return 'Bad request: The request was malformed. Check the organization ID.';
  }
  if (status === 404) {
    return 'Not found: The org-state-api endpoint or organization does not exist. Check FROSTGUARD_SUPABASE_URL.';
  }
  if (status === 500) {
    return 'FrostGuard internal error: The org-state-api edge function failed. Export a snapshot and check FrostGuard logs with the request ID.';
  }
  if (status === 502 || status === 503) {
    return 'FrostGuard unavailable: The service is temporarily unavailable. Try again in a moment.';
  }
  
  // Error code specific hints
  if (code === 'CONFIG_MISSING') {
    return 'Edge function configuration incomplete. FROSTGUARD_SUPABASE_URL or PROJECT2_SYNC_API_KEY is not set in project secrets.';
  }
  if (code === 'UPSTREAM_FAILURE') {
    return 'FrostGuard rejected the request. The organization may not exist in FrostGuard or the API key may lack permissions for this org.';
  }
  if (code === 'NETWORK_ERROR' || code === 'CORS_BLOCKED') {
    return 'Network error: Check your internet connection and that FrostGuard is accessible.';
  }
  
  // Message-based hints
  if (message?.includes('not configured')) {
    return 'Check project secrets configuration in Lovable settings. Required: FROSTGUARD_SUPABASE_URL and PROJECT2_SYNC_API_KEY.';
  }
  if (message?.includes('Failed after') || message?.includes('timeout')) {
    return 'Network connection issues. Check your internet connection and try again.';
  }
  if (message?.includes('CORS') || message?.includes('blocked')) {
    return 'Browser blocked the request (CORS). This may indicate the edge function is not responding correctly.';
  }
  
  return 'Try again or export a support snapshot for diagnosis.';
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
  
  // Build base diagnostics
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const buildDiagnostics = (extra: Partial<RequestDiagnostics> = {}): RequestDiagnostics => ({
    endpoint: 'fetch-org-state',
    target_url_redacted: supabaseUrl 
      ? `${supabaseUrl}/functions/v1/fetch-org-state` 
      : '[NOT_CONFIGURED]',
    auth_header_present: true, // Supabase client adds this automatically
    duration_ms: Math.round(performance.now() - startTime),
    ...extra,
  });
  
  // Validate org_id format (UUID) before making the request
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orgId)) {
    const errorDetails: FrostGuardErrorDetails = {
      status_code: 400,
      error_code: 'INVALID_ORG_ID',
      message: 'Invalid organization ID format',
      hint: 'The organization ID must be a valid UUID. Try selecting a different user.',
      diagnostics: buildDiagnostics(),
    };
    log('network', 'error', 'VALIDATION_ERROR', { org_id: orgId, error: 'Invalid UUID format' });
    logOrgSyncEvent({
      timestamp: new Date().toISOString(),
      status: 'error',
      duration_ms: Math.round(performance.now() - startTime),
      error: errorDetails.message,
      error_code: 'INVALID_ORG_ID',
      endpoint: 'fetch-org-state',
    });
    return { ok: false, error: errorDetails.message, errorDetails };
  }

  // Set debug context for this sync operation
  setDebugContext({
    orgId,
    lastSyncAt: new Date().toISOString(),
  });

  debug.sync('Starting org state fetch', { org_id: orgId });
  const endTiming = logTimed('org-sync', 'Fetch org state from FrostGuard', { org_id: orgId });
  
  // Log start event for debug terminal with endpoint info
  log('network', 'info', 'PULL_ORG_STATE_START', { 
    org_id: orgId,
    endpoint: 'fetch-org-state',
    target: 'FrostGuard org-state-api',
    supabase_url: supabaseUrl ? '✓ configured' : '✗ missing',
    timestamp: new Date().toISOString(),
  });
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      debug.network(`Calling fetch-org-state edge function (attempt ${attempt + 1}/${MAX_RETRIES})`, { org_id: orgId });
      
      const { data, error } = await supabase.functions.invoke('fetch-org-state', {
        body: { org_id: orgId },
      });

      if (error) {
        lastError = error.message || 'Edge function error';
        log('network', 'error', 'Edge function error', { error: lastError, attempt: attempt + 1 });
        
        // Check for CORS-like errors
        if (lastError.includes('CORS') || lastError.includes('blocked') || lastError.includes('network')) {
          debug.error('Network/CORS error - not retrying', { error: lastError });
          endTiming();
          const errorDetails: FrostGuardErrorDetails = {
            error_code: 'CORS_BLOCKED',
            message: 'Request blocked by browser (possible CORS issue)',
            hint: getErrorHint(undefined, 'CORS_BLOCKED', lastError),
            diagnostics: buildDiagnostics(),
          };
          logOrgSyncEvent({
            timestamp: new Date().toISOString(),
            status: 'error',
            duration_ms: Math.round(performance.now() - startTime),
            error: lastError,
            error_code: 'CORS_BLOCKED',
            endpoint: 'fetch-org-state',
          });
          return { ok: false, error: lastError, errorDetails };
        }
        
        // Don't retry on auth/permission errors
        if (error.message?.includes('401') || error.message?.includes('403')) {
          debug.error('Auth/permission error - not retrying', { error: lastError });
          endTiming();
          logOrgSyncEvent({
            timestamp: new Date().toISOString(),
            status: 'error',
            duration_ms: Math.round(performance.now() - startTime),
            error: lastError,
            error_code: error.message?.includes('401') ? 'HTTP_401' : 'HTTP_403',
            endpoint: 'fetch-org-state',
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
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: lastError,
          endpoint: 'fetch-org-state',
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
          endpoint: 'fetch-org-state',
        });
        return { ok: false, error: lastError };
      }

      if (!data.ok) {
        const statusCode = data.status_code as number | undefined;
        const errorCode = data.error_code as string | undefined;
        const requestId = data.request_id as string | undefined;
        const errorMessage = data.error || 'FrostGuard returned failure status';
        const upstreamDiagnostics = data.diagnostics as RequestDiagnostics | undefined;
        
        // Build structured error details with full diagnostics
        const errorDetails: FrostGuardErrorDetails = {
          status_code: statusCode,
          error_code: errorCode,
          request_id: requestId,
          message: errorMessage,
          details: data.details,
          hint: data.hint || getErrorHint(statusCode, errorCode, errorMessage),
          diagnostics: upstreamDiagnostics || buildDiagnostics({
            response_status: statusCode,
          }),
        };
        
        debug.error('FrostGuard API error', { 
          ...errorDetails,
          org_id: orgId,
        });
        
        // Log network event for debug terminal with full details
        log('network', 'error', 'PULL_ORG_STATE_ERROR', {
          org_id: orgId,
          endpoint: 'fetch-org-state',
          target: 'FrostGuard org-state-api',
          status_code: statusCode,
          error_code: errorCode,
          request_id: requestId,
          duration_ms: Math.round(performance.now() - startTime),
          error: errorMessage,
          hint: errorDetails.hint,
          has_diagnostics: !!upstreamDiagnostics,
        });
        
        endTiming();
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: errorMessage,
          request_id: requestId,
          status_code: statusCode,
          error_code: errorCode,
          endpoint: 'fetch-org-state',
          target_url_redacted: upstreamDiagnostics?.target_url_redacted,
          response_body_snippet: typeof data.details === 'object' 
            ? JSON.stringify(data.details).slice(0, 500) 
            : undefined,
        });
        return { ok: false, error: errorMessage, errorDetails };
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
      
      // Log success event for debug terminal
      log('network', 'info', 'PULL_ORG_STATE_SUCCESS', {
        duration_ms: duration,
        sync_version: data.sync_version,
        sites_count: data.sites?.length || 0,
        sensors_count: data.sensors?.length || 0,
        gateways_count: data.gateways?.length || 0,
        request_id: data.request_id,
        frostguard_host: data.diagnostics?.frostguard_host,
      });
      
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
        request_id: data.request_id,
        endpoint: 'fetch-org-state',
      });
      
      return { ok: true, data };
      
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log('network', 'error', 'Unexpected error during fetch', { error: lastError, attempt: attempt + 1 });
      
      // Check for CORS-like errors in caught exceptions
      if (lastError.includes('CORS') || lastError.includes('Failed to fetch') || lastError.includes('NetworkError')) {
        debug.error('Network/CORS error caught', { error: lastError });
        endTiming();
        const errorDetails: FrostGuardErrorDetails = {
          error_code: 'NETWORK_ERROR',
          message: 'Network request failed (possible CORS or connectivity issue)',
          hint: getErrorHint(undefined, 'NETWORK_ERROR', lastError),
          diagnostics: buildDiagnostics(),
        };
        logOrgSyncEvent({
          timestamp: new Date().toISOString(),
          status: 'error',
          duration_ms: Math.round(performance.now() - startTime),
          error: lastError,
          error_code: 'NETWORK_ERROR',
          endpoint: 'fetch-org-state',
        });
        return { ok: false, error: lastError, errorDetails };
      }
      
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
    endpoint: 'fetch-org-state',
  });
  return { 
    ok: false, 
    error: `Failed after ${MAX_RETRIES} attempts: ${lastError}`,
    errorDetails: {
      message: `Failed after ${MAX_RETRIES} attempts: ${lastError}`,
      hint: getErrorHint(undefined, undefined, lastError),
      diagnostics: buildDiagnostics(),
    },
  };
}

/**
 * Generates a cURL command for reproducing the fetch-org-state request.
 * Useful for debugging and support.
 */
export function generateCurlCommand(orgId: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '${SUPABASE_URL}';
  const endpoint = `${supabaseUrl}/functions/v1/fetch-org-state`;
  
  return `curl -i -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer \${SUPABASE_ANON_KEY}' \\
  -d '{"org_id": "${orgId}"}'`;
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
