/**
 * Device Library - Public API
 * 
 * Re-exports all public functions and types for the device library system.
 */

// Types
export type {
  FieldType,
  FieldConfig,
  NumericFieldConfig,
  BoolFieldConfig,
  EnumFieldConfig,
  StringFieldConfig,
  SimulationProfile,
  DeviceExamples,
  DeviceDefinition,
  DeviceCategory,
  DeviceLibraryMetadata,
  DeviceLibrary,
  LibraryIndexes,
  DeviceFilterOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  DeviceModelAssignment,
} from './types';

// Schema & Validation
export { 
  validateDeviceLibrary, 
  parseDeviceLibrary 
} from './schema';

// Loader
export {
  loadDeviceLibrary,
  clearDeviceLibrary,
  isLibraryLoaded,
  getActiveLibrary,
  getDeviceIds,
  getDevice,
  listDevices,
  getDevicesByManufacturer,
  getDevicesByCategory,
  getCategories,
  getManufacturers,
  getLibraryMetadata,
  findMatchingDevices,
  getRecommendedDevice,
} from './loader';

// Store
export {
  persistActiveLibrary,
  loadPersistedLibrary,
  saveCustomLibrary,
  resetToDefaultLibrary,
  getModelAssignments,
  getDeviceModel,
  setDeviceModel,
  clearDeviceModel,
  clearAllModelAssignments,
  initializeDeviceLibrary,
} from './store';

// Default Library
export { defaultDeviceLibrary } from './defaultLibrary';
