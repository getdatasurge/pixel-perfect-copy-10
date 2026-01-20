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
  // Local dirty tracking - prevents canonical overwrites of fresh local saves
  localDirty: boolean;
  localSavedAt: string | null;
}

// Session storage key (not localStorage to prevent cross-session staleness)
const STORAGE_KEY = 'ttn-config-canonical';

// Default empty config
const EMPTY_CONFIG: TTNCanonicalConfig = {
  enabled: false,
  cluster: 'nam1',
  applicationId: '',
  apiKeyLast4: null,
  webhookSecretLast4: null,
  updatedAt: null,
  source: 'UNSET',
  orgId: null,
  userId: null,
  localDirty: false,
  localSavedAt: null,
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
 * Mark config as locally dirty (just saved, don't overwrite with canonical)
 */
export function markLocalDirty(apiKeyLast4: string): void {
  canonicalConfig = {
    ...canonicalConfig,
    localDirty: true,
    localSavedAt: new Date().toISOString(),
    apiKeyLast4,
  };
  configVersion++;
  saveToStorage(canonicalConfig);
  
  log('ttn-sync', 'info', 'TTN_CONFIG_MARKED_DIRTY', {
    apiKeyLast4: `****${apiKeyLast4}`,
    localSavedAt: canonicalConfig.localSavedAt,
    configVersion,
  });
  
  notifyListeners();
}

/**
 * Check if local config is dirty (recently saved locally)
 */
export function isLocalDirty(): boolean {
  return canonicalConfig.localDirty;
}

/**
 * Check if a canonical update should be accepted (not overwriting fresh local save)
 * Returns true if canonical update is allowed
 */
export function canAcceptCanonicalUpdate(canonicalUpdatedAt: string | null, canonicalApiKeyLast4: string | null): boolean {
  // If not dirty, always accept canonical
  if (!canonicalConfig.localDirty) {
    return true;
  }
  
  // If dirty but no local save timestamp, be safe and reject
  if (!canonicalConfig.localSavedAt) {
    return false;
  }
  
  // If canonical has no timestamp, reject (local is newer)
  if (!canonicalUpdatedAt) {
    return false;
  }
  
  // Compare timestamps - only accept if canonical is genuinely newer
  const localTime = new Date(canonicalConfig.localSavedAt).getTime();
  const canonicalTime = new Date(canonicalUpdatedAt).getTime();
  
  // Add 2 second buffer to account for clock skew
  const isCanonicalNewer = canonicalTime > localTime + 2000;
  
  // Also check if the key matches (sync complete)
  const keyMatches = canonicalApiKeyLast4 === canonicalConfig.apiKeyLast4;
  
  log('ttn-sync', 'debug', 'TTN_CANONICAL_UPDATE_CHECK', {
    localDirty: canonicalConfig.localDirty,
    localSavedAt: canonicalConfig.localSavedAt,
    canonicalUpdatedAt,
    isCanonicalNewer,
    keyMatches,
    localKeyLast4: canonicalConfig.apiKeyLast4 ? `****${canonicalConfig.apiKeyLast4}` : null,
    canonicalKeyLast4: canonicalApiKeyLast4 ? `****${canonicalApiKeyLast4}` : null,
  });
  
  // Only accept if canonical is newer AND keys match (confirming sync)
  return isCanonicalNewer && keyMatches;
}

/**
 * Clear the local dirty flag (after confirmed sync or manual clear)
 */
export function clearLocalDirty(): void {
  if (canonicalConfig.localDirty) {
    canonicalConfig = {
      ...canonicalConfig,
      localDirty: false,
    };
    configVersion++;
    saveToStorage(canonicalConfig);
    
    log('ttn-sync', 'info', 'TTN_CONFIG_DIRTY_CLEARED', { configVersion });
    notifyListeners();
  }
}

/**
 * Log a config snapshot for debugging
 */
export function logConfigSnapshot(context: string): void {
  log('ttn-sync', 'info', `TTN_CONFIG_SNAPSHOT_${context}`, {
    orgId: canonicalConfig.orgId,
    source: canonicalConfig.source,
    apiKeyLast4: canonicalConfig.apiKeyLast4 ? `****${canonicalConfig.apiKeyLast4}` : null,
    updatedAt: canonicalConfig.updatedAt,
    localDirty: canonicalConfig.localDirty,
    localSavedAt: canonicalConfig.localSavedAt,
    configVersion,
  });
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
  localDirty: boolean;
  localSavedAt: string | null;
  updatedAt: string | null;
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
    localDirty: canonicalConfig.localDirty,
    localSavedAt: canonicalConfig.localSavedAt,
    updatedAt: canonicalConfig.updatedAt,
  };
}
