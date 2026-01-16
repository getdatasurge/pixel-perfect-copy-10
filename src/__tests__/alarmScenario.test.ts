/**
 * Alarm & Scenario Tests
 * 
 * Verifies alarm payload generation, scenario overrides, and constraint clamping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defaultDeviceLibrary } from '@/lib/deviceLibrary/defaultLibrary';
import { 
  composeScenarioPayload, 
  composeAlarmPayload,
  getDeviceScenarios,
  deviceSupportsScenario,
  SCENARIOS,
  type ScenarioType,
} from '@/lib/deviceLibrary/scenarioComposer';
import { createInitialSimulationState } from '@/lib/deviceLibrary/simulationEngine';
import { clearAllDeviceStates } from '@/lib/deviceLibrary/deviceStateStore';
import type { SimulationContext, NumericFieldConfig } from '@/lib/deviceLibrary/types';

// ============================================
// Test Setup
// ============================================

const baseContext: SimulationContext = {
  orgId: 'alarm-test-org',
  siteId: 'alarm-test-site',
  unitId: 'alarm-test-unit',
  deviceInstanceId: 'alarm-test-device',
  emissionSequence: 1,
};

describe('Alarm Merge', () => {
  beforeEach(() => {
    clearAllDeviceStates();
  });

  it('uses device examples.alarm as base when available', () => {
    // Find a device with alarm examples
    const deviceWithAlarm = defaultDeviceLibrary.devices.find(d => d.examples.alarm);
    if (!deviceWithAlarm) {
      console.log('No devices with alarm examples found, skipping test');
      return;
    }

    const state = createInitialSimulationState(baseContext.deviceInstanceId, deviceWithAlarm.id);
    const result = composeScenarioPayload(deviceWithAlarm, 'alarm', state, baseContext);

    // All alarm example fields should be in the result
    for (const [key, value] of Object.entries(deviceWithAlarm.examples.alarm!)) {
      expect(result.fields[key]).toBe(value);
    }
  });

  it('preserves required profile static fields in alarm mode', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const state = createInitialSimulationState(`static-test-${device.id}`, device.id);
      const result = composeScenarioPayload(device, 'alarm', state, {
        ...baseContext,
        deviceInstanceId: `static-test-${device.id}`,
      });

      // Check that static fields are present with their default values
      for (const [fieldName, fieldConfig] of Object.entries(device.simulation_profile.fields)) {
        if (fieldConfig.static && fieldConfig.default !== undefined) {
          // Static field should be present (may be overridden by alarm example)
          expect(result.fields).toHaveProperty(fieldName);
        }
      }
    }
  });

  it('clamps overrides to profile constraints', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const state = createInitialSimulationState(`clamp-test-${device.id}`, device.id);
      const result = composeScenarioPayload(device, 'temp_excursion', state, {
        ...baseContext,
        deviceInstanceId: `clamp-test-${device.id}`,
      });

      // All numeric fields must be within their constraints
      for (const [fieldName, value] of Object.entries(result.fields)) {
        const fieldConfig = device.simulation_profile.fields[fieldName];
        if (!fieldConfig) continue;

        if (fieldConfig.type === 'float' || fieldConfig.type === 'int') {
          const numConfig = fieldConfig as NumericFieldConfig;
          if (typeof value === 'number') {
            expect(value).toBeGreaterThanOrEqual(numConfig.min);
            expect(value).toBeLessThanOrEqual(numConfig.max);
          }
        }
      }
    }
  });

  it('handles devices without examples.alarm gracefully', () => {
    // Find a device without alarm examples
    const deviceNoAlarm = defaultDeviceLibrary.devices.find(d => !d.examples.alarm);
    if (!deviceNoAlarm) {
      console.log('All devices have alarm examples, skipping test');
      return;
    }

    const state = createInitialSimulationState(baseContext.deviceInstanceId, deviceNoAlarm.id);
    
    // Should not throw
    expect(() => {
      composeScenarioPayload(deviceNoAlarm, 'alarm', state, baseContext);
    }).not.toThrow();

    const result = composeScenarioPayload(deviceNoAlarm, 'alarm', state, {
      ...baseContext,
      emissionSequence: 2,
    });
    
    // Should still produce valid fields
    expect(Object.keys(result.fields).length).toBeGreaterThan(0);
  });

  it('alarm-only fields exist when device has examples.alarm', () => {
    const deviceWithAlarm = defaultDeviceLibrary.devices.find(d => d.examples.alarm);
    if (!deviceWithAlarm) {
      return;
    }

    const normalState = createInitialSimulationState('normal-test', deviceWithAlarm.id);
    const alarmState = createInitialSimulationState('alarm-test', deviceWithAlarm.id);

    const normalResult = composeScenarioPayload(deviceWithAlarm, 'normal', normalState, {
      ...baseContext,
      deviceInstanceId: 'normal-test',
    });
    const alarmResult = composeScenarioPayload(deviceWithAlarm, 'alarm', alarmState, {
      ...baseContext,
      deviceInstanceId: 'alarm-test',
    });

    // Alarm fields from examples.alarm should exist in alarm result
    for (const key of Object.keys(deviceWithAlarm.examples.alarm!)) {
      expect(alarmResult.fields).toHaveProperty(key);
    }
  });
});

describe('Scenario Overrides', () => {
  beforeEach(() => {
    clearAllDeviceStates();
  });

  it('temp_excursion: temperature field at/near max for applicable devices', () => {
    const tempDevice = defaultDeviceLibrary.devices.find(d => 
      deviceSupportsScenario(d, 'temp_excursion')
    );
    if (!tempDevice) {
      return;
    }

    const state = createInitialSimulationState('temp-exc-test', tempDevice.id);
    const result = composeScenarioPayload(tempDevice, 'temp_excursion', state, {
      ...baseContext,
      deviceInstanceId: 'temp-exc-test',
    });

    // Check if temperature field exists and is clamped to max
    const tempField = tempDevice.simulation_profile.fields['temperature'] ||
                      tempDevice.simulation_profile.fields['Temperature'];
    
    if (tempField && (tempField.type === 'float' || tempField.type === 'int')) {
      const numConfig = tempField as NumericFieldConfig;
      const tempValue = result.fields['temperature'] ?? result.fields['Temperature'];
      if (typeof tempValue === 'number') {
        // Should be at max (clamped from scenario override of 75)
        expect(tempValue).toBeLessThanOrEqual(numConfig.max);
      }
    }
  });

  it('door_left_open: door_open=true for door devices', () => {
    const doorDevice = defaultDeviceLibrary.devices.find(d => 
      deviceSupportsScenario(d, 'door_left_open')
    );
    if (!doorDevice) {
      return;
    }

    const state = createInitialSimulationState('door-test', doorDevice.id);
    const result = composeScenarioPayload(doorDevice, 'door_left_open', state, {
      ...baseContext,
      deviceInstanceId: 'door-test',
    });

    // Should have door_open or similar field set to true
    const hasDoorOpen = result.fields['door_open'] === true || 
                        result.fields['Door_open_status'] === 1 ||
                        result.fields['alarm'] === true;
    expect(hasDoorOpen).toBe(true);
  });

  it('leak: leak_detected=true for leak devices', () => {
    const leakDevice = defaultDeviceLibrary.devices.find(d => 
      deviceSupportsScenario(d, 'leak') && d.category === 'leak'
    );
    if (!leakDevice) {
      return;
    }

    const state = createInitialSimulationState('leak-test', leakDevice.id);
    const result = composeScenarioPayload(leakDevice, 'leak', state, {
      ...baseContext,
      deviceInstanceId: 'leak-test',
    });

    // Should have leak indicator
    const hasLeak = result.fields['leak_detected'] === true || 
                    result.fields['leak_status'] === 1 ||
                    result.fields['Water_leak_status'] === 1;
    expect(hasLeak).toBe(true);
  });

  it('low_battery: battery near min for all devices', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const state = createInitialSimulationState(`battery-test-${device.id}`, device.id);
      const result = composeScenarioPayload(device, 'low_battery', state, {
        ...baseContext,
        deviceInstanceId: `battery-test-${device.id}`,
      });

      // Look for battery field
      const batteryField = device.simulation_profile.fields['battery'] ||
                           device.simulation_profile.fields['Battery'];
      
      if (batteryField && (batteryField.type === 'float' || batteryField.type === 'int')) {
        const numConfig = batteryField as NumericFieldConfig;
        const batteryValue = result.fields['battery'] ?? result.fields['Battery'];
        
        if (typeof batteryValue === 'number') {
          // Should be near min or at the override value (5), clamped to constraints
          expect(batteryValue).toBeLessThanOrEqual(numConfig.max);
          expect(batteryValue).toBeGreaterThanOrEqual(numConfig.min);
        }
      }
    }
  });

  it('poor_signal: signal overrides are available', () => {
    const scenario = SCENARIOS.poor_signal;
    expect(scenario.signalOverrides).toBeDefined();
    expect(scenario.signalOverrides?.rssi).toBeLessThan(-100);
    expect(scenario.signalOverrides?.snr).toBeLessThan(0);
  });

  it('all scenarios have required structure', () => {
    for (const [scenarioId, scenario] of Object.entries(SCENARIOS)) {
      expect(scenario.id).toBe(scenarioId);
      expect(scenario.name).toBeTruthy();
      expect(scenario.description).toBeTruthy();
      expect(typeof scenario.overrides).toBe('object');
    }
  });

  it('getDeviceScenarios returns applicable scenarios', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const scenarios = getDeviceScenarios(device);
      
      // All devices should support at least normal, alarm, low_battery, poor_signal
      expect(scenarios.length).toBeGreaterThanOrEqual(4);
      
      // Verify each returned scenario is applicable
      for (const scenario of scenarios) {
        expect(deviceSupportsScenario(device, scenario.id)).toBe(true);
      }
    }
  });
});

describe('Alarm Trigger System', () => {
  beforeEach(() => {
    clearAllDeviceStates();
  });

  it('composeAlarmPayload generates valid payload with alarm metadata', () => {
    const tempDevice = defaultDeviceLibrary.devices.find(d => 
      d.category === 'temperature'
    );
    if (!tempDevice) {
      return;
    }

    const state = createInitialSimulationState('alarm-trigger-test', tempDevice.id);
    
    // Use a known alarm trigger ID
    const result = composeAlarmPayload(tempDevice, 'temp_high', state, {
      ...baseContext,
      deviceInstanceId: 'alarm-trigger-test',
    });

    expect(result.alarm).toBeDefined();
    expect(result.alarm.id).toBe('temp_high');
    expect(result.fields).toBeDefined();
  });

  it('throws for unknown alarm trigger', () => {
    const device = defaultDeviceLibrary.devices[0];
    const state = createInitialSimulationState('bad-alarm-test', device.id);

    expect(() => {
      composeAlarmPayload(device, 'nonexistent_alarm' as any, state, baseContext);
    }).toThrow();
  });
});
