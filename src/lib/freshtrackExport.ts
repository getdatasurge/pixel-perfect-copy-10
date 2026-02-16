/**
 * FreshTrack Pro Export Service
 * 
 * Business logic for exporting emulator state to FreshTrack Pro
 * via proxy edge functions (export-sync, export-readings).
 */

import { supabase } from '@/integrations/supabase/client';
import { GatewayConfig, LoRaWANDevice, WebhookConfig } from './ttn-payload';
import { SensorState } from './emulatorSensorState';
import { getDevice } from './deviceLibrary';

// ============================================
// Types
// ============================================

export interface ExportSyncResult {
  success: boolean;
  sync_run_id?: string;
  counts?: {
    gateways: { created: number; updated: number; skipped: number };
    devices: { created: number; updated: number; skipped: number };
    sensors: { created: number; updated: number; skipped: number };
  };
  warnings?: string[];
  errors?: string[];
  error?: string;
  error_code?: string;
  details?: Array<{ path: string; message: string }>;
}

export interface ExportReadingsResult {
  success: boolean;
  ingested?: number;
  failed?: number;
  results?: Array<{ unit_id: string; success: boolean; error?: string }>;
  error?: string;
  error_code?: string;
  /** The readings payload that was sent, for live feed display */
  sentReadings?: Array<Record<string, unknown>>;
}

export interface OrgStateResult {
  ok: boolean;
  sites?: Array<{ id: string; name: string; is_active: boolean }>;
  areas?: Array<{ id: string; name: string; site_id: string }>;
  units?: Array<{ id: string; name: string; unit_type: string; site_id: string; area_id: string; status: string }>;
  sensors?: Array<{ id: string; name: string; dev_eui: string; sensor_type: string; unit_id: string | null }>;
  gateways?: Array<{ id: string; name: string; gateway_eui: string; status: string }>;
  syncVersion?: number;
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  orgName?: string;
  syncVersion?: number;
  error?: string;
  hint?: string;
}

// ============================================
// Device Model Inference
// ============================================

function getDeviceModelInfo(sensor: SensorState): { model: string; manufacturer: string; sensorType: string } {
  // Try device library first
  if (sensor.libraryDeviceId) {
    const libDevice = getDevice(sensor.libraryDeviceId);
    if (libDevice) {
      return {
        model: libDevice.model || libDevice.name,
        manufacturer: libDevice.manufacturer,
        sensorType: mapCategory(libDevice.category),
      };
    }
  }
  // Defaults
  if (sensor.type === 'door') {
    return { model: 'LDS02', manufacturer: 'Dragino', sensorType: 'door' };
  }
  return { model: 'EM300-TH', manufacturer: 'Milesight', sensorType: 'temperature' };
}

function mapCategory(category: string): string {
  const map: Record<string, string> = {
    temperature: 'temperature',
    door: 'door',
    co2: 'air_quality',
    leak: 'leak',
    gps: 'gps',
    meter: 'metering',
    motion: 'motion',
    air_quality: 'air_quality',
    combo: 'combo',
  };
  return map[category] || 'temperature';
}

// ============================================
// Sync Devices
// ============================================

export async function syncDevicesToFreshTrack(
  devices: LoRaWANDevice[],
  gateways: GatewayConfig[],
  sensorStates: Record<string, SensorState>,
  webhookConfig: WebhookConfig,
): Promise<ExportSyncResult> {
  const orgId = webhookConfig.testOrgId;
  if (!orgId) {
    return { success: false, error: 'No organization selected. Set Org ID in Testing tab.' };
  }

  // Build gateways payload
  const gatewayPayload = gateways.map(gw => ({
    gateway_eui: gw.eui,
    name: gw.name,
    status: gw.isOnline ? 'online' : 'offline',
    site_id: webhookConfig.testSiteId || null,
  }));

  // Build devices payload
  const devicePayload = devices.map(dev => {
    const state = sensorStates[dev.id];
    const modelInfo = state ? getDeviceModelInfo(state) : getDeviceModelInfo({
      sensorId: dev.id, type: dev.type, tempF: 38, minTempF: 35, maxTempF: 40,
      humidity: 45, doorOpen: false, batteryPct: 95, signalStrength: -65,
      intervalSec: 60, lastSentAt: null, isOnline: true,
    });

    // Build a sample decoded_payload for type inference
    const decodedPayload: Record<string, unknown> = {};
    if (state) {
      if (dev.type === 'temperature') {
        decodedPayload.temperature = Math.round(((state.tempF - 32) * 5 / 9) * 10) / 10;
        decodedPayload.humidity = state.humidity;
        decodedPayload.battery_level = state.batteryPct;
      } else {
        decodedPayload.door_status = state.doorOpen ? 'open' : 'closed';
        decodedPayload.battery_level = state.batteryPct;
      }
    }

    return {
      serial_number: dev.devEui,
      unit_id: dev.unitId || null,
      status: 'active' as const,
      dev_eui: dev.devEui,
      sensor_type: modelInfo.sensorType,
      name: dev.name,
      model: modelInfo.model,
      manufacturer: modelInfo.manufacturer,
      decoded_payload: decodedPayload,
    };
  });

  // Build sensors payload (one sensor per device with dev_eui)
  const sensorPayload = devices.map(dev => {
    const state = sensorStates[dev.id];
    const modelInfo = state ? getDeviceModelInfo(state) : getDeviceModelInfo({
      sensorId: dev.id, type: dev.type, tempF: 38, minTempF: 35, maxTempF: 40,
      humidity: 45, doorOpen: false, batteryPct: 95, signalStrength: -65,
      intervalSec: 60, lastSentAt: null, isOnline: true,
    });

    return {
      dev_eui: dev.devEui,
      name: dev.name,
      sensor_type: modelInfo.sensorType,
      status: 'active' as const,
      unit_id: dev.unitId || null,
      site_id: dev.siteId || webhookConfig.testSiteId || null,
      manufacturer: modelInfo.manufacturer,
      model: modelInfo.model,
      app_eui: dev.joinEui || null,
      app_key: dev.appKey || null,
      ttn_device_id: `sensor-${dev.devEui.toLowerCase()}`,
      ttn_application_id: webhookConfig.ttnConfig?.applicationId || null,
    };
  });

  try {
    const { data, error } = await supabase.functions.invoke('export-sync', {
      body: {
        org_id: orgId,
        sync_id: `emu-export-${Date.now()}`,
        synced_at: new Date().toISOString(),
        gateways: gatewayPayload,
        devices: devicePayload,
        sensors: sensorPayload,
      },
    });

    if (error) {
      return { success: false, error: error.message, error_code: 'INVOKE_ERROR' };
    }

    // Handle validation errors (400)
    if (data?.error && data?.details) {
      return {
        success: false,
        error: data.error,
        error_code: data.error_code || 'VALIDATION_ERROR',
        details: data.details,
      };
    }

    return {
      success: data?.success ?? false,
      sync_run_id: data?.sync_run_id,
      counts: data?.counts,
      warnings: data?.warnings || [],
      errors: data?.errors || [],
      error: data?.success ? undefined : (data?.error || 'Unknown error'),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      error_code: 'NETWORK_ERROR',
    };
  }
}

