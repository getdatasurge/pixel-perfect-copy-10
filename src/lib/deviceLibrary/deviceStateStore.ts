/**
 * Device State Store
 * 
 * Manages per-device simulation state persistence.
 * Stores f_cnt, increment counters, and last values for drift smoothing.
 */

import type { DeviceSimulationState } from './types';

// ============================================
// Storage Configuration
// ============================================

const STORAGE_KEY_PREFIX = 'device-sim-state-';
const STORAGE_KEY_ALL_DEVICES = 'device-sim-state-index';

// ============================================
// State Management Functions
// ============================================

/**
 * Get the localStorage key for a device
 */
function getStorageKey(deviceInstanceId: string): string {
  return `${STORAGE_KEY_PREFIX}${deviceInstanceId}`;
}

/**
 * Get simulation state for a device
 * Returns stored state or creates new initial state
 */
export function getDeviceSimState(
  deviceInstanceId: string,
  libraryDeviceId: string = ''
): DeviceSimulationState {
  try {
    const key = getStorageKey(deviceInstanceId);
    const stored = localStorage.getItem(key);
    
    if (stored) {
      const parsed = JSON.parse(stored) as DeviceSimulationState;
      // Update library device ID if provided (may have changed)
      if (libraryDeviceId && parsed.libraryDeviceId !== libraryDeviceId) {
        parsed.libraryDeviceId = libraryDeviceId;
        parsed.updatedAt = new Date().toISOString();
        saveDeviceSimState(parsed);
      }
      return parsed;
    }
  } catch (e) {
    console.warn('[DeviceStateStore] Failed to load state:', e);
  }
  
  // Create new state
  return createInitialState(deviceInstanceId, libraryDeviceId);
}

/**
 * Create initial simulation state for a device
 */
