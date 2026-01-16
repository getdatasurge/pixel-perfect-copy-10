/**
 * Deterministic Simulation Engine
 * 
 * Generates realistic decoded_payload values from simulation_profile
 * in a deterministic manner (same context = same output sequence).
 */

import type {
  DeviceDefinition,
  SimulationProfile,
  FieldConfig,
  NumericFieldConfig,
  EnumFieldConfig,
  StringFieldConfig,
  SimulationContext,
  DeviceSimulationState,
  GenerationMode,
  GenerationOptions,
  GenerationResult,
} from './types';

// ============================================
// Deterministic Hash Function (cyrb53)
// ============================================

/**
 * cyrb53 hash - fast, deterministic, good distribution
 * Returns a 53-bit hash as a number
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Create deterministic seed from context + field name
 */
function createFieldSeed(context: SimulationContext, fieldName: string): number {
  const seedString = [
    context.orgId,
    context.siteId,
    context.unitId,
    context.deviceInstanceId,
    fieldName,
    context.emissionSequence.toString(),
  ].join('|');
  
  return cyrb53(seedString);
}

// ============================================
// Seeded PRNG (Mulberry32)
// ============================================

/**
 * Mulberry32 PRNG - fast, deterministic, passes statistical tests
 */
export class SeededRandom {
  private state: number;
  
  constructor(seed: number) {
    this.state = seed >>> 0; // Ensure 32-bit unsigned
  }
  
  /**
   * Get next random number in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  
  /**
   * Get random integer in [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }
  
  /**
   * Get random float in [min, max] with given precision
   */
  nextFloat(min: number, max: number, precision: number = 2): number {
    const value = min + this.next() * (max - min);
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }
  
  /**
   * Get random boolean
   */
  nextBool(): boolean {
    return this.next() > 0.5;
  }
  
  /**
   * Pick random element from array
   */
  nextEnum<T>(values: T[]): T {
    return values[Math.floor(this.next() * values.length)];
  }
}

// ============================================
// Field Value Generation
// ============================================

/**
 * Generate a single field value based on its configuration
 */
function generateFieldValue(
  fieldName: string,
  config: FieldConfig,
  rng: SeededRandom,
  state: DeviceSimulationState,
  options: GenerationOptions
): unknown {
  // Handle static fields - always return default value
  if (config.static && config.default !== undefined) {
    return config.default;
  }
  
  // Handle increment fields - persist counter per device
  if ('increment' in config && (config as NumericFieldConfig).increment) {
    const currentCount = state.incrementCounters[fieldName] ?? 0;
    const newCount = currentCount + 1;
    state.incrementCounters[fieldName] = newCount;
    return newCount;
  }
  
  switch (config.type) {
    case 'float': {
      const numConfig = config as NumericFieldConfig;
      const { min, max, precision = 1 } = numConfig;
      let value = rng.nextFloat(min, max, precision);
      
      // Apply drift smoothing for environmental values (temp, humidity)
      if (options.enableDrift && state.lastValues[fieldName] !== undefined) {
        const lastValue = state.lastValues[fieldName] as number;
        const maxStep = options.driftMaxStep ?? 2.0;
        const delta = value - lastValue;
        const clampedDelta = Math.max(-maxStep, Math.min(maxStep, delta));
        value = lastValue + clampedDelta;
        // Clamp to bounds
        value = Math.max(min, Math.min(max, value));
        // Re-apply precision
        const factor = Math.pow(10, precision);
        value = Math.round(value * factor) / factor;
      }
      
      state.lastValues[fieldName] = value;
      return value;
    }
    
    case 'int': {
      const numConfig = config as NumericFieldConfig;
      const { min, max } = numConfig;
      const value = rng.nextInt(min, max);
      state.lastValues[fieldName] = value;
      return value;
    }
    
    case 'bool': {
      const value = rng.nextBool();
      state.lastValues[fieldName] = value;
      return value;
    }
    
    case 'enum': {
      const enumConfig = config as EnumFieldConfig;
      const { values } = enumConfig;
      if (!values || values.length === 0) {
        return null;
      }
      const value = rng.nextEnum(values);
      state.lastValues[fieldName] = value;
      return value;
    }
    
    case 'string': {
      const strConfig = config as StringFieldConfig;
      return strConfig.default ?? '';
    }
    
    default:
      return null;
  }
}

