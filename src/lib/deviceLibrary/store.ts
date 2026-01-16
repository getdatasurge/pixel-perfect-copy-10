/**
 * Device Library Persistence Store
 * 
 * Handles localStorage persistence for:
 * - Active device library
 * - Device model assignments (emulator device → library device)
 */

import type { DeviceLibrary, DeviceModelAssignment } from './types';
import { loadDeviceLibrary, getActiveLibrary } from './loader';
import { defaultDeviceLibrary } from './defaultLibrary';

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEYS = {
  LIBRARY: 'device-library-v1',
  MODEL_ASSIGNMENTS: 'device-model-assignments-v1',
  CUSTOM_LIBRARY: 'device-library-custom-v1',
} as const;

// ============================================
// Library Persistence
// ============================================

/**
 * Save the active library to localStorage.
 */
export function persistActiveLibrary(): void {
  const library = getActiveLibrary();
  if (!library) {
    console.warn('[DeviceLibraryStore] No active library to persist');
    return;
  }
  
  try {
    localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
    console.log(`[DeviceLibraryStore] Persisted library v${library.metadata.version}`);
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to persist library:', e);
  }
}

/**
 * Load library from localStorage, falling back to default.
 */
export function loadPersistedLibrary(): boolean {
  try {
    // Try to load persisted library first
    const stored = localStorage.getItem(STORAGE_KEYS.LIBRARY);
    if (stored) {
      const json = JSON.parse(stored);
      const result = loadDeviceLibrary(json);
      if (result.valid) {
        console.log('[DeviceLibraryStore] Loaded persisted library');
        return true;
      }
      console.warn('[DeviceLibraryStore] Persisted library invalid, using default');
    }
    
    // Fall back to default library
    const result = loadDeviceLibrary(defaultDeviceLibrary);
    if (result.valid) {
      console.log('[DeviceLibraryStore] Loaded default library');
      return true;
    }
    
    console.error('[DeviceLibraryStore] Default library invalid:', result.errors);
    return false;
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to load library:', e);
    
    // Try default library as last resort
    const result = loadDeviceLibrary(defaultDeviceLibrary);
    return result.valid;
  }
}

/**
 * Save a custom library (user-uploaded).
 */
export function saveCustomLibrary(library: DeviceLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_LIBRARY, JSON.stringify(library));
    localStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
    console.log('[DeviceLibraryStore] Saved custom library');
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to save custom library:', e);
  }
}

/**
 * Reset to default library.
 */
export function resetToDefaultLibrary(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_LIBRARY);
    const result = loadDeviceLibrary(defaultDeviceLibrary);
    if (result.valid) {
      persistActiveLibrary();
      console.log('[DeviceLibraryStore] Reset to default library');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to reset library:', e);
    return false;
  }
}

// ============================================
// Model Assignment Persistence
// ============================================

/**
 * Get all device model assignments.
 */
export function getModelAssignments(): DeviceModelAssignment[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.MODEL_ASSIGNMENTS);
    if (!stored) return [];
    return JSON.parse(stored) as DeviceModelAssignment[];
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to load model assignments:', e);
    return [];
  }
}

/**
 * Get the library device ID assigned to an emulator device.
 */
export function getDeviceModel(emulatorDeviceId: string): string | null {
  const assignments = getModelAssignments();
  const assignment = assignments.find(a => a.emulatorDeviceId === emulatorDeviceId);
  return assignment?.libraryDeviceId || null;
}

/**
 * Assign a library device model to an emulator device.
 */
export function setDeviceModel(emulatorDeviceId: string, libraryDeviceId: string): void {
  try {
    const assignments = getModelAssignments();
    
    // Remove existing assignment for this emulator device
    const filtered = assignments.filter(a => a.emulatorDeviceId !== emulatorDeviceId);
    
    // Add new assignment
    filtered.push({
      emulatorDeviceId,
      libraryDeviceId,
      assignedAt: new Date().toISOString(),
    });
    
    localStorage.setItem(STORAGE_KEYS.MODEL_ASSIGNMENTS, JSON.stringify(filtered));
    console.log(`[DeviceLibraryStore] Assigned model ${libraryDeviceId} to device ${emulatorDeviceId}`);
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to set device model:', e);
  }
}

/**
 * Remove model assignment for an emulator device.
 */
export function clearDeviceModel(emulatorDeviceId: string): void {
  try {
    const assignments = getModelAssignments();
    const filtered = assignments.filter(a => a.emulatorDeviceId !== emulatorDeviceId);
    localStorage.setItem(STORAGE_KEYS.MODEL_ASSIGNMENTS, JSON.stringify(filtered));
    console.log(`[DeviceLibraryStore] Cleared model for device ${emulatorDeviceId}`);
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to clear device model:', e);
  }
}

/**
 * Clear all model assignments.
 */
export function clearAllModelAssignments(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.MODEL_ASSIGNMENTS);
    console.log('[DeviceLibraryStore] Cleared all model assignments');
  } catch (e) {
    console.error('[DeviceLibraryStore] Failed to clear assignments:', e);
  }
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the device library store.
 * Call this on app startup.
 */
export function initializeDeviceLibrary(): boolean {
  console.log('[DeviceLibraryStore] Initializing...');
  return loadPersistedLibrary();
}
