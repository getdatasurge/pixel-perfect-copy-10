// Support Snapshot Builder for Emulator Debug Terminal
// Collects comprehensive diagnostic information with proper redaction

import { 
  DebugEntry, 
  getEntries, 
  getDebugContext, 
  DebugContext 
} from './debugLogger';

// ============ Event History Tracking ============

export interface OrgSyncEvent {
  timestamp: string;
  status: 'success' | 'error';
  duration_ms?: number;
  sync_version?: number;
  counts?: { sites: number; units?: number; sensors: number; gateways: number };
  error?: string;
  request_id?: string;
  status_code?: number;
  // Enhanced diagnostics
  error_code?: string;
  endpoint?: string;
  target_url_redacted?: string;
  response_content_type?: string;
  response_body_snippet?: string;
  auth_header_type?: 'authorization' | 'x-sync-api-key';
  auth_key_last4?: string;
}

export interface ProvisioningEvent {
  timestamp: string;
  entity_type: 'gateway' | 'device';
  attempted: number;
  created: number;
  exists: number;
  failed: number;
  errors: string[];
}

export interface TTNTestEvent {
  timestamp: string;
  success: boolean;
  cluster?: string;
  application_id?: string;
  error?: string;
}

export interface SyncToFrostguardEvent {
  timestamp: string;
  gateways_count: number;
  devices_count: number;
  status: number;
  result: string;
  error?: string;
}

// Assignment event for device unit/site changes
export interface AssignmentEvent {
  timestamp: string;
  sensor_id: string;
  unit_id: string | null;
  site_id: string | null;
  status: 'success' | 'error';
  status_code?: number;
  request_id?: string;
  error_code?: string;
  error?: string;
  hint?: string;
  duration_ms: number;
}

// History storage
const MAX_HISTORY = 20;
let orgSyncHistory: OrgSyncEvent[] = [];
let provisioningHistory: ProvisioningEvent[] = [];
let ttnTestHistory: TTNTestEvent[] = [];
let syncToFrostguardHistory: SyncToFrostguardEvent[] = [];
let assignmentHistory: AssignmentEvent[] = [];

// Reconciliation tracking
let lastReconciliation = {
  gateways_added: 0,
  gateways_removed: 0,
  sensors_added: 0,
  sensors_removed: 0,
};

// ============ Event Logging Functions ============

export function logOrgSyncEvent(event: OrgSyncEvent): void {
  orgSyncHistory.push({
    ...event,
    error: event.error ? redactString(event.error) : undefined,
    response_body_snippet: event.response_body_snippet 
      ? redactString(event.response_body_snippet) 
      : undefined,
  });
  if (orgSyncHistory.length > MAX_HISTORY) {
    orgSyncHistory = orgSyncHistory.slice(-MAX_HISTORY);
  }
}

export function logProvisioningEvent(event: ProvisioningEvent): void {
  provisioningHistory.push({
    ...event,
    errors: event.errors.map(redactString),
  });
  if (provisioningHistory.length > MAX_HISTORY) {
    provisioningHistory = provisioningHistory.slice(-MAX_HISTORY);
  }
}

export function logTTNTestEvent(event: TTNTestEvent): void {
  ttnTestHistory.push({
    ...event,
    error: event.error ? redactString(event.error) : undefined,
  });
  if (ttnTestHistory.length > MAX_HISTORY) {
    ttnTestHistory = ttnTestHistory.slice(-MAX_HISTORY);
  }
}

export function logSyncToFrostguardEvent(event: SyncToFrostguardEvent): void {
  syncToFrostguardHistory.push({
    ...event,
    error: event.error ? redactString(event.error) : undefined,
  });
  if (syncToFrostguardHistory.length > MAX_HISTORY) {
    syncToFrostguardHistory = syncToFrostguardHistory.slice(-MAX_HISTORY);
  }
}

export function logAssignmentEvent(event: AssignmentEvent): void {
  assignmentHistory.push({
    ...event,
    error: event.error ? redactString(event.error) : undefined,
    hint: event.hint ? redactString(event.hint) : undefined,
  });
  if (assignmentHistory.length > MAX_HISTORY) {
    assignmentHistory = assignmentHistory.slice(-MAX_HISTORY);
  }
}

export function updateReconciliation(data: Partial<typeof lastReconciliation>): void {
  lastReconciliation = { ...lastReconciliation, ...data };
}

// ============ Getters for History ============

export function getOrgSyncHistory(): OrgSyncEvent[] {
  return [...orgSyncHistory];
}

