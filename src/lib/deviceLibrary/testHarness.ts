/**
 * Device Library Test Harness
 * 
 * Automated test utilities for validating device library functionality.
 * Can run in browser or with Vitest.
 */

import { validateDeviceLibrary } from './schema';
import { defaultDeviceLibrary } from './defaultLibrary';
import { generateFields, createInitialSimulationState, verifyDeterminism } from './simulationEngine';
import { 
  getDeviceSimState, 
  updateDeviceSimState, 
  resetDeviceSimState,
  incrementFCnt,
  incrementCounter,
} from './deviceStateStore';
import type { 
  DeviceLibrary, 
  SimulationContext, 
  DeviceSimulationState,
  NumericFieldConfig,
  EnumFieldConfig,
} from './types';
import { debug } from '@/lib/debugLogger';

// ============================================
// Test Result Types
// ============================================

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
  duration?: number;
}

export interface TestSuiteResult {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
  duration: number;
}

// ============================================
// Schema Validation Tests
// ============================================

/**
 * Test that the default library validates successfully
 */
export function testSchemaValidation(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test default library validation
  const start = performance.now();
  const validationResult = validateDeviceLibrary(defaultDeviceLibrary);
  const duration = performance.now() - start;
  
  results.push({
    name: 'Default library validates successfully',
    passed: validationResult.valid,
    message: validationResult.valid 
      ? `Library validated in ${duration.toFixed(2)}ms`
      : `Validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`,
    details: validationResult.errors.length > 0 ? validationResult.errors : undefined,
    duration,
  });
  
  // Test each device has required fields
  for (const device of defaultDeviceLibrary.devices) {
    const hasRequiredFields = 
      device.id && 
      device.name && 
      device.manufacturer && 
      device.category && 
      device.default_fport && 
      device.simulation_profile?.fields;
    
    results.push({
      name: `Device ${device.id} has required fields`,
      passed: !!hasRequiredFields,
      message: hasRequiredFields 
        ? 'All required fields present'
        : 'Missing required fields',
      details: {
        id: device.id,
        hasName: !!device.name,
        hasManufacturer: !!device.manufacturer,
        hasCategory: !!device.category,
        hasFport: !!device.default_fport,
        hasSimProfile: !!device.simulation_profile?.fields,
      },
    });
  }
  
  // Test invalid library rejection
  const invalidLibrary = {
    metadata: { version: '1.0' },
    devices: [{ id: 'bad-device' }], // Missing required fields
  };
  
  const invalidResult = validateDeviceLibrary(invalidLibrary);
  results.push({
    name: 'Invalid library is rejected',
    passed: !invalidResult.valid,
    message: invalidResult.valid 
      ? 'ERROR: Invalid library was accepted'
      : 'Invalid library correctly rejected',
    details: invalidResult.errors,
  });
  
  return results;
}

// ============================================
// Determinism Tests
// ============================================

/**
 * Test that same context produces identical payloads
 */
export function testDeterminism(iterations: number = 100): TestResult[] {
  const results: TestResult[] = [];
  
  const testContext: SimulationContext = {
    orgId: 'test-org-123',
    siteId: 'test-site-456',
    unitId: 'test-unit-789',
    deviceInstanceId: 'test-device-abc',
    emissionSequence: 42,
  };
  
  // Test each device in the library
  for (const device of defaultDeviceLibrary.devices) {
    const start = performance.now();
    const isDeterministic = verifyDeterminism(
      device.simulation_profile,
      testContext,
      iterations
    );
    const duration = performance.now() - start;
    
    results.push({
      name: `Device ${device.id} is deterministic`,
      passed: isDeterministic,
      message: isDeterministic 
        ? `${iterations} iterations produced identical results in ${duration.toFixed(2)}ms`
        : `Non-deterministic output detected`,
      duration,
    });
  }
  
  // Test different contexts produce different outputs
  const context1: SimulationContext = { ...testContext, emissionSequence: 1 };
  const context2: SimulationContext = { ...testContext, emissionSequence: 2 };
  
  if (defaultDeviceLibrary.devices.length > 0) {
    const device = defaultDeviceLibrary.devices[0];
    const state1 = createInitialSimulationState(context1.deviceInstanceId, device.id);
    const state2 = createInitialSimulationState(context2.deviceInstanceId, device.id);
    state1.emissionSequence = context1.emissionSequence;
    state2.emissionSequence = context2.emissionSequence;
    
    const result1 = generateFields(device.simulation_profile, state1, context1, 'normal');
    const result2 = generateFields(device.simulation_profile, state2, context2, 'normal');
    
    const areDifferent = JSON.stringify(result1.fields) !== JSON.stringify(result2.fields);
    
    results.push({
      name: 'Different contexts produce different outputs',
      passed: areDifferent,
      message: areDifferent 
        ? 'Different emission sequences correctly produce different results'
        : 'WARNING: Different contexts produced identical outputs',
    });
  }
  
  return results;
}

// ============================================
// Bounds Tests
// ============================================

/**
 * Test that generated values stay within defined bounds
 */
