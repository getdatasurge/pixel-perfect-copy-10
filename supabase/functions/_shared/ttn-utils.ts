/**
 * Shared TTN utilities for edge functions
 */

/**
 * Normalize DevEUI: strip colons/spaces/dashes, lowercase, validate 16 hex chars.
 * @returns Normalized DevEUI string or null if invalid
 */
export function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Generate canonical TTN device_id from DevEUI.
 * Format: sensor-{normalized_deveui}
 * @returns Device ID string or null if DevEUI is invalid
 */
export function generateTTNDeviceId(devEui: string): string | null {
  const normalized = normalizeDevEui(devEui);
  if (!normalized) return null;
  return `sensor-${normalized}`;
}

/**
 * Validate TTN device ID format.
 * Expected format: sensor-XXXXXXXXXXXXXXXX (16 hex characters)
 */
export function isValidTTNDeviceId(deviceId: string): boolean {
  return /^sensor-[a-f0-9]{16}$/i.test(deviceId);
}

/**
 * Valid TTN cluster identifiers
 */
export const VALID_CLUSTERS = ['nam1', 'eu1', 'au1'] as const;
export type TTNCluster = typeof VALID_CLUSTERS[number];

/**
 * Validate TTN cluster
 */
export function isValidCluster(cluster: string): cluster is TTNCluster {
  return VALID_CLUSTERS.includes(cluster as TTNCluster);
}

/**
 * Build TTN API base URL for a cluster
 */
export function getTTNApiBaseUrl(cluster: TTNCluster): string {
  return `https://${cluster}.cloud.thethings.network/api/v3`;
}

/**
 * Parse cluster from TTN Console URL
 */
export function parseClusterFromUrl(url: string): TTNCluster | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;

    // Extract cluster from hostname like "nam1.cloud.thethings.network"
    const match = host.match(/^(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (match) {
      return match[1] as TTNCluster;
    }

    // Also try to match console URLs
    const consoleMatch = host.match(/^console\.(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (consoleMatch) {
      return consoleMatch[1] as TTNCluster;
    }
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Convert legacy eui-xxx format to canonical sensor-xxx format
 */
export function convertLegacyDeviceId(deviceId: string): string | null {
  if (deviceId.startsWith('eui-')) {
    const devEui = deviceId.substring(4);
    return generateTTNDeviceId(devEui);
  }
  return deviceId;
}
