/**
 * Debug Utility for Sync Pipeline
 * ================================
 * Enable debugging by setting localStorage.DEBUG_SYNC = '1'
 * All logs are prefixed with [SYNC_DEBUG] for easy filtering
 */

const DEBUG_KEY = 'DEBUG_SYNC';

export const debugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(DEBUG_KEY) === '1';
};

export const enableDebug = () => {
  localStorage.setItem(DEBUG_KEY, '1');
  console.log('[SYNC_DEBUG] Debug mode enabled');
};

export const disableDebug = () => {
  localStorage.removeItem(DEBUG_KEY);
  console.log('[SYNC_DEBUG] Debug mode disabled');
};

const timestamp = () => new Date().toISOString();

export const syncDebug = {
  log: (...args: unknown[]) => {
    if (debugEnabled()) {
      console.log('[SYNC_DEBUG]', timestamp(), ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (debugEnabled()) {
      console.warn('[SYNC_DEBUG]', timestamp(), ...args);
    }
  },
  error: (...args: unknown[]) => {
    // Always log errors, even if debug is off
    console.error('[SYNC_DEBUG]', timestamp(), ...args);
  },
  group: (label: string) => {
    if (debugEnabled()) {
      console.group(`[SYNC_DEBUG] ${label}`);
    }
  },
  groupEnd: () => {
    if (debugEnabled()) {
      console.groupEnd();
    }
  },
  stringify: (obj: unknown): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  },
  table: (data: unknown[]) => {
    if (debugEnabled() && Array.isArray(data)) {
      console.table(data);
    }
  },
};

/**
 * Get Supabase environment info (safe to log)
 */
export const getSupabaseEnvInfo = () => {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  
  // Extract project ref from URL (e.g., "jyxzaagcirhbdzvofkom" from "https://jyxzaagcirhbdzvofkom.supabase.co")
  const projectRefMatch = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] || 'unknown';
  
  return {
    urlConfigured: !!url,
    anonKeyConfigured: !!anonKey,
    projectRef,
    urlDomain: url ? new URL(url).hostname : 'not-set',
  };
};

/**
 * Create a debug report that can be copied
 */
export const createDebugReport = (context: {
  component: string;
  action: string;
  sessionUserId?: string | null;
  requestDetails?: {
    functionName?: string;
    status?: number | string;
    responseTimeMs?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  extra?: Record<string, unknown>;
}) => {
  const envInfo = getSupabaseEnvInfo();
  
  return {
    timestamp: timestamp(),
    appUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
    component: context.component,
    action: context.action,
    session: context.sessionUserId ? `user:${context.sessionUserId.slice(0, 8)}...` : 'no-session',
    environment: {
      supabaseProject: envInfo.projectRef,
      supabaseConfigured: envInfo.urlConfigured && envInfo.anonKeyConfigured,
    },
    request: context.requestDetails || null,
    error: context.error || null,
    extra: context.extra || null,
  };
};

/**
 * Copy debug report to clipboard
 */
export const copyDebugReport = async (report: ReturnType<typeof createDebugReport>): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch {
    console.error('[SYNC_DEBUG] Failed to copy to clipboard');
    return false;
  }
};
