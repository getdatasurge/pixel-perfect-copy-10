/**
 * Device Library Loader
 * 
 * Loads, validates, and indexes the device library for fast lookup.
 */

import type { 
  DeviceLibrary, 
  DeviceDefinition, 
  DeviceCategory,
  LibraryIndexes,
  DeviceFilterOptions,
  ValidationResult 
} from './types';
import { validateDeviceLibrary } from './schema';

// ============================================
// Singleton Library State
// ============================================

let activeLibrary: DeviceLibrary | null = null;
let libraryIndexes: LibraryIndexes | null = null;

// ============================================
// Index Building
// ============================================

function buildIndexes(library: DeviceLibrary): LibraryIndexes {
  const byId = new Map<string, DeviceDefinition>();
  const byCategory = new Map<DeviceCategory, DeviceDefinition[]>();
  const byManufacturer = new Map<string, DeviceDefinition[]>();
  
  for (const device of library.devices) {
    // Index by ID
    byId.set(device.id, device);
    
    // Index by category
    const categoryDevices = byCategory.get(device.category) || [];
    categoryDevices.push(device);
    byCategory.set(device.category, categoryDevices);
    
    // Index by manufacturer
    const manufacturerDevices = byManufacturer.get(device.manufacturer) || [];
    manufacturerDevices.push(device);
    byManufacturer.set(device.manufacturer, manufacturerDevices);
  }
  
  return { byId, byCategory, byManufacturer };
}

// ============================================
// Library Loading
// ============================================

/**
 * Load and validate a device library from a JSON object.
 * Returns validation result; library is only set if valid.
 */
export function loadDeviceLibrary(json: unknown): ValidationResult {
  const result = validateDeviceLibrary(json);
  
  if (result.valid) {
    activeLibrary = json as DeviceLibrary;
    libraryIndexes = buildIndexes(activeLibrary);
    console.log(`[DeviceLibrary] Loaded ${activeLibrary.devices.length} devices from library v${activeLibrary.metadata.version}`);
  }
  
  return result;
}

/**
 * Clear the active library.
 */
export function clearDeviceLibrary(): void {
  activeLibrary = null;
  libraryIndexes = null;
  console.log('[DeviceLibrary] Library cleared');
}

/**
 * Check if a library is loaded.
 */
export function isLibraryLoaded(): boolean {
  return activeLibrary !== null;
}

/**
 * Get the active library (raw).
 */
export function getActiveLibrary(): DeviceLibrary | null {
  return activeLibrary;
}

// ============================================
// Device Lookup Functions
// ============================================

/**
 * Get all device IDs in the library.
 */
export function getDeviceIds(): string[] {
  if (!libraryIndexes) return [];
  return Array.from(libraryIndexes.byId.keys());
}

/**
 * Get a device definition by ID.
 */
export function getDevice(deviceId: string): DeviceDefinition | null {
  if (!libraryIndexes) return null;
  return libraryIndexes.byId.get(deviceId) || null;
}

/**
 * Get devices matching filter criteria.
 */
export function listDevices(filters?: DeviceFilterOptions): DeviceDefinition[] {
  if (!activeLibrary) return [];
  
  let devices = activeLibrary.devices;
  
  if (filters?.category) {
    devices = devices.filter(d => d.category === filters.category);
  }
  
  if (filters?.manufacturer) {
    devices = devices.filter(d => d.manufacturer === filters.manufacturer);
  }
  
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    devices = devices.filter(d => 
      d.name.toLowerCase().includes(searchLower) ||
      d.manufacturer.toLowerCase().includes(searchLower) ||
      d.id.toLowerCase().includes(searchLower) ||
      d.category.toLowerCase().includes(searchLower)
    );
  }
  
  return devices;
}

/**
 * Get devices grouped by manufacturer.
 */
export function getDevicesByManufacturer(): Record<string, DeviceDefinition[]> {
  if (!libraryIndexes) return {};
  
  const result: Record<string, DeviceDefinition[]> = {};
  libraryIndexes.byManufacturer.forEach((devices, manufacturer) => {
    result[manufacturer] = [...devices];
  });
  
  return result;
}

