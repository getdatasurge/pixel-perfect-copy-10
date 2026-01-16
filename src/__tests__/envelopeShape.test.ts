/**
 * TTN Envelope Shape Tests
 * 
 * Verifies TTN v3 envelope structure, field correctness, and metadata.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defaultDeviceLibrary } from '@/lib/deviceLibrary/defaultLibrary';
import { 
  buildLibraryEnvelope,
  generateRxMetadata,
  type DeviceInstance,
  type GatewayInstance,
  type TTNEnvelope,
} from '@/lib/deviceLibrary/envelopeBuilder';
import { 
  generateDevicePayload,
  createInitialSimulationState,
} from '@/lib/deviceLibrary/simulationEngine';
import { clearAllDeviceStates, incrementFCnt } from '@/lib/deviceLibrary/deviceStateStore';
import type { SimulationContext } from '@/lib/deviceLibrary/types';

// ============================================
// Test Fixtures
// ============================================

const testGateway: GatewayInstance = {
  id: 'test-gateway-001',
  eui: 'A84041FFFF123456',
};

const testContext: SimulationContext = {
  orgId: 'envelope-test-org',
  siteId: 'envelope-test-site',
  unitId: 'envelope-test-unit',
  deviceInstanceId: 'envelope-test-device',
  emissionSequence: 1,
};

function createTestDeviceInstance(devEui: string): DeviceInstance {
  return {
    devEui,
    name: `Test Device ${devEui.slice(-4)}`,
    gatewayId: testGateway.id,
  };
}

// ============================================
// Envelope Shape Tests
// ============================================

describe('TTN Envelope Shape', () => {
  beforeEach(() => {
    clearAllDeviceStates();
  });

  it('device_id is stable sensor-{deveui} format', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF654321';
    const deviceInstance = createTestDeviceInstance(devEui);
    const state = createInitialSimulationState(devEui, device.id);
    
    const result = generateDevicePayload(device, state, testContext);
    const envelope = buildLibraryEnvelope(
      deviceInstance,
      testGateway,
      result.fields,
      device,
      state,
      'test-application'
    );

    // device_id should be sensor-{lowercase_deveui}
    expect(envelope.end_device_ids.device_id).toBe(`sensor-${devEui.toLowerCase()}`);
    
    // Multiple builds should produce same device_id
    const envelope2 = buildLibraryEnvelope(
      deviceInstance,
      testGateway,
      result.fields,
      device,
      state,
      'test-application'
    );
    expect(envelope2.end_device_ids.device_id).toBe(envelope.end_device_ids.device_id);
  });

  it('dev_eui is 16-char uppercase hex', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const devEui = 'a84041ffff' + Math.random().toString(16).slice(2, 8);
      const deviceInstance = createTestDeviceInstance(devEui);
      const state = createInitialSimulationState(devEui, device.id);
      
      const result = generateDevicePayload(device, state, {
        ...testContext,
        deviceInstanceId: devEui,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      const devEuiInEnvelope = envelope.end_device_ids.dev_eui;
      
      // Should be uppercase
      expect(devEuiInEnvelope).toBe(devEuiInEnvelope.toUpperCase());
      
      // Should be 16 characters (after normalization removes separators)
      expect(devEuiInEnvelope.length).toBe(16);
      
      // Should be valid hex
      expect(/^[0-9A-F]{16}$/.test(devEuiInEnvelope)).toBe(true);
    }
  });

  it('received_at is valid ISO8601 UTC', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF111111';
    const deviceInstance = createTestDeviceInstance(devEui);
    const state = createInitialSimulationState(devEui, device.id);
    
    const result = generateDevicePayload(device, state, testContext);
    const envelope = buildLibraryEnvelope(
      deviceInstance,
      testGateway,
      result.fields,
      device,
      state,
      'test-application'
    );

    const receivedAt = envelope.received_at;
    
    // Should be parseable as Date
    const parsed = new Date(receivedAt);
    expect(parsed.toString()).not.toBe('Invalid Date');
    
    // Should end with Z (UTC)
    expect(receivedAt.endsWith('Z')).toBe(true);
    
    // Should match ISO8601 format
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(receivedAt)).toBe(true);
  });

  it('f_port equals device default_fport', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const devEui = 'A84041FFFF' + device.id.slice(0, 6).toUpperCase();
      const deviceInstance = createTestDeviceInstance(devEui);
      const state = createInitialSimulationState(devEui, device.id);
      
      const result = generateDevicePayload(device, state, {
        ...testContext,
        deviceInstanceId: devEui,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      expect(envelope.uplink_message.f_port).toBe(device.default_fport);
    }
  });

  it('f_cnt increments monotonically per device instance', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF222222';
    const deviceInstance = createTestDeviceInstance(devEui);
    
    const fCntValues: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const state = createInitialSimulationState(devEui, device.id);
      // Manually set f_cnt to simulate incrementing
      state.f_cnt = i + 1;
      
      const result = generateDevicePayload(device, state, {
        ...testContext,
        deviceInstanceId: devEui,
        emissionSequence: i + 1,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      fCntValues.push(envelope.uplink_message.f_cnt);
    }

    // Check monotonic increase
    for (let i = 1; i < fCntValues.length; i++) {
      expect(fCntValues[i]).toBeGreaterThan(fCntValues[i - 1]);
    }
  });

  it('decoded_payload matches generated fields', () => {
    for (const device of defaultDeviceLibrary.devices) {
      const devEui = 'A84041FFFF' + device.id.slice(0, 6).toUpperCase();
      const deviceInstance = createTestDeviceInstance(devEui);
      const state = createInitialSimulationState(devEui, device.id);
      
      const result = generateDevicePayload(device, state, {
        ...testContext,
        deviceInstanceId: devEui,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      // decoded_payload should exactly match generated fields
      expect(envelope.uplink_message.decoded_payload).toEqual(result.fields);
    }
  });

  it('rssi in valid range [-120, -30]', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF333333';
    const deviceInstance = createTestDeviceInstance(devEui);
    
    for (let i = 0; i < 100; i++) {
      const state = createInitialSimulationState(devEui, device.id);
      const result = generateDevicePayload(device, state, {
        ...testContext,
        emissionSequence: i,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      const rssi = envelope.uplink_message.rx_metadata[0].rssi;
      expect(rssi).toBeGreaterThanOrEqual(-120);
      expect(rssi).toBeLessThanOrEqual(-30);
    }
  });

  it('snr in valid range [-20, 15]', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF444444';
    const deviceInstance = createTestDeviceInstance(devEui);
    
    for (let i = 0; i < 100; i++) {
      const state = createInitialSimulationState(devEui, device.id);
      const result = generateDevicePayload(device, state, {
        ...testContext,
        emissionSequence: i,
      });
      
      const envelope = buildLibraryEnvelope(
        deviceInstance,
        testGateway,
        result.fields,
        device,
        state,
        'test-application'
      );

      const snr = envelope.uplink_message.rx_metadata[0].snr;
      expect(snr).toBeGreaterThanOrEqual(-20);
      expect(snr).toBeLessThanOrEqual(15);
    }
  });
});

describe('rx_metadata Generation', () => {
  it('generates valid rx_metadata array', () => {
    const rxMetadata = generateRxMetadata(testGateway);
    
    expect(Array.isArray(rxMetadata)).toBe(true);
    expect(rxMetadata.length).toBe(1);
    
    const meta = rxMetadata[0];
    expect(meta.gateway_ids.gateway_id).toBe(testGateway.id);
    expect(meta.gateway_ids.eui).toBe(testGateway.eui.toUpperCase());
    expect(typeof meta.rssi).toBe('number');
    expect(typeof meta.snr).toBe('number');
  });

  it('applies signal overrides correctly', () => {
    const customRssi = -100;
    const customSnr = -5;
    
    const rxMetadata = generateRxMetadata(testGateway, {
      rssi: customRssi,
      snr: customSnr,
    });

    expect(rxMetadata[0].rssi).toBe(customRssi);
    expect(rxMetadata[0].snr).toBe(customSnr);
  });

  it('includes timestamp when provided', () => {
    const customTimestamp = Date.now();
    
    const rxMetadata = generateRxMetadata(testGateway, {
      timestamp: customTimestamp,
    });

    expect(rxMetadata[0].timestamp).toBe(customTimestamp);
  });
});

describe('Envelope Structure', () => {
  it('has all required TTN v3 fields', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF555555';
    const deviceInstance = createTestDeviceInstance(devEui);
    const state = createInitialSimulationState(devEui, device.id);
    
    const result = generateDevicePayload(device, state, testContext);
    const envelope = buildLibraryEnvelope(
      deviceInstance,
      testGateway,
      result.fields,
      device,
      state,
      'test-application'
    );

    // Check required structure
    expect(envelope).toHaveProperty('end_device_ids');
    expect(envelope.end_device_ids).toHaveProperty('device_id');
    expect(envelope.end_device_ids).toHaveProperty('dev_eui');
    expect(envelope.end_device_ids).toHaveProperty('application_ids');
    expect(envelope.end_device_ids.application_ids).toHaveProperty('application_id');
    
    expect(envelope).toHaveProperty('received_at');
    
    expect(envelope).toHaveProperty('uplink_message');
    expect(envelope.uplink_message).toHaveProperty('f_port');
    expect(envelope.uplink_message).toHaveProperty('f_cnt');
    expect(envelope.uplink_message).toHaveProperty('decoded_payload');
    expect(envelope.uplink_message).toHaveProperty('frm_payload');
    expect(envelope.uplink_message).toHaveProperty('rx_metadata');
  });

  it('application_id matches provided value', () => {
    const device = defaultDeviceLibrary.devices[0];
    const devEui = 'A84041FFFF666666';
    const deviceInstance = createTestDeviceInstance(devEui);
    const state = createInitialSimulationState(devEui, device.id);
    const applicationId = 'my-custom-app-id';
    
    const result = generateDevicePayload(device, state, testContext);
    const envelope = buildLibraryEnvelope(
      deviceInstance,
      testGateway,
      result.fields,
      device,
      state,
      applicationId
    );

    expect(envelope.end_device_ids.application_ids.application_id).toBe(applicationId);
  });
});