// ============================================
// Main Generation Function
// ============================================

/**
 * Generate all fields for a device based on its simulation profile
 * 
 * @param profile - The simulation profile from the device definition
 * @param state - Current device simulation state (will be mutated)
 * @param context - Simulation context for deterministic seeding
 * @param mode - Generation mode ('normal' or 'alarm')
 * @param options - Optional generation options (drift, alarm overrides)
 * @returns Generated fields and updated state
 */
export function generateFields(
  profile: SimulationProfile,
  state: DeviceSimulationState,
  context: SimulationContext,
  mode: GenerationMode = 'normal',
  options: GenerationOptions = {}
): GenerationResult {
  const fields: Record<string, unknown> = {};
  const { enableDrift = false, driftMaxStep = 2.0, alarmOverrides } = options;
  
  // Generate each field
  for (const [fieldName, fieldConfig] of Object.entries(profile.fields)) {
    // Create deterministic seed for this field
    const seed = createFieldSeed(context, fieldName);
    const rng = new SeededRandom(seed);
    
    // Generate the field value
    const value = generateFieldValue(
      fieldName,
      fieldConfig,
      rng,
      state,
      { enableDrift, driftMaxStep }
    );
    
    fields[fieldName] = value;
  }
  
  // Apply alarm overrides if in alarm mode
  if (mode === 'alarm' && alarmOverrides) {
    for (const [key, value] of Object.entries(alarmOverrides)) {
      fields[key] = value;
    }
  }
  
  // Update state metadata
  const now = new Date().toISOString();
  state.emissionSequence++;
  state.f_cnt++;
  state.lastEmittedAt = now;
  state.updatedAt = now;
  
  return {
    fields,
    updatedState: state,
    metadata: {
      f_cnt: state.f_cnt,
      emissionSequence: state.emissionSequence,
      mode,
      generatedAt: now,
    },
  };
}

/**
 * Generate payload for a specific device definition
 * 
 * @param device - The device definition from the library
 * @param state - Current device simulation state
 * @param context - Simulation context
 * @param mode - Generation mode
 * @param options - Generation options
 */
export function generateDevicePayload(
  device: DeviceDefinition,
  state: DeviceSimulationState,
  context: SimulationContext,
  mode: GenerationMode = 'normal',
  options: GenerationOptions = {}
): GenerationResult {
  // Use alarm examples as overrides if available
  const alarmOverrides = mode === 'alarm' && device.examples.alarm
    ? device.examples.alarm
    : undefined;
  
  // Enable drift for environmental sensors
  const enableDrift = options.enableDrift ?? 
    (device.category === 'temperature' || device.category === 'air_quality');
  
  return generateFields(
    device.simulation_profile,
    state,
    context,
    mode,
    {
      ...options,
      enableDrift,
      alarmOverrides: alarmOverrides ?? options.alarmOverrides,
    }
  );
}

/**
 * Create initial simulation state for a device
 */
export function createInitialSimulationState(
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
 * Verify determinism: generate N payloads with same context, should be identical
 */
export function verifyDeterminism(
  profile: SimulationProfile,
  context: SimulationContext,
  iterations: number = 10
): boolean {
  const results: string[] = [];
  
  for (let i = 0; i < iterations; i++) {
    // Create fresh state each time
    const state = createInitialSimulationState(
      context.deviceInstanceId,
      'test-device'
    );
    state.emissionSequence = context.emissionSequence;
    
    const result = generateFields(profile, state, context, 'normal');
    results.push(JSON.stringify(result.fields));
  }
  
  // All results should be identical
  return results.every(r => r === results[0]);
}
