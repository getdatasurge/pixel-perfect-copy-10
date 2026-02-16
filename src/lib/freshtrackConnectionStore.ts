/**
 * FreshTrack Connection Config Store
 *
 * Persists FreshTrack Pro connection settings in localStorage.
 * Each field falls back to a VITE_* environment variable if not set.
 */

const STORAGE_KEY = 'lorawan-emulator-freshtrack-connection';

export interface FreshTrackConnectionConfig {
  freshtrackUrl: string;
  emulatorSyncApiKey: string;
  deviceIngestApiKey: string;
  orgStateSyncApiKey: string;
  freshtrackOrgId: string;
}

const DEFAULT_CONFIG: FreshTrackConnectionConfig = {
  freshtrackUrl: '',
  emulatorSyncApiKey: '',
  deviceIngestApiKey: '',
  orgStateSyncApiKey: '',
  freshtrackOrgId: '',
};

function getEnvFallbacks(): Partial<FreshTrackConnectionConfig> {
  return {
    freshtrackUrl: import.meta.env.VITE_FRESHTRACK_SUPABASE_URL || '',
    emulatorSyncApiKey: import.meta.env.VITE_EMULATOR_SYNC_API_KEY || '',
    deviceIngestApiKey: import.meta.env.VITE_DEVICE_INGEST_API_KEY || '',
    orgStateSyncApiKey: import.meta.env.VITE_ORG_STATE_SYNC_API_KEY || '',
    freshtrackOrgId: import.meta.env.VITE_FRESHTRACK_ORG_ID || '',
  };
}

export function loadConnectionConfig(): FreshTrackConnectionConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('[FreshTrackConnection] Failed to load:', e);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConnectionConfig(config: FreshTrackConnectionConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('[FreshTrackConnection] Failed to save:', e);
  }
}

export function clearConnectionConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[FreshTrackConnection] Failed to clear:', e);
  }
}

/**
 * Returns the effective config: localStorage values override env var fallbacks.
 * A field is resolved as: stored value (if non-empty) > env var fallback > empty string.
 */
export function getEffectiveConfig(): FreshTrackConnectionConfig {
  const stored = loadConnectionConfig();
  const env = getEnvFallbacks();
  return {
    freshtrackUrl: stored.freshtrackUrl || env.freshtrackUrl || '',
    emulatorSyncApiKey: stored.emulatorSyncApiKey || env.emulatorSyncApiKey || '',
    deviceIngestApiKey: stored.deviceIngestApiKey || env.deviceIngestApiKey || '',
    orgStateSyncApiKey: stored.orgStateSyncApiKey || env.orgStateSyncApiKey || '',
    freshtrackOrgId: stored.freshtrackOrgId || env.freshtrackOrgId || '',
  };
}

/**
 * Returns true if enough config is present to make direct calls to FreshTrack
 * (URL + at least one API key).
 */
export function isDirectModeAvailable(): boolean {
  const cfg = getEffectiveConfig();
  if (!cfg.freshtrackUrl) return false;
  return !!(cfg.emulatorSyncApiKey || cfg.deviceIngestApiKey || cfg.orgStateSyncApiKey);
}