export function testBounds(samples: number = 1000): TestResult[] {
  const results: TestResult[] = [];
  
  for (const device of defaultDeviceLibrary.devices) {
    const violations: Array<{ field: string; value: unknown; min?: number; max?: number }> = [];
    
    for (let i = 0; i < samples; i++) {
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
      
      // Check each field against its bounds
      for (const [fieldName, value] of Object.entries(result.fields)) {
        const fieldConfig = device.simulation_profile.fields[fieldName];
        
        if (fieldConfig.type === 'float' || fieldConfig.type === 'int') {
          const numConfig = fieldConfig as NumericFieldConfig;
          const numValue = value as number;
          
          if (numValue < numConfig.min || numValue > numConfig.max) {
            violations.push({
              field: fieldName,
              value: numValue,
              min: numConfig.min,
              max: numConfig.max,
            });
          }
        }
        
        if (fieldConfig.type === 'enum') {
          const enumConfig = fieldConfig as EnumFieldConfig;
          if (!enumConfig.values.includes(value as string)) {
            violations.push({
              field: fieldName,
              value,
            });
          }
        }
      }
    }
    
    results.push({
      name: `Device ${device.id} values within bounds`,
      passed: violations.length === 0,
      message: violations.length === 0
        ? `${samples} samples all within defined bounds`
        : `${violations.length} bound violations detected`,
      details: violations.length > 0 ? violations.slice(0, 10) : undefined,
    });
  }
  
  return results;
}

// ============================================
// Increment Persistence Tests
// ============================================

/**
 * Test that increment counters persist correctly
 */
export function testIncrementPersistence(): TestResult[] {
  const results: TestResult[] = [];
  const testDeviceId = 'test-increment-device';
  const testLibraryId = 'test-library';
  
  // Clean up any existing state
  resetDeviceSimState(testDeviceId, testLibraryId);
  
  // Test f_cnt increment
  const fCnt1 = incrementFCnt(testDeviceId);
  const fCnt2 = incrementFCnt(testDeviceId);
  const fCnt3 = incrementFCnt(testDeviceId);
  
  results.push({
    name: 'f_cnt increments correctly',
    passed: fCnt1 === 1 && fCnt2 === 2 && fCnt3 === 3,
    message: fCnt1 === 1 && fCnt2 === 2 && fCnt3 === 3
      ? 'f_cnt increments: 1, 2, 3'
      : `Unexpected f_cnt values: ${fCnt1}, ${fCnt2}, ${fCnt3}`,
    details: { fCnt1, fCnt2, fCnt3 },
  });
  
  // Test named counter increment
  const counter1 = incrementCounter(testDeviceId, 'door_open_count');
  const counter2 = incrementCounter(testDeviceId, 'door_open_count');
  const counter3 = incrementCounter(testDeviceId, 'door_open_count');
  
  results.push({
    name: 'Named counters increment correctly',
    passed: counter1 === 1 && counter2 === 2 && counter3 === 3,
    message: counter1 === 1 && counter2 === 2 && counter3 === 3
      ? 'door_open_count increments: 1, 2, 3'
      : `Unexpected counter values: ${counter1}, ${counter2}, ${counter3}`,
    details: { counter1, counter2, counter3 },
  });
  
  // Test state persistence after update
  const state = getDeviceSimState(testDeviceId, testLibraryId);
  const preFCnt = state.f_cnt;
  
  updateDeviceSimState({
    deviceInstanceId: testDeviceId,
    f_cnt: preFCnt,
  });
  
  const stateAfter = getDeviceSimState(testDeviceId, testLibraryId);
  
  results.push({
    name: 'State persists after update',
    passed: stateAfter.f_cnt === preFCnt,
    message: stateAfter.f_cnt === preFCnt
      ? `f_cnt persisted correctly: ${preFCnt}`
      : `f_cnt changed unexpectedly: ${preFCnt} -> ${stateAfter.f_cnt}`,
  });
  
  // Clean up
  resetDeviceSimState(testDeviceId, testLibraryId);
  
  return results;
}

// ============================================
// Full Test Suite
// ============================================

/**
 * Run all tests and return aggregated results
 */
export function runTestSuite(): TestSuiteResult {
  const startTime = performance.now();
  const allResults: TestResult[] = [];
  
  debug.simulation('TEST_SUITE_START', { timestamp: new Date().toISOString() });
  
  // Run all test categories
  try {
    allResults.push(...testSchemaValidation());
  } catch (error) {
    allResults.push({
      name: 'Schema validation tests',
      passed: false,
      message: `Test threw error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  
  try {
    allResults.push(...testDeterminism(10)); // Reduced for speed
  } catch (error) {
    allResults.push({
      name: 'Determinism tests',
      passed: false,
      message: `Test threw error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  
  try {
    allResults.push(...testBounds(100)); // Reduced for speed
  } catch (error) {
    allResults.push({
      name: 'Bounds tests',
      passed: false,
      message: `Test threw error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  
  try {
    allResults.push(...testIncrementPersistence());
  } catch (error) {
    allResults.push({
      name: 'Increment persistence tests',
      passed: false,
      message: `Test threw error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  
  const duration = performance.now() - startTime;
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  
  const result: TestSuiteResult = {
    total: allResults.length,
    passed,
    failed,
    results: allResults,
    duration,
  };
  
  debug.simulation('TEST_SUITE_COMPLETE', {
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    duration: `${duration.toFixed(2)}ms`,
  });
  
  return result;
}

/**
 * Run tests and log results to console
 */
export function runTestsWithOutput(): TestSuiteResult {
  console.group('🧪 Device Library Test Suite');
  
  const result = runTestSuite();
  
  console.log(`\n📊 Results: ${result.passed}/${result.total} passed (${result.duration.toFixed(2)}ms)`);
  
  for (const test of result.results) {
    const icon = test.passed ? '✅' : '❌';
    console.log(`${icon} ${test.name}: ${test.message}`);
    if (test.details && !test.passed) {
      console.log('   Details:', test.details);
    }
  }
  
  console.groupEnd();
  
  return result;
}
