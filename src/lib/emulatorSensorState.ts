/**
 * Emulator Sensor State Store
 * 
 * Centralized state management for per-sensor emulator configuration.
 * All UI reads/writes go through this state model.
 */

import { LoRaWANDevice } from './ttn-payload';

// Per-sensor state
export interface SensorState {
  sensorId: string;
  type: 'temperature' | 'door';
  // Temperature settings
  tempF: number;
  minTempF: number;
  maxTempF: number;
  humidity: number;
  // Door settings
  doorOpen: boolean;
  // Common settings
  batteryPct: number;
  signalStrength: number;
  intervalSec: number;
  // Tracking
  lastSentAt: Date | null;
  isOnline: boolean;
  // Device Library integration
  libraryDeviceId?: string;  // Which library device model
  f_cnt?: number;            // TTN frame counter (synced from deviceStateStore)
}

// Full emulator state
export interface EmulatorSensorStore {
  sensors: Record<string, SensorState>;
  selectedSensorIds: string[];
}

// Default values for new sensors
const DEFAULT_TEMP_STATE: Omit<SensorState, 'sensorId' | 'type'> = {
  tempF: 38,
  minTempF: 35,
  maxTempF: 40,
  humidity: 45,
  doorOpen: false,
  batteryPct: 95,
  signalStrength: -65,
  intervalSec: 60,
  lastSentAt: null,
  isOnline: true,
};

const DEFAULT_DOOR_STATE: Omit<SensorState, 'sensorId' | 'type'> = {
  tempF: 0,
  minTempF: 0,
  maxTempF: 0,
  humidity: 0,
  doorOpen: false,
  batteryPct: 90,
  signalStrength: -70,
  intervalSec: 300,
  lastSentAt: null,
  isOnline: true,
};

// Storage keys
const STORAGE_KEY_SENSOR_STATE = 'lorawan-emulator-sensor-state';
const STORAGE_KEY_SELECTED_SENSORS = 'lorawan-emulator-selected-sensors';

/**
 * Initialize sensor state from devices
 */
export function initializeSensorState(devices: LoRaWANDevice[]): Record<string, SensorState> {
  const stored = loadStoredSensorState();
  const sensors: Record<string, SensorState> = {};
  
  for (const device of devices) {
    const existing = stored[device.id];
    if (existing) {
      // Preserve stored state, update type if changed
      sensors[device.id] = {
        ...existing,
        type: device.type,
        sensorId: device.id,
      };
    } else {
      // Create new state from defaults
      const defaults = device.type === 'door' ? DEFAULT_DOOR_STATE : DEFAULT_TEMP_STATE;
      sensors[device.id] = {
        ...defaults,
        sensorId: device.id,
        type: device.type,
      };
    }
  }
  
  return sensors;
}

/**
 * Load stored sensor state from localStorage
 */
function loadStoredSensorState(): Record<string, SensorState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SENSOR_STATE);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Restore Date objects
      for (const key of Object.keys(parsed)) {
        if (parsed[key].lastSentAt) {
          parsed[key].lastSentAt = new Date(parsed[key].lastSentAt);
        }
      }
      return parsed;
    }
  } catch (e) {
    console.warn('[SensorState] Failed to load stored state:', e);
  }
  return {};
}

/**
 * Save sensor state to localStorage
 */
export function saveSensorState(sensors: Record<string, SensorState>): void {
  try {
    localStorage.setItem(STORAGE_KEY_SENSOR_STATE, JSON.stringify(sensors));
  } catch (e) {
    console.warn('[SensorState] Failed to save state:', e);
  }
}

/**
 * Load selected sensor IDs from URL or localStorage
 */
