/**
 * Device Template Mapping Layer
 * 
 * Single source of truth for mapping emulator device types to FrostGuard sensor schema.
 * Used by both frontend (DeviceManager) and backend (sync-to-frostguard).
 */

export interface DeviceTemplate {
  sensor_kind: 'temp' | 'door' | 'combo';
  manufacturer: string;
  model: string;
  firmware_version: string;
  description: string;
}

/**
 * Default device templates for common sensor types.
 * Maps emulator device type → FrostGuard sensor schema values.
 */
export const DEVICE_TEMPLATES: Record<string, DeviceTemplate> = {
  temperature: {
    sensor_kind: 'temp',
    manufacturer: 'Milesight',
    model: 'EM300-TH',
    firmware_version: 'v1.2',
    description: 'Temperature and humidity sensor',
  },
  door: {
    sensor_kind: 'door',
    manufacturer: 'Milesight',
    model: 'WS301',
    firmware_version: 'v1.1',
    description: 'Magnetic contact door sensor',
  },
  combo: {
    sensor_kind: 'combo',
    manufacturer: 'Milesight',
    model: 'EM300-MCS',
    firmware_version: 'v1.0',
    description: 'Combined temperature and door sensor',
  },
};

/**
 * Get device template by type, with fallback to temperature.
 */
export function getDeviceTemplate(deviceType: string): DeviceTemplate {
  return DEVICE_TEMPLATES[deviceType] || DEVICE_TEMPLATES.temperature;
}

/**
 * Normalize a DevEUI/JoinEUI to uppercase 16-hex format.
 * Removes colons, spaces, and dashes.
 */
export function normalizeEui(eui: string | undefined | null): string | null {
  if (!eui) return null;
  const normalized = eui.toUpperCase().replace(/[:\s-]/g, '');
  // Validate 16 hex characters
  if (!/^[0-9A-F]{16}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Normalize an AppKey to uppercase 32-hex format.
 */
export function normalizeAppKey(appKey: string | undefined | null): string | null {
  if (!appKey) return null;
  const normalized = appKey.toUpperCase().replace(/[:\s-]/g, '');
  // Validate 32 hex characters
  if (!/^[0-9A-F]{32}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Generate TTN device ID from DevEUI.
 * Format: sensor-{lowercase_deveui}
 */
export function generateTtnDeviceId(devEui: string): string {
  const normalized = normalizeEui(devEui);
  if (!normalized) {
    return `sensor-${devEui.toLowerCase().replace(/[:\s-]/g, '')}`;
  }
  return `sensor-${normalized.toLowerCase()}`;
}

export interface SensorRecord {
  id: string;
  name: string;
  dev_eui: string;
  join_eui: string | null;
  app_key: string | null;
  sensor_kind: 'temp' | 'door' | 'combo';
  manufacturer: string;
  model: string;
  firmware_version: string;
  description: string;
  org_id: string;
  site_id: string | null;
  unit_id: string;
  status: 'pending' | 'active' | 'inactive';
  ttn_device_id: string | null;
  ttn_application_id: string | null;
  ttn_region: string | null;
  updated_at: string;
}

export interface EmulatorDevice {
  id: string;
  name: string;
  devEui: string;
  joinEui: string;
  appKey: string;
  type: 'temperature' | 'door';
  gatewayId?: string;
  ttnDeviceId?: string;
  ttnApplicationId?: string;
  ttnRegion?: string;
}

export interface SyncContext {
  org_id: string;
  site_id?: string;
  unit_id?: string;
  ttn_application_id?: string;
  ttn_region?: string;
}

/**
 * Build a complete sensor record from an emulator device.
 * This is the single source of truth for device → sensor mapping.
 */
export function buildSensorRecordFromDevice(
  device: EmulatorDevice,
  context: SyncContext
): SensorRecord {
  const template = getDeviceTemplate(device.type);
  const normalizedDevEui = normalizeEui(device.devEui);
  
  if (!normalizedDevEui) {
    throw new Error(`Invalid DevEUI format: ${device.devEui}`);
  }

  return {
    id: device.id,
    name: device.name,
    dev_eui: normalizedDevEui,
    join_eui: normalizeEui(device.joinEui),
    app_key: normalizeAppKey(device.appKey),
    sensor_kind: template.sensor_kind,
    manufacturer: template.manufacturer,
    model: template.model,
    firmware_version: template.firmware_version,
    description: template.description,
    org_id: context.org_id,
    site_id: context.site_id || null,
    unit_id: context.unit_id || crypto.randomUUID(),
    status: 'pending',
    ttn_device_id: device.ttnDeviceId || generateTtnDeviceId(normalizedDevEui),
    ttn_application_id: device.ttnApplicationId || context.ttn_application_id || null,
    ttn_region: device.ttnRegion || context.ttn_region || 'nam1',
    updated_at: new Date().toISOString(),
  };
}
