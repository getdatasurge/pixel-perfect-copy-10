/**
 * Scenario Composer
 * 
 * Composes payloads for alarm and scenario modes by:
 * 1. Starting with device's examples.alarm (if available)
 * 2. Merging in generated base fields from simulation_profile
 * 3. Applying scenario-specific overrides
 * 4. Ensuring all constraints are still respected
 */

import type {
  DeviceDefinition,
  SimulationProfile,
  FieldConfig,
  NumericFieldConfig,
  SimulationContext,
  DeviceSimulationState,
  GenerationMode,
  GenerationResult,
} from './types';
import { generateFields } from './simulationEngine';
import type { AlarmTrigger, AlarmTriggerId } from './alarmTriggers';
import { ALARM_TRIGGERS, getAlarmsForCategory } from './alarmTriggers';

// ============================================
// Scenario Types
// ============================================

export type ScenarioType = 
  | 'normal'
  | 'alarm'
  | 'temp_excursion'
  | 'door_left_open'
  | 'leak'
  | 'low_battery'
  | 'poor_signal';

export interface ScenarioDefinition {
  id: ScenarioType;
  name: string;
  description: string;
  /** Field overrides to apply */
  overrides: Record<string, unknown>;
  /** Signal overrides (rssi, snr) */
  signalOverrides?: {
    rssi?: number;
    snr?: number;
  };
}

// ============================================
// Built-in Scenarios
// ============================================

export const SCENARIOS: Record<ScenarioType, ScenarioDefinition> = {
  normal: {
    id: 'normal',
    name: 'Normal Operation',
    description: 'Standard sensor readings',
    overrides: {},
  },

  alarm: {
    id: 'alarm',
    name: 'Device Alarm',
    description: 'Use device examples.alarm as baseline',
    overrides: {
      alarm: true,
    },
  },

  temp_excursion: {
    id: 'temp_excursion',
    name: 'Temperature Excursion',
    description: 'Temperature rising above safe limits',
    overrides: {
      temperature: 75.0,
      alarm: true,
      alarm_type: 'temp_excursion',
    },
  },

  door_left_open: {
    id: 'door_left_open',
    name: 'Door Left Open',
    description: 'Door stuck open with increasing duration',
    overrides: {
      door_open: true,
      open_duration: 3600,
      alarm: true,
      alarm_type: 'door_timeout',
    },
  },

  leak: {
    id: 'leak',
    name: 'Leak Detected',
    description: 'Water or fluid leak detected',
    overrides: {
      leak_detected: true,
      leak_status: 1,
      alarm: true,
    },
  },

  low_battery: {
    id: 'low_battery',
    name: 'Low Battery',
    description: 'Battery level near minimum',
    overrides: {
      battery: 5,
      battery_low: true,
    },
  },

  poor_signal: {
    id: 'poor_signal',
    name: 'Poor Signal',
    description: 'Weak gateway connection',
    overrides: {},
    signalOverrides: {
      rssi: -110,
      snr: -3,
    },
  },
};

// ============================================
// Scenario Composition Functions
// ============================================

/**
 * Compose a scenario payload for a device
 * 
 * Process:
 * 1. Generate base fields from simulation_profile
 * 2. If alarm mode and device has examples.alarm, use as base
 * 3. Apply scenario overrides
 * 4. Clamp values to profile constraints
 */
export function composeScenarioPayload(
  device: DeviceDefinition,
  scenarioType: ScenarioType,
  state: DeviceSimulationState,
  context: SimulationContext,
  options: {
    enableDrift?: boolean;
    driftMaxStep?: number;
  } = {}
): GenerationResult {
  const scenario = SCENARIOS[scenarioType];
  const mode: GenerationMode = scenarioType === 'normal' ? 'normal' : 'alarm';
  
  // Step 1: Start with alarm example if available and in alarm mode
  let baseOverrides: Record<string, unknown> = {};
  if (mode === 'alarm' && device.examples.alarm) {
    baseOverrides = { ...device.examples.alarm };
  }
  
  // Step 2: Merge scenario overrides
  const combinedOverrides = {
    ...baseOverrides,
    ...scenario.overrides,
  };
  
  // Step 3: Generate fields with overrides
  const result = generateFields(
    device.simulation_profile,
    state,
    context,
    mode,
    {
      enableDrift: options.enableDrift,
      driftMaxStep: options.driftMaxStep,
      alarmOverrides: combinedOverrides,
    }
  );
  
  // Step 4: Clamp all numeric values to profile constraints
  const clampedFields = clampToConstraints(
    result.fields,
    device.simulation_profile
  );
  
  return {
    ...result,
    fields: clampedFields,
  };
}

