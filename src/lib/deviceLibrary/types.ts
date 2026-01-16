/**
 * Device Library Type Definitions
 * 
 * Core interfaces for the device library system that enables
 * deterministic TTN v3 payload generation for many device types.
 */

// ============================================
// Field Configuration Types
// ============================================

export type FieldType = 'float' | 'int' | 'bool' | 'enum' | 'string';

export interface BaseFieldConfig {
  type: FieldType;
  unit?: string;
  description?: string;
}

export interface NumericFieldConfig extends BaseFieldConfig {
  type: 'float' | 'int';
  min: number;
  max: number;
  precision?: number; // decimal places for float
  increment?: boolean; // persists counter per device
  static?: boolean; // fixed value
  default?: number;
}

export interface BoolFieldConfig extends BaseFieldConfig {
  type: 'bool';
  static?: boolean;
  default?: boolean;
}

export interface EnumFieldConfig extends BaseFieldConfig {
  type: 'enum';
  values: string[];
  static?: boolean;
  default?: string;
}

export interface StringFieldConfig extends BaseFieldConfig {
  type: 'string';
  static?: boolean;
  default?: string;
  pattern?: string; // regex pattern
}

export type FieldConfig = NumericFieldConfig | BoolFieldConfig | EnumFieldConfig | StringFieldConfig;

// ============================================
// Simulation Profile
// ============================================

export interface SimulationProfile {
  fields: Record<string, FieldConfig>;
}

// ============================================
// Device Examples
// ============================================

export interface DeviceExamples {
  normal: Record<string, unknown>;
  alarm?: Record<string, unknown>;
}

// ============================================
// Device Definition
// ============================================

export interface DeviceDefinition {
  id: string;
  name: string;
  manufacturer: string;
  category: DeviceCategory;
  default_fport: number;
  payload_format: 'json' | 'cayenne' | 'custom';
  simulation_profile: SimulationProfile;
  examples: DeviceExamples;
  description?: string;
  firmware_version?: string;
  model?: string;
}

export type DeviceCategory = 
  | 'temperature'
  | 'door'
  | 'co2'
  | 'leak'
  | 'gps'
  | 'meter'
  | 'motion'
  | 'air_quality'
  | 'combo';

// ============================================
// Device Library Metadata
// ============================================

export interface DeviceLibraryMetadata {
  version: string;
  last_updated: string;
  categories: DeviceCategory[];
  manufacturers: string[];
}

// ============================================
// Complete Device Library
// ============================================

export interface DeviceLibrary {
  metadata: DeviceLibraryMetadata;
  devices: DeviceDefinition[];
}

// ============================================
// Library Indexes (for fast lookup)
// ============================================

export interface LibraryIndexes {
  byId: Map<string, DeviceDefinition>;
  byCategory: Map<DeviceCategory, DeviceDefinition[]>;
  byManufacturer: Map<string, DeviceDefinition[]>;
}

// ============================================
// Filter Options
// ============================================

export interface DeviceFilterOptions {
  category?: DeviceCategory;
  manufacturer?: string;
  search?: string;
}

// ============================================
// Validation Result
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

// ============================================
// Device Instance Mapping
// ============================================

/**
 * Maps an emulator device instance to a library device definition.
 */
export interface DeviceModelAssignment {
  emulatorDeviceId: string;
  libraryDeviceId: string;
  assignedAt: string;
}

// ============================================
// Simulation Context & State
// ============================================

/**
 * Context for deterministic payload generation.
 * Same context = same output sequence.
 */
export interface SimulationContext {
  orgId: string;
  siteId: string;
  unitId: string;
  deviceInstanceId: string;  // devEui or emulator device id
  emissionSequence: number;  // 0, 1, 2, ... per device
}

/**
 * Per-device simulation state that persists across emissions.
 */
export interface DeviceSimulationState {
  deviceInstanceId: string;
  libraryDeviceId: string;
  f_cnt: number;                              // TTN frame counter
  emissionSequence: number;                   // For deterministic generation
  incrementCounters: Record<string, number>;  // door_open_count, pulse_count, etc.
  lastValues: Record<string, unknown>;        // For drift smoothing
  lastEmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mode for payload generation.
 */
export type GenerationMode = 'normal' | 'alarm';

/**
 * Options for field generation.
 */
export interface GenerationOptions {
  enableDrift?: boolean;      // Gradual changes for temp/humidity
  driftMaxStep?: number;      // Max change per emission (default: 2.0)
  alarmOverrides?: Record<string, unknown>;  // From examples.alarm
}

/**
 * Result of payload generation.
 */
export interface GenerationResult {
  fields: Record<string, unknown>;
  updatedState: DeviceSimulationState;
  metadata: {
    f_cnt: number;
    emissionSequence: number;
    mode: GenerationMode;
    generatedAt: string;
  };
}