export function loadSelectedSensorIds(devices: LoRaWANDevice[]): string[] {
  // 1. Check URL first
  const urlParams = new URLSearchParams(window.location.search);
  const urlSensors = urlParams.get('sensors');
  if (urlSensors) {
    const ids = urlSensors.split(',').filter(id => devices.some(d => d.id === id));
    if (ids.length > 0) {
      console.log('[SensorState] Loaded selection from URL:', ids);
      return ids;
    }
  }
  
  // 2. Check localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SELECTED_SENSORS);
    if (stored) {
      const ids = JSON.parse(stored).filter((id: string) => devices.some(d => d.id === id));
      if (ids.length > 0) {
        console.log('[SensorState] Loaded selection from localStorage:', ids);
        return ids;
      }
    }
  } catch (e) {
    console.warn('[SensorState] Failed to load selected sensors:', e);
  }
  
  // 3. Default: select first sensor
  if (devices.length > 0) {
    console.log('[SensorState] Defaulting to first sensor:', [devices[0].id]);
    return [devices[0].id];
  }
  
  return [];
}

/**
 * Save selected sensor IDs to localStorage and URL
 */
export function saveSelectedSensorIds(ids: string[]): void {
  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED_SENSORS, JSON.stringify(ids));
  } catch (e) {
    console.warn('[SensorState] Failed to save selected sensors:', e);
  }
  
  // Update URL without reload
  const url = new URL(window.location.href);
  if (ids.length > 0) {
    url.searchParams.set('sensors', ids.join(','));
  } else {
    url.searchParams.delete('sensors');
  }
  window.history.replaceState({}, '', url.toString());
}

/**
 * Get sensor state for display in UI
 */
export function getSensorSummary(sensor: SensorState): string {
  if (sensor.type === 'door') {
    return `${sensor.doorOpen ? 'Open' : 'Closed'} | ${sensor.batteryPct}%`;
  }
  return `${sensor.tempF.toFixed(1)}°F | ${sensor.humidity}% RH | ${sensor.batteryPct}%`;
}

/**
 * Check if sensor type supports temperature controls
 */
export function supportsTempControls(type: 'temperature' | 'door'): boolean {
  return type === 'temperature';
}

/**
 * Check if sensor type supports door controls
 */
export function supportsDoorControls(type: 'temperature' | 'door'): boolean {
  return type === 'door';
}

/**
 * Get sensors that support temperature controls
 */
export function getTempCompatibleSensors(
  selectedIds: string[], 
  sensors: Record<string, SensorState>
): string[] {
  return selectedIds.filter(id => {
    const sensor = sensors[id];
    return sensor && sensor.type === 'temperature';
  });
}

/**
 * Get sensors that support door controls
 */
export function getDoorCompatibleSensors(
  selectedIds: string[], 
  sensors: Record<string, SensorState>
): string[] {
  return selectedIds.filter(id => {
    const sensor = sensors[id];
    return sensor && sensor.type === 'door';
  });
}

/**
 * Generate random temperature within sensor's configured range
 */
export function generateRandomTemp(sensor: SensorState): number {
  return sensor.minTempF + Math.random() * (sensor.maxTempF - sensor.minTempF);
}

/**
 * Debug log for state changes
 */
export function logStateChange(
  action: string,
  sensorIds: string[],
  before: Record<string, Partial<SensorState>>,
  after: Record<string, Partial<SensorState>>
): void {
  console.log(`[SENSOR_STATE] ${action}`, {
    affected_sensor_ids: sensorIds,
    before,
    after,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Check if a sensor has a library device assigned
 */
export function hasLibraryDevice(state: SensorState): boolean {
  return !!state.libraryDeviceId;
}

/**
 * Get sensors with library device assignments
 */
export function getLibraryDeviceSensors(
  sensors: Record<string, SensorState>
): SensorState[] {
  return Object.values(sensors).filter(s => !!s.libraryDeviceId);
}

/**
 * Get sensors without library device assignments (legacy)
 */
export function getLegacySensors(
  sensors: Record<string, SensorState>
): SensorState[] {
  return Object.values(sensors).filter(s => !s.libraryDeviceId);
}