function createInitialState(
  deviceInstanceId: string,
  libraryDeviceId: string
): DeviceSimulationState {
  const now = new Date().toISOString();
  return {
    deviceInstanceId,
    libraryDeviceId,
    f_cnt: 0,
    emissionSequence: 0,
    incrementCounters: {},
    lastValues: {},
    lastEmittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Save device simulation state to localStorage
 */
function saveDeviceSimState(state: DeviceSimulationState): void {
  try {
    const key = getStorageKey(state.deviceInstanceId);
    localStorage.setItem(key, JSON.stringify(state));
    
    // Update the device index
    updateDeviceIndex(state.deviceInstanceId, 'add');
  } catch (e) {
    console.warn('[DeviceStateStore] Failed to save state:', e);
  }
}

/**
 * Update device simulation state (partial update)
 */
export function updateDeviceSimState(
  update: Partial<DeviceSimulationState> & { deviceInstanceId: string }
): DeviceSimulationState {
  const current = getDeviceSimState(update.deviceInstanceId);
  const updated: DeviceSimulationState = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  
  saveDeviceSimState(updated);
  return updated;
}

/**
 * Reset device simulation state (clear all counters)
 */
export function resetDeviceSimState(
  deviceInstanceId: string,
  libraryDeviceId?: string
): DeviceSimulationState {
  const current = getDeviceSimState(deviceInstanceId);
  const newState = createInitialState(
    deviceInstanceId,
    libraryDeviceId ?? current.libraryDeviceId
  );
  
  saveDeviceSimState(newState);
  console.log('[DeviceStateStore] Reset state for device:', deviceInstanceId);
  return newState;
}

/**
 * Delete device simulation state
 */
export function deleteDeviceSimState(deviceInstanceId: string): void {
  try {
    const key = getStorageKey(deviceInstanceId);
    localStorage.removeItem(key);
    updateDeviceIndex(deviceInstanceId, 'remove');
    console.log('[DeviceStateStore] Deleted state for device:', deviceInstanceId);
  } catch (e) {
    console.warn('[DeviceStateStore] Failed to delete state:', e);
  }
}

// ============================================
// Counter Operations
// ============================================

/**
 * Increment f_cnt (TTN frame counter) for a device
 * Returns the new f_cnt value
 */
export function incrementFCnt(deviceInstanceId: string): number {
  const state = getDeviceSimState(deviceInstanceId);
  state.f_cnt++;
  state.updatedAt = new Date().toISOString();
  saveDeviceSimState(state);
  return state.f_cnt;
}

/**
 * Increment a named counter for a device
 * Returns the new counter value
 */
export function incrementCounter(
  deviceInstanceId: string,
  counterName: string
): number {
  const state = getDeviceSimState(deviceInstanceId);
  const currentValue = state.incrementCounters[counterName] ?? 0;
  state.incrementCounters[counterName] = currentValue + 1;
  state.updatedAt = new Date().toISOString();
  saveDeviceSimState(state);
  return state.incrementCounters[counterName];
}

/**
 * Get current counter value without incrementing
 */
export function getCounterValue(
  deviceInstanceId: string,
  counterName: string
): number {
  const state = getDeviceSimState(deviceInstanceId);
  return state.incrementCounters[counterName] ?? 0;
}

/**
 * Set a specific counter value
 */
export function setCounterValue(
  deviceInstanceId: string,
  counterName: string,
  value: number
): void {
  const state = getDeviceSimState(deviceInstanceId);
  state.incrementCounters[counterName] = value;
  state.updatedAt = new Date().toISOString();
  saveDeviceSimState(state);
}

// ============================================
// Last Values (for drift smoothing)
// ============================================

/**
 * Update last values for a device (used for drift smoothing)
 */
export function updateLastValues(
  deviceInstanceId: string,
  values: Record<string, unknown>
): void {
  const state = getDeviceSimState(deviceInstanceId);
  state.lastValues = { ...state.lastValues, ...values };
  state.updatedAt = new Date().toISOString();
  saveDeviceSimState(state);
}

/**
 * Get last value for a specific field
 */
export function getLastValue(
  deviceInstanceId: string,
  fieldName: string
): unknown | undefined {
  const state = getDeviceSimState(deviceInstanceId);
  return state.lastValues[fieldName];
}

// ============================================
// Bulk Operations
// ============================================

/**
 * Get all device states
 */
export function getAllDeviceStates(): DeviceSimulationState[] {
  const deviceIds = getDeviceIndex();
  return deviceIds.map(id => getDeviceSimState(id));
}

/**
 * Reset all device states
 */
export function resetAllDeviceStates(): void {
  const deviceIds = getDeviceIndex();
  for (const id of deviceIds) {
    resetDeviceSimState(id);
  }
  console.log('[DeviceStateStore] Reset all device states:', deviceIds.length);
}

/**
 * Clear all device states (delete completely)
 */
export function clearAllDeviceStates(): void {
  const deviceIds = getDeviceIndex();
  for (const id of deviceIds) {
    deleteDeviceSimState(id);
  }
  localStorage.removeItem(STORAGE_KEY_ALL_DEVICES);
  console.log('[DeviceStateStore] Cleared all device states');
}

// ============================================
// Device Index Management
// ============================================

/**
 * Get the list of all device IDs with stored state
 */
function getDeviceIndex(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ALL_DEVICES);
    if (stored) {
      return JSON.parse(stored) as string[];
    }
  } catch (e) {
    console.warn('[DeviceStateStore] Failed to load device index:', e);
  }
  return [];
}

/**
 * Update the device index (add or remove a device)
 */
function updateDeviceIndex(
  deviceInstanceId: string,
  action: 'add' | 'remove'
): void {
  try {
    const index = getDeviceIndex();
    
    if (action === 'add') {
      if (!index.includes(deviceInstanceId)) {
        index.push(deviceInstanceId);
      }
    } else {
      const idx = index.indexOf(deviceInstanceId);
      if (idx !== -1) {
        index.splice(idx, 1);
      }
    }
    
    localStorage.setItem(STORAGE_KEY_ALL_DEVICES, JSON.stringify(index));
  } catch (e) {
    console.warn('[DeviceStateStore] Failed to update device index:', e);
  }
}

// ============================================
// State Summary (for debugging)
// ============================================

/**
 * Get a summary of all device states for debugging
 */
export function getStateSummary(): {
  totalDevices: number;
  devices: Array<{
    id: string;
    libraryDeviceId: string;
    f_cnt: number;
    emissionSequence: number;
    counterCount: number;
    lastEmittedAt: string | null;
  }>;
} {
  const states = getAllDeviceStates();
  return {
    totalDevices: states.length,
    devices: states.map(s => ({
      id: s.deviceInstanceId,
      libraryDeviceId: s.libraryDeviceId,
      f_cnt: s.f_cnt,
      emissionSequence: s.emissionSequence,
      counterCount: Object.keys(s.incrementCounters).length,
      lastEmittedAt: s.lastEmittedAt,
    })),
  };
}
