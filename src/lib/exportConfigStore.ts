/**
 * Export Config Store
 * 
 * Persists export settings in localStorage for the FreshTrack Pro export feature.
 */

const STORAGE_KEY = 'lorawan-emulator-export-config';

export interface ExportConfig {
  autoSyncEnabled: boolean;
  autoSyncIntervalSec: number;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'partial' | 'failed' | null;
  lastSyncCounts: {
    gateways: { created: number; updated: number; skipped: number };
    devices: { created: number; updated: number; skipped: number };
    sensors: { created: number; updated: number; skipped: number };
  } | null;
  lastReadingsSentAt: string | null;
  lastReadingsStatus: 'success' | 'partial' | 'failed' | null;
  lastReadingsIngested: number;
  lastReadingsFailed: number;
}

const DEFAULT_CONFIG: ExportConfig = {
  autoSyncEnabled: false,
  autoSyncIntervalSec: 300,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncCounts: null,
  lastReadingsSentAt: null,
  lastReadingsStatus: null,
  lastReadingsIngested: 0,
  lastReadingsFailed: 0,
};

export function loadExportConfig(): ExportConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('[ExportConfig] Failed to load:', e);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveExportConfig(config: ExportConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('[ExportConfig] Failed to save:', e);
  }
}