// ============================================
// Send Readings
// ============================================

export async function sendReadingsToFreshTrack(
  devices: LoRaWANDevice[],
  sensorStates: Record<string, SensorState>,
  webhookConfig: WebhookConfig,
): Promise<ExportReadingsResult> {
  // Build readings from all devices that have a unit_id
  const readings = devices
    .filter(dev => dev.unitId)
    .map(dev => {
      const state = sensorStates[dev.id];
      if (!state) return null;

      const modelInfo = getDeviceModelInfo(state);
      const reading: Record<string, unknown> = {
        unit_id: dev.unitId,
        temperature: state.tempF,
        temperature_unit: 'F',
        source: 'simulator',
        device_serial: dev.devEui,
        device_model: modelInfo.model,
        recorded_at: new Date().toISOString(),
        source_metadata: {
          emulator_version: '2.0.0',
          scenario: 'live_emulation',
        },
      };

      if (state.type === 'temperature') {
        reading.humidity = Math.round(state.humidity);
      }
      if (state.type === 'door') {
        reading.door_open = state.doorOpen;
      }
      reading.battery_level = Math.round(state.batteryPct);
      reading.signal_strength = Math.round(state.signalStrength);

      return reading;
    })
    .filter(Boolean);

  if (readings.length === 0) {
    return {
      success: false,
      error: 'No readings to send. Ensure devices have unit_id assignments.',
      ingested: 0,
      failed: 0,
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('export-readings', {
      body: { readings },
    });

    if (error) {
      return { success: false, error: error.message, error_code: 'INVOKE_ERROR', ingested: 0, failed: readings.length };
    }

    return {
      success: data?.success ?? false,
      ingested: data?.ingested ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results,
      error: data?.success ? undefined : (data?.error || 'Unknown error'),
      sentReadings: readings as Array<Record<string, unknown>>,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      error_code: 'NETWORK_ERROR',
      ingested: 0,
      failed: readings.length,
    };
  }
}

// ============================================
// Test Connection
// ============================================

export async function testFreshTrackConnection(
  orgId: string,
): Promise<ConnectionTestResult> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-org-state', {
      body: { org_id: orgId },
    });

    if (error) {
      return { ok: false, error: error.message, hint: 'Failed to reach FreshTrack via fetch-org-state proxy.' };
    }

    if (data?.ok === false) {
      return {
        ok: false,
        error: data.error || 'FreshTrack returned failure',
        hint: data.hint || 'Check API keys and org ID.',
      };
    }

    return {
      ok: true,
      orgName: data?.organization_name || data?.org_name || `Org ${orgId.slice(0, 8)}...`,
      syncVersion: data?.sync_version,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
      hint: 'Check your network connection.',
    };
  }
}

// ============================================
// Pull Org State
// ============================================

export async function pullOrgState(orgId: string): Promise<OrgStateResult> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-org-state', {
      body: { org_id: orgId },
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    if (data?.ok === false) {
      return { ok: false, error: data.error || 'Failed to pull org state' };
    }

    return {
      ok: true,
      sites: data?.sites || [],
      areas: data?.areas || [],
      units: data?.units || [],
      sensors: data?.sensors || [],
      gateways: data?.gateways || [],
      syncVersion: data?.sync_version,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