/**
 * Compose payload with a specific alarm trigger
 */
export function composeAlarmPayload(
  device: DeviceDefinition,
  alarmId: AlarmTriggerId,
  state: DeviceSimulationState,
  context: SimulationContext,
  options: {
    enableDrift?: boolean;
    driftMaxStep?: number;
  } = {}
): GenerationResult & { alarm: AlarmTrigger } {
  const alarm = ALARM_TRIGGERS[alarmId];
  
  if (!alarm) {
    throw new Error(`Unknown alarm trigger: ${alarmId}`);
  }
  
  // Check if alarm applies to device category
  if (!alarm.applicableCategories.includes(device.category)) {
    console.warn(
      `[ScenarioComposer] Alarm ${alarmId} does not apply to category ${device.category}`
    );
  }
  
  // Start with alarm example if available
  let baseOverrides: Record<string, unknown> = {};
  if (device.examples.alarm) {
    baseOverrides = { ...device.examples.alarm };
  }
  
  // Merge alarm trigger overrides
  const combinedOverrides = {
    ...baseOverrides,
    ...alarm.payloadOverrides,
  };
  
  // Generate fields
  const result = generateFields(
    device.simulation_profile,
    state,
    context,
    'alarm',
    {
      enableDrift: options.enableDrift,
      driftMaxStep: options.driftMaxStep,
      alarmOverrides: combinedOverrides,
    }
  );
  
  // Clamp to constraints
  const clampedFields = clampToConstraints(
    result.fields,
    device.simulation_profile
  );
  
  return {
    ...result,
    fields: clampedFields,
    alarm,
  };
}

/**
 * Get available alarms for a device based on its category
 */
export function getDeviceAlarms(device: DeviceDefinition): AlarmTrigger[] {
  return getAlarmsForCategory(device.category);
}

/**
 * Check if a device supports a specific scenario
 */
export function deviceSupportsScenario(
  device: DeviceDefinition,
  scenarioType: ScenarioType
): boolean {
  switch (scenarioType) {
    case 'normal':
      return true;
    case 'alarm':
      return true; // All devices can have alarms
    case 'temp_excursion':
      return ['temperature', 'combo', 'air_quality'].includes(device.category);
    case 'door_left_open':
      return ['door', 'combo'].includes(device.category);
    case 'leak':
      return device.category === 'leak';
    case 'low_battery':
      return true; // All devices have batteries
    case 'poor_signal':
      return true; // All devices have signal
    default:
      return false;
  }
}

/**
 * Get all scenarios applicable to a device
 */
export function getDeviceScenarios(device: DeviceDefinition): ScenarioDefinition[] {
  return Object.values(SCENARIOS).filter(scenario =>
    deviceSupportsScenario(device, scenario.id)
  );
}

// ============================================
// Helper Functions
// ============================================

/**
 * Clamp numeric values to their profile constraints
 */
function clampToConstraints(
  fields: Record<string, unknown>,
  profile: SimulationProfile
): Record<string, unknown> {
  const result = { ...fields };
  
  for (const [fieldName, fieldConfig] of Object.entries(profile.fields)) {
    if (result[fieldName] === undefined) continue;
    
    if (isNumericField(fieldConfig)) {
      const value = result[fieldName];
      if (typeof value === 'number') {
        const { min, max, precision = 2 } = fieldConfig as NumericFieldConfig;
        let clamped = Math.max(min, Math.min(max, value));
        const factor = Math.pow(10, precision);
        clamped = Math.round(clamped * factor) / factor;
        result[fieldName] = clamped;
      }
    }
  }
  
  return result;
}

/**
 * Check if field config is numeric
 */
function isNumericField(config: FieldConfig): boolean {
  return config.type === 'float' || config.type === 'int';
}

/**
 * Apply signal overrides to rx_metadata
 */
export function applySignalOverrides(
  rxMetadata: { rssi: number; snr: number }[],
  overrides?: { rssi?: number; snr?: number }
): { rssi: number; snr: number }[] {
  if (!overrides) return rxMetadata;
  
  return rxMetadata.map(meta => ({
    ...meta,
    rssi: overrides.rssi ?? meta.rssi,
    snr: overrides.snr ?? meta.snr,
  }));
}

/**
 * Merge device example with scenario overrides
 */
export function mergeWithExample(
  device: DeviceDefinition,
  overrides: Record<string, unknown>,
  useAlarmExample: boolean = false
): Record<string, unknown> {
  const example = useAlarmExample && device.examples.alarm
    ? device.examples.alarm
    : device.examples.normal;
  
  return {
    ...example,
    ...overrides,
  };
}
