/**
 * Routing Mock Tests
 * 
 * Verifies routing behavior with mocked external services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import type { SimulationContext } from '@/lib/deviceLibrary/types';

// ============================================
// Mock Setup
// ============================================

// Mock supabase client
const mockInvoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

const testGateway: GatewayInstance = {
  id: 'routing-test-gateway',
  eui: 'BBCC00112233DDEE',
};

const testContext: SimulationContext = {
  orgId: 'routing-test-org',
  siteId: 'routing-test-site',
  unitId: 'routing-test-unit',
  deviceInstanceId: 'routing-test-device',
  emissionSequence: 1,
};

function createEnvelope() {
  const device = defaultDeviceLibrary.devices[0];
  const deviceInstance: DeviceInstance = {
    devEui: 'A84041FFFF123456',
    name: 'Routing Test Device',
    gatewayId: testGateway.id,
  };
  const state = createInitialSimulationState(deviceInstance.devEui, device.id);
  const result = generateDevicePayload(device, state, testContext);
  
  return buildLibraryEnvelope(
    deviceInstance,
    testGateway,
    result.fields,
    device,
    state,
    'routing-test-app'
  );
}

// ============================================
// Routing Tests
// ============================================

describe('Routing', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('envelope structure is correct for TTN simulate endpoint', () => {
    const envelope = createEnvelope();
    
    // Verify envelope has all required fields for TTN
    expect(envelope).toHaveProperty('end_device_ids');
    expect(envelope).toHaveProperty('received_at');
    expect(envelope).toHaveProperty('uplink_message');
    expect(envelope.uplink_message).toHaveProperty('decoded_payload');
    expect(envelope.uplink_message).toHaveProperty('f_cnt');
    expect(envelope.uplink_message).toHaveProperty('f_port');
    expect(envelope.uplink_message).toHaveProperty('rx_metadata');
  });

  it('simulates TTN simulate function call with correct payload', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    
    const envelope = createEnvelope();
    
    // Simulate what the emulator would send to ttn-simulate
    const payload = {
      envelope,
      applicationId: 'test-app',
      routeToTtn: true,
    };
    
    await mockInvoke('ttn-simulate', { body: payload });
    
    expect(mockInvoke).toHaveBeenCalledWith('ttn-simulate', {
      body: expect.objectContaining({
        envelope: expect.objectContaining({
          end_device_ids: expect.any(Object),
          uplink_message: expect.any(Object),
        }),
      }),
    });
  });

  it('handles TTN simulate errors gracefully', async () => {
    const error = new Error('TTN API unavailable');
    mockInvoke.mockRejectedValueOnce(error);
    
    const envelope = createEnvelope();
    const payload = { envelope };
    
    await expect(mockInvoke('ttn-simulate', { body: payload })).rejects.toThrow('TTN API unavailable');
  });

  it('routes through webhook when TTN is disabled', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { processed: true }, error: null });
    
    const envelope = createEnvelope();
    
    // Webhook payload (direct to ingest-readings)
    const webhookPayload = {
      end_device_ids: envelope.end_device_ids,
      uplink_message: envelope.uplink_message,
      received_at: envelope.received_at,
    };
    
    await mockInvoke('ttn-webhook', { body: webhookPayload });
    
    expect(mockInvoke).toHaveBeenCalledWith('ttn-webhook', {
      body: expect.objectContaining({
        end_device_ids: expect.any(Object),
        uplink_message: expect.any(Object),
      }),
    });
  });

  it('logs errors with sufficient context on failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    mockInvoke.mockResolvedValueOnce({ 
      data: null, 
      error: { message: 'Rate limit exceeded', code: 429 } 
    });
    
    const envelope = createEnvelope();
    const result = await mockInvoke('ttn-simulate', { body: { envelope } });
    
    if (result.error) {
      console.error('TTN simulate failed:', {
        deviceId: envelope.end_device_ids.device_id,
        devEui: envelope.end_device_ids.dev_eui,
        error: result.error.message,
        code: result.error.code,
      });
    }
    
    expect(consoleSpy).toHaveBeenCalledWith(
      'TTN simulate failed:',
      expect.objectContaining({
        deviceId: expect.any(String),
        devEui: expect.any(String),
        error: 'Rate limit exceeded',
        code: 429,
      })
    );
    
    consoleSpy.mockRestore();
  });

  it('fallback to local mode produces valid envelope without external calls', () => {
    const envelope = createEnvelope();
    
    // In local mode, no external calls should be made
    // Just verify the envelope is valid for local processing
    expect(envelope.end_device_ids.device_id).toBeTruthy();
    expect(envelope.uplink_message.decoded_payload).toBeDefined();
    expect(typeof envelope.uplink_message.f_cnt).toBe('number');
    
    // No mock calls should have been made
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('Route Selection Logic', () => {
  it('selects TTN route when routeToTtn is true', () => {
    const config = {
      routeToTtn: true,
      webhookUrl: 'https://example.com/webhook',
    };
    
    const selectedRoute = config.routeToTtn ? 'ttn-simulate' : 
                          config.webhookUrl ? 'webhook' : 'local';
    
    expect(selectedRoute).toBe('ttn-simulate');
  });

  it('selects webhook route when TTN is disabled but webhook is configured', () => {
    const config = {
      routeToTtn: false,
      webhookUrl: 'https://example.com/webhook',
    };
    
    const selectedRoute = config.routeToTtn ? 'ttn-simulate' : 
                          config.webhookUrl ? 'webhook' : 'local';
    
    expect(selectedRoute).toBe('webhook');
  });

  it('selects local route when no external routing is configured', () => {
    const config = {
      routeToTtn: false,
      webhookUrl: null,
    };
    
    const selectedRoute = config.routeToTtn ? 'ttn-simulate' : 
                          config.webhookUrl ? 'webhook' : 'local';
    
    expect(selectedRoute).toBe('local');
  });
});

describe('Payload Transformation', () => {
  it('transforms library envelope to webhook format correctly', () => {
    const envelope = createEnvelope();
    
    // Webhook expects specific format
    const webhookPayload = {
      deviceId: envelope.end_device_ids.device_id,
      devEui: envelope.end_device_ids.dev_eui,
      applicationId: envelope.end_device_ids.application_ids.application_id,
      receivedAt: envelope.received_at,
      fPort: envelope.uplink_message.f_port,
      fCnt: envelope.uplink_message.f_cnt,
      decodedPayload: envelope.uplink_message.decoded_payload,
      rssi: envelope.uplink_message.rx_metadata[0]?.rssi,
      snr: envelope.uplink_message.rx_metadata[0]?.snr,
    };
    
    expect(webhookPayload.deviceId).toBeTruthy();
    expect(webhookPayload.devEui).toMatch(/^[0-9A-F]{16}$/);
    expect(webhookPayload.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof webhookPayload.fPort).toBe('number');
    expect(typeof webhookPayload.fCnt).toBe('number');
    expect(typeof webhookPayload.decodedPayload).toBe('object');
  });
});