/**
 * Get devices grouped by category.
 */
export function getDevicesByCategory(): Record<DeviceCategory, DeviceDefinition[]> {
  if (!libraryIndexes) return {} as Record<DeviceCategory, DeviceDefinition[]>;
  
  const result: Partial<Record<DeviceCategory, DeviceDefinition[]>> = {};
  libraryIndexes.byCategory.forEach((devices, category) => {
    result[category] = [...devices];
  });
  
  return result as Record<DeviceCategory, DeviceDefinition[]>;
}

/**
 * Get all categories in the library.
 */
export function getCategories(): DeviceCategory[] {
  if (!activeLibrary) return [];
  return [...activeLibrary.metadata.categories];
}

/**
 * Get all manufacturers in the library.
 */
export function getManufacturers(): string[] {
  if (!activeLibrary) return [];
  return [...activeLibrary.metadata.manufacturers];
}

/**
 * Get library metadata.
 */
export function getLibraryMetadata(): { version: string; lastUpdated: string; deviceCount: number } | null {
  if (!activeLibrary) return null;
  
  return {
    version: activeLibrary.metadata.version,
    lastUpdated: activeLibrary.metadata.last_updated,
    deviceCount: activeLibrary.devices.length,
  };
}

// ============================================
// Device Matching Helpers
// ============================================

/**
 * Find devices that match the existing emulator device type.
 * Useful for suggesting library devices based on current sensor type.
 */
export function findMatchingDevices(sensorKind: 'temp' | 'door' | 'combo'): DeviceDefinition[] {
  const categoryMap: Record<string, DeviceCategory[]> = {
    temp: ['temperature', 'temperature_humidity', 'combo', 'multi_sensor'],
    door: ['door', 'contact', 'combo'],
    combo: ['combo', 'temperature', 'temperature_humidity', 'door', 'contact', 'multi_sensor'],
  };

  const categories = categoryMap[sensorKind] || ['temperature'];

  return listDevices().filter(d => categories.includes(d.category));
}

/**
 * Get a recommended device for a given sensor type.
 */
export function getRecommendedDevice(sensorKind: 'temp' | 'door' | 'combo'): DeviceDefinition | null {
  const matches = findMatchingDevices(sensorKind);
  
  // Prefer exact category match
  const exactMatch = matches.find(d => {
    if (sensorKind === 'temp') return d.category === 'temperature';
    if (sensorKind === 'door') return d.category === 'door';
    return d.category === 'combo';
  });
  
  return exactMatch || matches[0] || null;
}

/**
 * Find a library device by name matching.
 * Searches device names, model numbers, and manufacturer names.
 * Returns the best match or null.
 */
export function findDeviceByName(name: string): DeviceDefinition | null {
  if (!libraryIndexes || !activeLibrary) return null;
  
  const normalizedName = name.toLowerCase().trim();
  // Strip trailing numbers (e.g., "LDDS75 1" → "ldds75")
  const nameWithoutSuffix = normalizedName.replace(/\s*\d+$/, '');
  
  // Try exact model match first (e.g., "LDDS75" → "dragino-ldds75")
  for (const device of activeLibrary.devices) {
    const modelLower = (device.model || '').toLowerCase();
    const nameLower = device.name.toLowerCase();
    
    // Check if device model/name appears in search term
    if (modelLower && (nameWithoutSuffix.includes(modelLower) || modelLower.includes(nameWithoutSuffix))) {
      return device;
    }
    // Also check device.name (e.g., "WS301" in "Milesight WS301")
    if (nameLower.includes(nameWithoutSuffix) || nameWithoutSuffix.includes(nameLower.split(' ').pop() || '')) {
      return device;
    }
  }
  
  // Try ID-based match (e.g., "dragino-ldds75" in name)
  for (const device of activeLibrary.devices) {
    const idParts = device.id.split('-');
    for (const part of idParts) {
      if (part.length > 3 && nameWithoutSuffix.includes(part)) {
        return device;
      }
    }
  }
  
  return null;
}