export function getProvisioningHistory(): ProvisioningEvent[] {
  return [...provisioningHistory];
}

export function getTTNTestHistory(): TTNTestEvent[] {
  return [...ttnTestHistory];
}

export function getSyncToFrostguardHistory(): SyncToFrostguardEvent[] {
  return [...syncToFrostguardHistory];
}

export function getAssignmentHistory(): AssignmentEvent[] {
  return [...assignmentHistory];
}

export function getReconciliationSummary(): typeof lastReconciliation {
  return { ...lastReconciliation };
}

// ============ Redaction ============

const SENSITIVE_PATTERNS = [
  /api[_-]?key/gi,
  /secret/gi,
  /password/gi,
  /token/gi,
  /authorization/gi,
  /bearer\s+[^\s]+/gi,
  /app[_-]?key/gi,
  /private/gi,
];

// Pattern for long keys/tokens (hex, base64)
const KEY_PATTERN = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

function redactString(str: string): string {
  let result = str;
  
  // Redact long key-like strings
  result = result.replace(KEY_PATTERN, (match) => {
    if (match.length > 8) {
      return `[REDACTED...${match.slice(-4)}]`;
    }
    return '[REDACTED]';
  });
  
  // Redact bearer tokens
  result = result.replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
  
  return result;
}

function deepRedact(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Check if this looks like a key/secret (long alphanumeric)
    if (obj.length > 32 && /^[A-Za-z0-9+/=_-]+$/.test(obj)) {
      return `[REDACTED...${obj.slice(-4)}]`;
    }
    return redactString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepRedact(item, depth + 1));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
      if (isSensitive && typeof value === 'string' && value.length > 0) {
        result[key] = value.length > 4 ? `[REDACTED...${value.slice(-4)}]` : '[REDACTED]';
      } else {
        result[key] = deepRedact(value, depth + 1);
      }
    }
    return result;
  }
  
  return obj;
}

// ============ Snapshot Types ============

export interface EndpointConfig {
  edge_function: string;
  target_api: string;
  supabase_url_configured: boolean;
  supabase_project_id?: string;
  auth_method: 'authorization' | 'x-sync-api-key' | 'unknown';
}

export interface CorsDiagnostics {
  blocked: boolean;
  error_message?: string;
  last_blocked_at?: string;
}

export interface SupportSnapshot {
  meta: {
    generated_at: string;
    snapshot_version: string;
    app_name: string;
    env: string;
    triggered_by: 'manual' | 'error_context';
    error_entry_id?: string;
  };
  
  app_context: {
    user_email?: string;
    user_id?: string;
    org_id?: string;
    org_name?: string;
    site_id?: string;
    sync_version?: number;
    last_synced_at?: string;
    current_route?: string;
  };
  
  endpoint_config: EndpointConfig;
  
  cors_diagnostics?: CorsDiagnostics;
  
  org_sync_diagnostics: {
    last_n_pulls: OrgSyncEvent[];
    reconciliation_summary: typeof lastReconciliation;
  };
  
  provisioning_diagnostics: {
    last_n_runs: ProvisioningEvent[];
  };
  
  sync_to_frostguard_diagnostics: {
    last_n_requests: SyncToFrostguardEvent[];
  };
  
  assignment_diagnostics: {
    recent_attempts: AssignmentEvent[];
    last_error?: AssignmentEvent;
  };
  
  ttn_diagnostics: {
    last_n_tests: TTNTestEvent[];
    api_key_present: boolean;
    api_key_last4?: string;
    configured_cluster?: string;
    last_preflight_host?: string;
  };
  
  logs: {
    total_captured: number;
    included_count: number;
    entries: DebugEntry[];
  };
}

// ============ Snapshot Builder ============

export interface BuildSnapshotOptions {
  errorEntryId?: string;
  maxLogEntries?: number;
}

