// Central Debug Logger for Emulator
// Ring buffer storage, categorized logging, automatic redaction of secrets

export type DebugCategory = 
  | 'context'      // User selection, org context
  | 'network'      // HTTP requests, edge function calls
  | 'org-sync'     // org-state-api pulls, state replacement
  | 'ttn'          // TTN config, connection tests
  | 'ttn-preflight' // TTN preflight checks
  | 'ttn-sync'     // TTN settings push/pull to FrostGuard
  | 'provisioning' // Device/gateway provisioning
  | 'error';       // Errors and exceptions

export type DebugLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugEntry {
  id: string;
  timestamp: Date;
  category: DebugCategory;
  level: DebugLevel;
  message: string;
  data?: Record<string, unknown>;
  duration?: number; // For timed operations
}

// Sensitive field patterns to redact
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /app[_-]?key/i,
  /private/i,
];

// Ring buffer configuration
const MAX_ENTRIES = 500;
const STORAGE_KEY = 'emulator-debug-logs';
const DEBUG_MODE_KEY = 'emulator-debug-mode';

// In-memory log storage
let entries: DebugEntry[] = [];
let listeners: Set<() => void> = new Set();
let isPaused = false;

// Check if debug mode is enabled
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(DEBUG_MODE_KEY) === 'true';
}

// Toggle debug mode
export function setDebugEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEBUG_MODE_KEY, enabled ? 'true' : 'false');
  if (enabled) {
    log('context', 'info', 'Debug mode enabled');
  }
  notifyListeners();
}

// Pause/resume logging
export function setPaused(paused: boolean): void {
  isPaused = paused;
}

export function getIsPaused(): boolean {
  return isPaused;
}

// Redact sensitive values in an object
function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[max depth]';
  
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Check if this looks like a key/secret (long hex or base64)
    if (obj.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(obj)) {
      return `...${obj.slice(-4)}`;
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Check if key matches sensitive patterns
      const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
      if (isSensitive && typeof value === 'string' && value.length > 0) {
        result[key] = value.length > 4 ? `...${value.slice(-4)}` : '[redacted]';
      } else {
        result[key] = redactSensitive(value, depth + 1);
      }
    }
    return result;
  }
  
  return obj;
}

// Notify all listeners of log changes
function notifyListeners(): void {
  listeners.forEach(fn => fn());
}

// Main log function
export function log(
  category: DebugCategory,
  level: DebugLevel,
  message: string,
  data?: Record<string, unknown>
): void {
  // Skip if debug mode is disabled (unless it's an error)
  if (!isDebugEnabled() && level !== 'error') return;
  if (isPaused) return;

  const entry: DebugEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(),
    category,
    level,
    message,
    data: data ? redactSensitive(data) as Record<string, unknown> : undefined,
  };

  // Add to ring buffer
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }

  // Also log to console in development
  const consoleMethod = level === 'error' ? console.error : 
                        level === 'warn' ? console.warn : 
                        level === 'debug' ? console.debug : console.log;
  consoleMethod(`[${category.toUpperCase()}] ${message}`, data ? redactSensitive(data) : '');

  notifyListeners();
}

// Timed operation helper
export function logTimed(
  category: DebugCategory,
  message: string,
  data?: Record<string, unknown>
): () => void {
  const startTime = performance.now();
  log(category, 'info', `${message} started`, data);
  
  return () => {
    const duration = Math.round(performance.now() - startTime);
    log(category, 'info', `${message} completed`, { ...data, duration_ms: duration });
  };
}

// Convenience methods
export const debug = {
  context: (message: string, data?: Record<string, unknown>) => log('context', 'info', message, data),
  network: (message: string, data?: Record<string, unknown>) => log('network', 'info', message, data),
  sync: (message: string, data?: Record<string, unknown>) => log('org-sync', 'info', message, data),
  ttn: (message: string, data?: Record<string, unknown>) => log('ttn', 'info', message, data),
  ttnPreflight: (message: string, data?: Record<string, unknown>) => log('ttn-preflight', 'info', message, data),
  ttnSync: (message: string, data?: Record<string, unknown>) => log('ttn-sync', 'info', message, data),
  provisioning: (message: string, data?: Record<string, unknown>) => log('provisioning', 'info', message, data),
  error: (message: string, data?: Record<string, unknown>) => log('error', 'error', message, data),
  warn: (category: DebugCategory, message: string, data?: Record<string, unknown>) => log(category, 'warn', message, data),
};

// State replacement logging (critical for debugging missing entities)
export function logStateReplacement(
  entityType: 'sensors' | 'gateways' | 'sites',
  previous: Array<{ id: string; name?: string }>,
  incoming: Array<{ id: string; name?: string }>
): void {
  const previousIds = new Set(previous.map(e => e.id));
  const incomingIds = new Set(incoming.map(e => e.id));
  
  const added = incoming.filter(e => !previousIds.has(e.id));
  const removed = previous.filter(e => !incomingIds.has(e.id));
  const unchanged = incoming.filter(e => previousIds.has(e.id));

  log('org-sync', 'info', `State replacement: ${entityType}`, {
    previous_count: previous.length,
    incoming_count: incoming.length,
    added_count: added.length,
    removed_count: removed.length,
    unchanged_count: unchanged.length,
  });

  if (added.length > 0) {
    log('org-sync', 'info', `+ Added ${entityType}`, {
      entities: added.map(e => ({ id: e.id, name: e.name })),
    });
  }

  if (removed.length > 0) {
    log('org-sync', 'warn', `- Removed ${entityType} (missing from FrostGuard payload)`, {
      entities: removed.map(e => ({ id: e.id, name: e.name })),
      reason: 'Entity not present in org-state-api response',
    });
  }
}

// Get all entries
export function getEntries(): DebugEntry[] {
  return [...entries];
}

// Get entries by category
export function getEntriesByCategory(category: DebugCategory): DebugEntry[] {
  return entries.filter(e => e.category === category);
}

// Get entries by level
export function getEntriesByLevel(level: DebugLevel): DebugEntry[] {
  return entries.filter(e => e.level === level);
}

// Search entries
export function searchEntries(query: string): DebugEntry[] {
  const lowerQuery = query.toLowerCase();
  return entries.filter(e => 
    e.message.toLowerCase().includes(lowerQuery) ||
    JSON.stringify(e.data || {}).toLowerCase().includes(lowerQuery)
  );
}

// Clear all entries
export function clearEntries(): void {
  entries = [];
  notifyListeners();
}

// Export entries as JSON (redacted)
export function exportEntries(): string {
  return JSON.stringify(entries, null, 2);
}

// Subscribe to log changes
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Get current context summary (for terminal header)
export interface DebugContext {
  userEmail?: string;
  userId?: string;
  orgId?: string;
  orgName?: string;
  siteId?: string;
  syncVersion?: number;
  lastSyncAt?: string;
  currentRoute?: string;
}

let currentContext: DebugContext = {};

export function setDebugContext(ctx: Partial<DebugContext>): void {
  currentContext = { ...currentContext, ...ctx };
  notifyListeners();
}

export function getDebugContext(): DebugContext {
  return { ...currentContext };
}

export function clearDebugContext(): void {
  currentContext = {};
  notifyListeners();
}

// Initialize error handlers
export function initErrorHandlers(): void {
  if (typeof window === 'undefined') return;

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    log('error', 'error', 'Unhandled promise rejection', {
      reason: String(event.reason),
      stack: event.reason?.stack,
    });
  });

  // Global errors
  window.addEventListener('error', (event) => {
    log('error', 'error', 'Uncaught error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  log('context', 'debug', 'Error handlers initialized');
}
