/**
 * Multi-Device Smoke Test
 * 
 * Simulates 12 devices emitting concurrently for verification of:
 * - Message count per device
 * - f_cnt monotonic per device
 * - Increment counters monotonic
 * - No cross-device state bleed
 * - All bounds respected
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defaultDeviceLibrary } from '@/lib/deviceLibrary/defaultLibrary';
import { 
  generateDevicePayload,
  createInitialSimulationState,
} from '@/lib/deviceLibrary/simulationEngine';
import { 
  buildLibraryEnvelope,
  type DeviceInstance,
  type GatewayInstance,
} from '@/lib/deviceLibrary/envelopeBuilder';
import { 
  clearAllDeviceStates,
  getDeviceSimState,
  updateDeviceSimState,
} from '@/lib/deviceLibrary/deviceStateStore';
import type { 
  SimulationContext, 
  DeviceSimulationState, 
  NumericFieldConfig,
  EnumFieldConfig,
} from '@/lib/deviceLibrary/types';

// ============================================
// Test Configuration
// ============================================

const SMOKE_TEST_DURATION_MS = 60_000; // 60 seconds simulated
const EMISSION_INTERVAL_MS = 5_000; // 5 second interval
const EXPECTED_MIN_EMISSIONS = Math.floor(SMOKE_TEST_DURATION_MS / EMISSION_INTERVAL_MS) - 1;

const testGateway: GatewayInstance = {
  id: 'smoke-test-gateway',
  eui: 'AAFF00112233AABB',
};

interface DeviceEmissionRecord {
  deviceId: string;
  libraryDeviceId: string;
  emissions: {
    f_cnt: number;
    emissionSequence: number;
    timestamp: number;
    fields: Record<string, unknown>;
  }[];
  incrementCounters: Map<string, number[]>;
}

// ============================================
// Smoke Tests
// ============================================

describe('Multi-Device Smoke Test', () => {
  beforeEach(() => {
    clearAllDeviceStates();
  });

  it('emulates 12 devices concurrently for 60s (simulated)', async () => {
    // Take first 12 devices (or all if less than 12)
    const devices = defaultDeviceLibrary.devices.slice(0, 12);
    const deviceRecords: Map<string, DeviceEmissionRecord> = new Map();

    // Initialize each device
    for (const device of devices) {
      const deviceId = `smoke-test-${device.id}`;
      deviceRecords.set(deviceId, {
        deviceId,
        libraryDeviceId: device.id,
        emissions: [],
        incrementCounters: new Map(),
      });
    }

    // Simulate emissions over 60 seconds with 5-second intervals
    const numEmissions = Math.ceil(SMOKE_TEST_DURATION_MS / EMISSION_INTERVAL_MS);
    
    for (let emissionIdx = 0; emissionIdx < numEmissions; emissionIdx++) {
      const timestamp = emissionIdx * EMISSION_INTERVAL_MS;

      // Emit from all devices concurrently (in simulation)
      for (const device of devices) {
        const deviceId = `smoke-test-${device.id}`;
        const record = deviceRecords.get(deviceId)!;
        
        // Get or create state
        let state = getDeviceSimState(deviceId, device.id);
        
        const context: SimulationContext = {
          orgId: 'smoke-test-org',
          siteId: 'smoke-test-site',
          unitId: 'smoke-test-unit',
          deviceInstanceId: deviceId,
          emissionSequence: emissionIdx + 1,
        };

        // Generate payload
        const result = generateDevicePayload(device, state, context);

        // Record emission
        record.emissions.push({
          f_cnt: result.metadata.f_cnt,
          emissionSequence: result.metadata.emissionSequence,
          timestamp,
          fields: { ...result.fields },
        });

        // Track increment counters
        for (const [fieldName, fieldConfig] of Object.entries(device.simulation_profile.fields)) {
          if ('increment' in fieldConfig && (fieldConfig as NumericFieldConfig).increment) {
            if (!record.incrementCounters.has(fieldName)) {
              record.incrementCounters.set(fieldName, []);
            }
            const value = result.fields[fieldName];
            if (typeof value === 'number') {
              record.incrementCounters.get(fieldName)!.push(value);
            }
          }
        }

        // Update state
        updateDeviceSimState({
          deviceInstanceId: deviceId,
          ...result.updatedState,
        });
      }
    }

    // ============================================
    // Assertions
    // ============================================

    // 1. Check message count per device
    for (const [deviceId, record] of deviceRecords) {
      expect(
        record.emissions.length,
        `Device ${deviceId} should have at least ${EXPECTED_MIN_EMISSIONS} emissions`
      ).toBeGreaterThanOrEqual(EXPECTED_MIN_EMISSIONS);
    }

    // 2. Check f_cnt strictly increasing per device
    for (const [deviceId, record] of deviceRecords) {
      for (let i = 1; i < record.emissions.length; i++) {
        expect(
          record.emissions[i].f_cnt,
          `Device ${deviceId} f_cnt should be strictly increasing`
        ).toBeGreaterThan(record.emissions[i - 1].f_cnt);
      }
    }

    // 3. Check increment counters are monotonically increasing
    for (const [deviceId, record] of deviceRecords) {
      for (const [fieldName, values] of record.incrementCounters) {
        for (let i = 1; i < values.length; i++) {
          expect(
            values[i],
            `Device ${deviceId} counter ${fieldName} should be monotonically increasing`
          ).toBeGreaterThanOrEqual(values[i - 1]);
        }
      }
    }

    // 4. No cross-device state bleed - each device should have unique f_cnt sequences
    const deviceFCntStarts: Map<string, number> = new Map();
    for (const [deviceId, record] of deviceRecords) {
      if (record.emissions.length > 0) {
        deviceFCntStarts.set(deviceId, record.emissions[0].f_cnt);
      }
    }
    
    // All devices should start at f_cnt = 1 (fresh state)
    for (const [deviceId, startFCnt] of deviceFCntStarts) {
      expect(startFCnt, `Device ${deviceId} should start at f_cnt 1`).toBe(1);
    }
  }, 30000); // 30 second timeout

  it('respects all field bounds across all devices', () => {
    const devices = defaultDeviceLibrary.devices.slice(0, 12);
    
    for (const device of devices) {
      for (let i = 0; i < 50; i++) {
        const deviceId = `bounds-smoke-${device.id}-${i}`;
        const state = createInitialSimulationState(deviceId, device.id);
        
        const context: SimulationContext = {
          orgId: 'bounds-smoke-org',
          siteId: 'bounds-smoke-site',
          unitId: 'bounds-smoke-unit',
          deviceInstanceId: deviceId,
          emissionSequence: i + 1,
        };

        const result = generateDevicePayload(device, state, context);

        // Check all fields against their constraints
        for (const [fieldName, value] of Object.entries(result.fields)) {
          const fieldConfig = device.simulation_profile.fields[fieldName];
          if (!fieldConfig) continue;

          switch (fieldConfig.type) {
            case 'float':
            case 'int': {
              const numConfig = fieldConfig as NumericFieldConfig;
              if (typeof value === 'number') {
                expect(value).toBeGreaterThanOrEqual(numConfig.min);
                expect(value).toBeLessThanOrEqual(numConfig.max);
              }
              break;
            }
            case 'enum': {
              const enumConfig = fieldConfig as EnumFieldConfig;
              expect(enumConfig.values).toContain(value);
              break;
            }
            case 'bool': {
              expect(typeof value).toBe('boolean');
              break;
            }
          }
        }
      }
    }
  });

  it('validates timestamps are ISO8601 UTC in envelopes', () => {
    const device = defaultDeviceLibrary.devices[0];
    const deviceId = 'timestamp-test-device';
    
    for (let i = 0; i < 20; i++) {
      const state = createInitialSimulationState(deviceId, device.id);
      state.f_cnt = i + 1;
      
      const context: SimulationContext = {
        orgId: 'timestamp-org',
        siteId: 'timestamp-site',
        unitId: 'timestamp-unit',
        deviceInstanceId: deviceId,
        emissionSequence: i + 1,
      };

      const result = generateDevicePayload(device, state, context);
      
      const deviceInstance: DeviceInstance = {
        devEui: 'A84041FFFF998877',
        name: 'Timestamp Test',
        gatewayId: testGateway.id,
      };

      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'timestamp-test-app'
      );

      // Validate timestamp format
      const receivedAt = envelope.received_at;
      expect(receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      
      // Validate parseable
      const parsed = new Date(receivedAt);
      expect(parsed.toISOString()).toBe(receivedAt);
    }
  });

  it('maintains device state isolation under concurrent emissions', () => {
    clearAllDeviceStates();
    
    const deviceA = defaultDeviceLibrary.devices[0];
    const deviceB = defaultDeviceLibrary.devices[1] || deviceA;
    
    const deviceAId = 'isolation-device-a';
    const deviceBId = 'isolation-device-b';

    // Interleave emissions
    for (let round = 0; round < 20; round++) {
      // Emit from device A
      let stateA = getDeviceSimState(deviceAId, deviceA.id);
      const resultA = generateDevicePayload(deviceA, stateA, {
        orgId: 'isolation-org',
        siteId: 'isolation-site',
        unitId: 'isolation-unit',
        deviceInstanceId: deviceAId,
        emissionSequence: round * 2 + 1,
      });
      updateDeviceSimState({
        deviceInstanceId: deviceAId,
        ...resultA.updatedState,
      });

      // Emit from device B
      let stateB = getDeviceSimState(deviceBId, deviceB.id);
      const resultB = generateDevicePayload(deviceB, stateB, {
        orgId: 'isolation-org',
        siteId: 'isolation-site',
        unitId: 'isolation-unit',
        deviceInstanceId: deviceBId,
        emissionSequence: round * 2 + 2,
      });
      updateDeviceSimState({
        deviceInstanceId: deviceBId,
        ...resultB.updatedState,
      });
    }

    // Verify states are independent
    const finalStateA = getDeviceSimState(deviceAId, deviceA.id);
    const finalStateB = getDeviceSimState(deviceBId, deviceB.id);

    // Both should have their own emission counts
    expect(finalStateA.f_cnt).toBe(20);
    expect(finalStateB.f_cnt).toBe(20);

    // Device A's state should reference device A
    expect(finalStateA.deviceInstanceId).toBe(deviceAId);
    expect(finalStateB.deviceInstanceId).toBe(deviceBId);
  });
});

describe('Emission Scheduler Integration', () => {
  it('EmissionScheduler tracks emissions correctly', async () => {
    const { createEmissionScheduler } = await import('@/lib/deviceLibrary/emissionScheduler');
    const scheduler = createEmissionScheduler();
    
    const emissions: string[] = [];
    
    // Start device with immediate emission
    scheduler.startDevice('test-device-1', 1, (deviceId) => {
      emissions.push(deviceId);
    }, { emitImmediately: true });

    // Wait a tiny bit for immediate emission
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(emissions).toContain('test-device-1');
    expect(scheduler.isRunning('test-device-1')).toBe(true);
    
    scheduler.stopAll();
    expect(scheduler.isRunning('test-device-1')).toBe(false);
  });

  it('EmissionScheduler maintains separate intervals per device', async () => {
    const { createEmissionScheduler } = await import('@/lib/deviceLibrary/emissionScheduler');
    const scheduler = createEmissionScheduler();
    
    const device1Emissions: number[] = [];
    const device2Emissions: number[] = [];
    
    scheduler.startDevice('device-1', 0.1, () => {
      device1Emissions.push(Date.now());
    }, { emitImmediately: true });
    
    scheduler.startDevice('device-2', 0.2, () => {
      device2Emissions.push(Date.now());
    }, { emitImmediately: true });

    // Wait for some emissions
    await new Promise(resolve => setTimeout(resolve, 350));
    
    scheduler.stopAll();
    
    // Device 1 should have more emissions than device 2 (faster interval)
    expect(device1Emissions.length).toBeGreaterThan(device2Emissions.length);
  });
});