export function buildSupportSnapshot(options: BuildSnapshotOptions = {}): SupportSnapshot {
  const { errorEntryId, maxLogEntries = 500 } = options;
  const context = getDebugContext();
  const allEntries = getEntries();
  
  // Get last N entries, redacted
  const logEntries = allEntries
    .slice(-maxLogEntries)
    .map(entry => ({
      ...entry,
      data: entry.data ? deepRedact(entry.data) as Record<string, unknown> : undefined,
      message: redactString(entry.message),
    }));
  
  // Try to extract TTN info from context or logs
  const ttnInfo = extractTTNInfo(allEntries, context);
  
  // Check for CORS errors in recent logs
  const corsInfo = extractCorsInfo(allEntries);
  
  // Build endpoint config
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const endpointConfig: EndpointConfig = {
    edge_function: 'fetch-org-state',
    target_api: 'FrostGuard org-state-api',
    supabase_url_configured: !!supabaseUrl,
    supabase_project_id: supabaseUrl ? extractProjectId(supabaseUrl) : undefined,
    auth_method: 'authorization', // We use Bearer token via Supabase client
  };
  
  return {
    meta: {
      generated_at: new Date().toISOString(),
      snapshot_version: '2.0.0', // Bumped version for enhanced diagnostics
      app_name: 'FrostGuard Emulator',
      env: import.meta.env.MODE || 'unknown',
      triggered_by: errorEntryId ? 'error_context' : 'manual',
      error_entry_id: errorEntryId,
    },
    
    app_context: {
      user_email: context.userEmail,
      user_id: context.userId,
      org_id: context.orgId,
      org_name: context.orgName,
      site_id: context.siteId,
      sync_version: context.syncVersion,
      last_synced_at: context.lastSyncAt,
      current_route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    },
    
    endpoint_config: endpointConfig,
    
    cors_diagnostics: corsInfo.blocked ? corsInfo : undefined,
    
    org_sync_diagnostics: {
      last_n_pulls: getOrgSyncHistory(),
      reconciliation_summary: getReconciliationSummary(),
    },
    
    provisioning_diagnostics: {
      last_n_runs: getProvisioningHistory(),
    },
    
    sync_to_frostguard_diagnostics: {
      last_n_requests: getSyncToFrostguardHistory(),
    },
    
    assignment_diagnostics: {
      recent_attempts: getAssignmentHistory().slice(0, 5),
      last_error: getAssignmentHistory().find(a => a.status === 'error'),
    },
    
    ttn_diagnostics: {
      last_n_tests: getTTNTestHistory(),
      api_key_present: ttnInfo.apiKeyPresent,
      api_key_last4: ttnInfo.apiKeyLast4,
    },
    
    logs: {
      total_captured: allEntries.length,
      included_count: logEntries.length,
      entries: logEntries,
    },
  };
}

function extractTTNInfo(entries: DebugEntry[], context: DebugContext): {
  apiKeyPresent: boolean;
  apiKeyLast4?: string;
} {
  // Look for TTN-related logs that might contain this info
  const ttnLogs = entries
    .filter(e => e.category === 'ttn')
    .reverse();
  
  for (const log of ttnLogs) {
    if (log.data) {
      const data = log.data as Record<string, unknown>;
      if (typeof data.api_key_present === 'boolean') {
        return {
          apiKeyPresent: data.api_key_present,
          apiKeyLast4: typeof data.api_key_last4 === 'string' ? data.api_key_last4 : undefined,
        };
      }
    }
  }
  
  return { apiKeyPresent: false };
}

function extractCorsInfo(entries: DebugEntry[]): CorsDiagnostics {
  // Look for CORS-related errors in recent logs
  const corsErrors = entries
    .filter(e => 
      e.level === 'error' && 
      (e.message.includes('CORS') || 
       e.message.includes('blocked') || 
       e.message.includes('network') ||
       (e.data && JSON.stringify(e.data).includes('CORS')))
    )
    .reverse();
  
  if (corsErrors.length > 0) {
    const latestError = corsErrors[0];
    return {
      blocked: true,
      error_message: redactString(latestError.message),
      last_blocked_at: typeof latestError.timestamp === 'string' ? latestError.timestamp : new Date(latestError.timestamp).toISOString(),
    };
  }
  
  return { blocked: false };
}

function extractProjectId(supabaseUrl: string): string | undefined {
  try {
    const url = new URL(supabaseUrl);
    const parts = url.hostname.split('.');
    if (parts.length > 0 && parts[0] !== 'supabase') {
      return parts[0];
    }
  } catch {
    // Invalid URL
  }
  return undefined;
}

// ============ Download Helper ============

export function downloadSnapshot(snapshot: SupportSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `emulator-support-snapshot-${timestamp}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

// ============ Clear History (for testing) ============

export function clearAllHistory(): void {
  orgSyncHistory = [];
  provisioningHistory = [];
  ttnTestHistory = [];
  syncToFrostguardHistory = [];
  assignmentHistory = [];
  lastReconciliation = {
    gateways_added: 0,
    gateways_removed: 0,
    sensors_added: 0,
    sensors_removed: 0,
  };
}
