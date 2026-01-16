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
  // Simulation types
  SimulationContext,
  DeviceSimulationState,
  GenerationMode,
  GenerationOptions,
  GenerationResult,
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

// Simulation Engine
export {
  SeededRandom,
  generateFields,
  generateDevicePayload,
  createInitialSimulationState,
  verifyDeterminism,
} from './simulationEngine';

// Device State Store
export {
  getDeviceSimState,
  updateDeviceSimState,
  resetDeviceSimState,
  deleteDeviceSimState,
  incrementFCnt,
  incrementCounter,
  getCounterValue,
  setCounterValue,
  updateLastValues,
  getLastValue,
  getAllDeviceStates,
  resetAllDeviceStates,
  clearAllDeviceStates,
  getStateSummary,
} from './deviceStateStore';

// Alarm Triggers
export type { AlarmTrigger, AlarmTriggerId } from './alarmTriggers';
export {
  ALARM_TRIGGERS,
  getAllAlarmTriggers,
  getAlarmTrigger,
  getAlarmsForCategory,
  getAlarmsForCategories,
  alarmAppliesToCategory,
  getSeverityColor,
  getSeverityIconBg,
} from './alarmTriggers';

// Scenario Composer
export type { ScenarioType, ScenarioDefinition } from './scenarioComposer';
export {
  SCENARIOS,
  composeScenarioPayload,
  composeAlarmPayload,
  getDeviceAlarms,
  deviceSupportsScenario,
  getDeviceScenarios,
  applySignalOverrides,
  mergeWithExample,
} from './scenarioComposer';

// Default Library
export { defaultDeviceLibrary } from './defaultLibrary';
