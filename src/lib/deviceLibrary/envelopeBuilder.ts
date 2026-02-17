/**
 * TTN V3 Envelope Builder
 * 
 * Wraps decoded payloads in proper TTN v3 envelopes with correct
 * f_port, f_cnt, and rx_metadata based on device library configuration.
 */

import { DeviceDefinition, DeviceSimulationState } from './types';
import { encodePayload, generateDeviceId, LoRaWANDevice, GatewayConfig } from '../ttn-payload';
import { debug } from '../debugLogger';

// ============================================
// Types
// ============================================

/**
 * RxMetadata for TTN uplink
 */
export interface RxMetadata {
  gateway_ids: {
    gateway_id: string;
    eui: string;
  };
  rssi: number;
  snr: number;
  timestamp?: number;
}

/**
 * TTN V3 Uplink Envelope
 */
export interface TTNEnvelope {
  end_device_ids: {
    device_id: string;
    dev_eui: string;
    application_ids: {
      application_id: string;
    };
  };
  received_at: string;
  uplink_message: {
    f_port: number;
    f_cnt: number;
    decoded_payload: Record<string, unknown>;
    frm_payload: string;
    rx_metadata: RxMetadata[];
  };
}

/**
 * Device instance for envelope building
 */
export interface DeviceInstance {
  devEui: string;
  name: string;
  gatewayId: string;
}

/**
 * Gateway config for envelope building
 */
export interface GatewayInstance {
  id: string;
  eui: string;
}

/**
 * Signal override options for scenarios
 */
export interface SignalOverrides {
  rssi?: number;
  snr?: number;
}

/**
 * Envelope building options
 */
export interface EnvelopeOptions {
  signalOverrides?: SignalOverrides;
  serverTimestamp?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate realistic RSSI value
 * Range: -120 dBm (weak) to -30 dBm (strong)
 * Typical indoor: -60 to -80 dBm
 */
function generateRealisticRssi(baseRssi: number = -65): number {
  // Add random variance of ±5 dBm
  const variance = (Math.random() - 0.5) * 10;
  return Math.round(Math.max(-120, Math.min(-30, baseRssi + variance)));
}

/**
 * Generate realistic SNR value
 * Range: -20 dB (poor) to +15 dB (excellent)
 * Typical good signal: 5 to 10 dB
 */
function generateRealisticSnr(baseSnr: number = 7.5): number {
  // Add random variance of ±2 dB
  const variance = (Math.random() - 0.5) * 4;
  return Math.round((baseSnr + variance) * 10) / 10;
}

/**
 * Normalize DevEUI to lowercase without separators
 */
function normalizeDevEui(devEui: string): string {
  return devEui.replace(/[:\s-]/g, '').toLowerCase();
}

// ============================================
// Main Functions
// ============================================

/**
 * Generate rx_metadata array for TTN envelope
 */
export function generateRxMetadata(
  gateway: GatewayInstance,
  options?: {
    rssi?: number;
    snr?: number;
    timestamp?: number;
  }
): RxMetadata[] {
  const rssi = options?.rssi ?? generateRealisticRssi();
  const snr = options?.snr ?? generateRealisticSnr();
  const timestamp = options?.timestamp ?? Date.now();

  return [{
    gateway_ids: {
      gateway_id: gateway.id,
      eui: gateway.eui.toUpperCase(),
    },
    rssi,
    snr,
    timestamp,
  }];
}

/**
 * Build a complete TTN v3 envelope for a device library payload
 * 
 * Uses the device library configuration for:
 * - f_port from device definition
 * - f_cnt from simulation state
 * - proper end_device_ids structure
 */
export function buildLibraryEnvelope(
  deviceInstance: DeviceInstance,
  gateway: GatewayInstance,
  decodedPayload: Record<string, unknown>,
  libraryDevice: DeviceDefinition,
  simState: DeviceSimulationState,
  applicationId: string,
  options?: EnvelopeOptions
): TTNEnvelope {
  const normalizedDevEui = normalizeDevEui(deviceInstance.devEui);
  const deviceId = `sensor-${normalizedDevEui}`;
  const receivedAt = options?.serverTimestamp || new Date().toISOString();
  const timestamp = options?.serverTimestamp 
    ? new Date(options.serverTimestamp).getTime()
    : Date.now();

  // Get f_port from library device definition
  const fPort = libraryDevice.default_fport;
  
  // Get f_cnt from simulation state
  const fCnt = simState.f_cnt;

  // Build rx_metadata with optional signal overrides
  const rxMetadata = generateRxMetadata(gateway, {
    rssi: options?.signalOverrides?.rssi,
    snr: options?.signalOverrides?.snr,
    timestamp,
  });

  return {
    end_device_ids: {
      device_id: deviceId,
      dev_eui: normalizedDevEui.toUpperCase(),
      application_ids: {
        application_id: applicationId,
      },
    },
    received_at: receivedAt,
    uplink_message: {
      f_port: fPort,
      f_cnt: fCnt,
      decoded_payload: decodedPayload,
      frm_payload: encodePayload(decodedPayload),
      rx_metadata: rxMetadata,
    },
  };
}

/**
 * Build legacy envelope for devices without library assignment
 * Maintains backward compatibility with existing code
 */
export function buildLegacyEnvelope(
  device: LoRaWANDevice,
  gateway: GatewayConfig,
  decodedPayload: Record<string, unknown>,
  applicationId: string,
  fCnt: number,
  serverTimestamp?: string
): TTNEnvelope {
  const normalizedDevEui = normalizeDevEui(device.devEui);
  const deviceId = generateDeviceId(device.devEui);
  const receivedAt = serverTimestamp || new Date().toISOString();
  const timestamp = serverTimestamp 
    ? new Date(serverTimestamp).getTime()
    : Date.now();

  // Default f_port: 2 (Dragino default; overridden by library device when available)
  const fPort = 2;

  // Get signal strength from payload if available
  const signalStrength = typeof decodedPayload.signal_strength === 'number' 
    ? decodedPayload.signal_strength 
    : -65;

  const rxMetadata = generateRxMetadata(
    { id: gateway.id, eui: gateway.eui },
    { rssi: signalStrength, timestamp }
  );

  return {
    end_device_ids: {
      device_id: deviceId,
      dev_eui: normalizedDevEui.toUpperCase(),
      application_ids: {
        application_id: applicationId,
      },
    },
    received_at: receivedAt,
    uplink_message: {
      f_port: fPort,
      f_cnt: fCnt,
      decoded_payload: decodedPayload,
      frm_payload: encodePayload(decodedPayload),
      rx_metadata: rxMetadata,
    },
  };
}

/**
 * Extract envelope metadata for logging
 */
export function getEnvelopeLogData(envelope: TTNEnvelope): Record<string, unknown> {
  return {
    device_id: envelope.end_device_ids.device_id,
    dev_eui: envelope.end_device_ids.dev_eui,
    application_id: envelope.end_device_ids.application_ids.application_id,
    f_port: envelope.uplink_message.f_port,
    f_cnt: envelope.uplink_message.f_cnt,
    received_at: envelope.received_at,
    gateway_id: envelope.uplink_message.rx_metadata[0]?.gateway_ids.gateway_id,
    rssi: envelope.uplink_message.rx_metadata[0]?.rssi,
    snr: envelope.uplink_message.rx_metadata[0]?.snr,
  };
}
