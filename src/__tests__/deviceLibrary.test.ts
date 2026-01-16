/**
 * Device Library Tests
 * 
 * Vitest tests for device library schema, determinism, bounds, and increment persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateDeviceLibrary } from '@/lib/deviceLibrary/schema';
import { defaultDeviceLibrary } from '@/lib/deviceLibrary/defaultLibrary';
import { 
  generateFields, 
  createInitialSimulationState, 
  verifyDeterminism,
  SeededRandom,
} from '@/lib/deviceLibrary/simulationEngine';
import {
  getDeviceSimState,
  resetDeviceSimState,
  incrementFCnt,
  incrementCounter,
  clearAllDeviceStates,
} from '@/lib/deviceLibrary/deviceStateStore';
import type { SimulationContext, NumericFieldConfig, EnumFieldConfig } from '@/lib/deviceLibrary/types';

// ============================================
// Schema Validation Tests
// ============================================

describe('Device Library Schema', () => {
  it('validates default library successfully', () => {
    const result = validateDeviceLibrary(defaultDeviceLibrary);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid device definitions', () => {
    const invalidLibrary = {
      metadata: { version: '1.0' },
      devices: [{ id: 'bad-device' }], // Missing required fields
    };
    
    const result = validateDeviceLibrary(invalidLibrary);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates all field types correctly', () => {
    for (const device of defaultDeviceLibrary.devices) {
      for (const [fieldName, config] of Object.entries(device.simulation_profile.fields)) {
        expect(['float', 'int', 'bool', 'enum', 'string']).toContain(config.type);
        
        if (config.type === 'float' || config.type === 'int') {
          const numConfig = config as NumericFieldConfig;
          expect(typeof numConfig.min).toBe('number');
          expect(typeof numConfig.max).toBe('number');
          expect(numConfig.min).toBeLessThanOrEqual(numConfig.max);
        }
        
        if (config.type === 'enum') {
          const enumConfig = config as EnumFieldConfig;
          expect(Array.isArray(enumConfig.values)).toBe(true);
          expect(enumConfig.values.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('ensures all devices have required fields', () => {
    for (const device of defaultDeviceLibrary.devices) {
      expect(device.id).toBeTruthy();
      expect(device.name).toBeTruthy();
      expect(device.manufacturer).toBeTruthy();
      expect(device.category).toBeTruthy();
      expect(device.default_fport).toBeGreaterThan(0);
      expect(device.simulation_profile).toBeTruthy();
      expect(device.simulation_profile.fields).toBeTruthy();
    }
  });
});

// ============================================
// Deterministic Simulation Tests
// ============================================

describe('Deterministic Simulation', () => {
  const testContext: SimulationContext = {
    orgId: 'test-org-123',
    siteId: 'test-site-456',
    unitId: 'test-unit-789',
    deviceInstanceId: 'test-device-abc',
    emissionSequence: 42,
  };

  it('generates identical payloads for same context', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    const results: string[] = [];
    
    for (let i = 0; i < 10; i++) {
      const state = createInitialSimulationState(testContext.deviceInstanceId, device.id);
      state.emissionSequence = testContext.emissionSequence;
      
      const result = generateFields(device.simulation_profile, state, testContext, 'normal');
      results.push(JSON.stringify(result.fields));
    }
    
    // All results should be identical
    expect(results.every(r => r === results[0])).toBe(true);
  });

  it('generates different payloads for different contexts', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    const context1: SimulationContext = { ...testContext, emissionSequence: 1 };
    const context2: SimulationContext = { ...testContext, emissionSequence: 2 };
    
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    expect(JSON.stringify(result1.fields)).not.toBe(JSON.stringify(result2.fields));
  });

  it('changing orgId changes output', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    const context1: SimulationContext = { ...testContext, orgId: 'org-A' };
    const context2: SimulationContext = { ...testContext, orgId: 'org-B' };
    
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    expect(JSON.stringify(result1.fields)).not.toBe(JSON.stringify(result2.fields));
  });

  it('changing siteId changes output', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    const context1: SimulationContext = { ...testContext, siteId: 'site-A' };
    const context2: SimulationContext = { ...testContext, siteId: 'site-B' };
    
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    expect(JSON.stringify(result1.fields)).not.toBe(JSON.stringify(result2.fields));
  });

  it('changing unitId changes output', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    const context1: SimulationContext = { ...testContext, unitId: 'unit-A' };
    const context2: SimulationContext = { ...testContext, unitId: 'unit-B' };
    
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    expect(JSON.stringify(result1.fields)).not.toBe(JSON.stringify(result2.fields));
  });

  it('changing deviceInstanceId changes output', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    const context1: SimulationContext = { ...testContext, deviceInstanceId: 'device-A' };
    const context2: SimulationContext = { ...testContext, deviceInstanceId: 'device-B' };
    
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    expect(JSON.stringify(result1.fields)).not.toBe(JSON.stringify(result2.fields));
  });

  it('maintains determinism across 100 iterations', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    const isDeterministic = verifyDeterminism(device.simulation_profile, testContext, 100);
    
    expect(isDeterministic).toBe(true);
  });

  it('SeededRandom produces deterministic sequence', () => {
    const seed = 12345;
    const rng1 = new SeededRandom(seed);
    const rng2 = new SeededRandom(seed);
    
    const values1 = Array.from({ length: 100 }, () => rng1.next());
    const values2 = Array.from({ length: 100 }, () => rng2.next());
    
    expect(values1).toEqual(values2);
  });
});

// ============================================
// Bounds Enforcement Tests
// ============================================

describe('Bounds Enforcement', () => {
  it('keeps float values within min/max', () => {
    for (const device of defaultDeviceLibrary.devices) {
      for (let i = 0; i < 100; i++) {
        const context: SimulationContext = {
          orgId: 'bounds-test-org',
          siteId: 'bounds-test-site',
          unitId: 'bounds-test-unit',
          deviceInstanceId: `bounds-test-${device.id}`,
          emissionSequence: i,
        };
        
        const state = createInitialSimulationState(context.deviceInstanceId, device.id);
        state.emissionSequence = i;
        
        const result = generateFields(device.simulation_profile, state, context, 'normal');
        
        for (const [fieldName, value] of Object.entries(result.fields)) {
          const fieldConfig = device.simulation_profile.fields[fieldName];
          
          if (fieldConfig.type === 'float') {
            const numConfig = fieldConfig as NumericFieldConfig;
            expect(value as number).toBeGreaterThanOrEqual(numConfig.min);
            expect(value as number).toBeLessThanOrEqual(numConfig.max);
          }
        }
      }
    }
  });

  it('keeps int values within min/max', () => {
    for (const device of defaultDeviceLibrary.devices) {
      for (let i = 0; i < 100; i++) {
        const context: SimulationContext = {
          orgId: 'bounds-test-org',
          siteId: 'bounds-test-site',
          unitId: 'bounds-test-unit',
          deviceInstanceId: `bounds-test-${device.id}`,
          emissionSequence: i,
        };
        
        const state = createInitialSimulationState(context.deviceInstanceId, device.id);
        state.emissionSequence = i;
        
        const result = generateFields(device.simulation_profile, state, context, 'normal');
        
        for (const [fieldName, value] of Object.entries(result.fields)) {
          const fieldConfig = device.simulation_profile.fields[fieldName];
          
          if (fieldConfig.type === 'int') {
            const numConfig = fieldConfig as NumericFieldConfig;
            expect(value as number).toBeGreaterThanOrEqual(numConfig.min);
            expect(value as number).toBeLessThanOrEqual(numConfig.max);
            expect(Number.isInteger(value)).toBe(true);
          }
        }
      }
    }
  });

  it('only selects valid enum values', () => {
    for (const device of defaultDeviceLibrary.devices) {
      for (let i = 0; i < 100; i++) {
        const context: SimulationContext = {
          orgId: 'bounds-test-org',
          siteId: 'bounds-test-site',
          unitId: 'bounds-test-unit',
          deviceInstanceId: `bounds-test-${device.id}`,
          emissionSequence: i,
        };
        
        const state = createInitialSimulationState(context.deviceInstanceId, device.id);
        state.emissionSequence = i;
        
        const result = generateFields(device.simulation_profile, state, context, 'normal');
        
        for (const [fieldName, value] of Object.entries(result.fields)) {
          const fieldConfig = device.simulation_profile.fields[fieldName];
          
          if (fieldConfig.type === 'enum') {
            const enumConfig = fieldConfig as EnumFieldConfig;
            expect(enumConfig.values).toContain(value);
          }
        }
      }
    }
  });
});

// ============================================
// Increment Field Tests
// ============================================

describe('Increment Fields', () => {
  const testDeviceId = 'test-increment-device';
  const testLibraryId = 'test-library';

  beforeEach(() => {
    resetDeviceSimState(testDeviceId, testLibraryId);
  });

  afterEach(() => {
    resetDeviceSimState(testDeviceId, testLibraryId);
  });

  it('increments f_cnt each emission', () => {
    const fCnt1 = incrementFCnt(testDeviceId);
    const fCnt2 = incrementFCnt(testDeviceId);
    const fCnt3 = incrementFCnt(testDeviceId);
    
    expect(fCnt1).toBe(1);
    expect(fCnt2).toBe(2);
    expect(fCnt3).toBe(3);
  });

  it('increments named counters correctly', () => {
    const count1 = incrementCounter(testDeviceId, 'door_open_count');
    const count2 = incrementCounter(testDeviceId, 'door_open_count');
    const count3 = incrementCounter(testDeviceId, 'door_open_count');
    
    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  it('persists counters in state', () => {
    incrementFCnt(testDeviceId);
    incrementFCnt(testDeviceId);
    incrementFCnt(testDeviceId);
    
    const state = getDeviceSimState(testDeviceId, testLibraryId);
    expect(state.f_cnt).toBe(3);
  });

  it('maintains separate counters per device', () => {
    const device1 = 'device-1';
    const device2 = 'device-2';
    
    incrementFCnt(device1);
    incrementFCnt(device1);
    incrementFCnt(device2);
    
    const state1 = getDeviceSimState(device1, testLibraryId);
    const state2 = getDeviceSimState(device2, testLibraryId);
    
    expect(state1.f_cnt).toBe(2);
    expect(state2.f_cnt).toBe(1);
    
    // Cleanup
    resetDeviceSimState(device1, testLibraryId);
    resetDeviceSimState(device2, testLibraryId);
  });
});

// ============================================
// Alarm & Scenario Tests
// ============================================

describe('Alarm & Scenarios', () => {
  it('applies alarm overrides correctly', () => {
    if (defaultDeviceLibrary.devices.length === 0) return;
    
    const device = defaultDeviceLibrary.devices[0];
    
    // Skip if no alarm examples
    if (!device.examples.alarm) return;
    
    const context: SimulationContext = {
      orgId: 'alarm-test-org',
      siteId: 'alarm-test-site',
      unitId: 'alarm-test-unit',
      deviceInstanceId: 'alarm-test-device',
      emissionSequence: 1,
    };
    
    const state = createInitialSimulationState(context.deviceInstanceId, device.id);
    state.emissionSequence = context.emissionSequence;
    
    const normalResult = generateFields(device.simulation_profile, state, context, 'normal');
    
    // Reset state for alarm test
    const alarmState = createInitialSimulationState(context.deviceInstanceId, device.id);
    alarmState.emissionSequence = context.emissionSequence;
    
    const alarmResult = generateFields(
      device.simulation_profile, 
      alarmState, 
      context, 
      'alarm',
      { alarmOverrides: device.examples.alarm }
    );
    
    // Alarm values should match the examples.alarm overrides
    for (const [key, value] of Object.entries(device.examples.alarm)) {
      expect(alarmResult.fields[key]).toBe(value);
    }
  });
});
