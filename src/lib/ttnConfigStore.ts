// Centralized TTN Config Store
// Separates canonical (authoritative from FrostGuard) vs draft (local edits)
// All TTN network calls MUST read from canonical config, not props

import { log } from './debugLogger';

export interface TTNCanonicalConfig {
  enabled: boolean;
  cluster: string;
  applicationId: string;
  apiKeyLast4: string | null;
  webhookSecretLast4: string | null;
  updatedAt: string | null;
  source: 'FROSTGUARD_CANONICAL' | 'LOCAL_CACHE' | 'UNSET';
  orgId: string | null;
  userId: string | null;
}

// Session storage key (not localStorage to prevent cross-session staleness)
const STORAGE_KEY = 'ttn-config-canonical';

// Default empty config
const EMPTY_CONFIG: TTNCanonicalConfig = {
  enabled: false,
  cluster: 'eu1',
  applicationId: '',
  apiKeyLast4: null,
  webhookSecretLast4: null,
  updatedAt: null,
  source: 'UNSET',
  orgId: null,
  userId: null,
};

// Config version for cache busting (increments on each update)
let configVersion = 0;

// In-memory canonical config
let canonicalConfig: TTNCanonicalConfig = { ...EMPTY_CONFIG };

// Listeners for config changes
const listeners: Set<() => void> = new Set();

// Notify all listeners of config changes
function notifyListeners(): void {
  listeners.forEach(fn => fn());
}

// Load from session storage on init
function loadFromStorage(): TTNCanonicalConfig {
  if (typeof window === 'undefined') return { ...EMPTY_CONFIG };
  
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate stored data has required fields
      if (parsed.source && parsed.orgId) {
        log('ttn-sync', 'debug', 'TTN_CONFIG_STORE_LOADED', {
          source: parsed.source,
          orgId: parsed.orgId,
          apiKeyLast4: parsed.apiKeyLast4 ? `****${parsed.apiKeyLast4}` : null,
        });
        return parsed;
      }
    }
  } catch (err) {
    console.error('[ttnConfigStore] Failed to load from storage:', err);
  }
  
  return { ...EMPTY_CONFIG };
}

// Save to session storage
function saveToStorage(config: TTNCanonicalConfig): void {
  if (typeof window === 'undefined') return;
  
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('[ttnConfigStore] Failed to save to storage:', err);
  }
}

// Initialize on module load
canonicalConfig = loadFromStorage();

/**
 * Get the current canonical TTN config (read-only for network calls)
 */
export function getCanonicalConfig(): TTNCanonicalConfig {
  return { ...canonicalConfig };
}

/**
 * Set the canonical TTN config (call after successful FrostGuard pull)
 */
export function setCanonicalConfig(config: Partial<TTNCanonicalConfig> & { orgId: string }): void {
  canonicalConfig = {
    ...canonicalConfig,
    ...config,
    updatedAt: config.updatedAt || new Date().toISOString(),
  };
  
  configVersion++;
  saveToStorage(canonicalConfig);
  
  log('ttn-sync', 'info', 'TTN_CONFIG_STORE_SET', {
    source: canonicalConfig.source,
    orgId: canonicalConfig.orgId,
    apiKeyLast4: canonicalConfig.apiKeyLast4 ? `****${canonicalConfig.apiKeyLast4}` : null,
    cluster: canonicalConfig.cluster,
    applicationId: canonicalConfig.applicationId,
    configVersion,
  });
  
  notifyListeners();
}

/**
 * Clear the canonical config (call on logout or context clear)
 */
export function clearCanonicalConfig(): void {
  canonicalConfig = { ...EMPTY_CONFIG };
  configVersion++;
  
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(STORAGE_KEY);
  }
  
  log('ttn-sync', 'info', 'TTN_CONFIG_STORE_CLEAR', { configVersion });
  notifyListeners();
}

/**
 * Check if the canonical config is stale (older than maxAgeMs)
 */
export function isConfigStale(maxAgeMs: number = 5 * 60 * 1000): boolean {
  if (!canonicalConfig.updatedAt) return true;
  if (canonicalConfig.source === 'UNSET') return true;
  
  const configAge = Date.now() - new Date(canonicalConfig.updatedAt).getTime();
  return configAge > maxAgeMs;
}

/**
 * Check if we have a valid canonical config from FrostGuard
 */
export function hasCanonicalConfig(): boolean {
  return (
    canonicalConfig.source === 'FROSTGUARD_CANONICAL' &&
    !!canonicalConfig.orgId &&
    !!canonicalConfig.applicationId
  );
}

/**
 * Get the current config version (for cache busting)
 */
export function getConfigVersion(): number {
  return configVersion;
}

/**
 * Subscribe to config changes
 */
export function subscribeToConfigChanges(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Get config summary for debugging/logging
 */
export function getConfigSummary(): {
  source: string;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  cluster: string;
  applicationId: string;
  orgId: string | null;
  isStale: boolean;
  configVersion: number;
} {
  return {
    source: canonicalConfig.source,
    hasApiKey: !!canonicalConfig.apiKeyLast4,
    apiKeyLast4: canonicalConfig.apiKeyLast4,
    cluster: canonicalConfig.cluster,
    applicationId: canonicalConfig.applicationId,
    orgId: canonicalConfig.orgId,
    isStale: isConfigStale(),
    configVersion,
  };
}
