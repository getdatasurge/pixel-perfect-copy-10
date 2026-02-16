/**
 * FreshTrack Pro Export Service
 *
 * Business logic for exporting emulator state to FreshTrack Pro.
 * Supports two modes:
 *   - Direct: fetch() to FreshTrack endpoints using client-side API keys
 *   - Proxy: supabase.functions.invoke() through edge function proxies
 */

import { supabase } from '@/integrations/supabase/client';
import { GatewayConfig, LoRaWANDevice, WebhookConfig } from './ttn-payload';
import { SensorState } from './emulatorSensorState';
import { getDevice } from './deviceLibrary';
import { getEffectiveConfig, isDirectModeAvailable } from './freshtrackConnectionStore';
import type { FreshTrackOrgState } from './freshtrackOrgStateStore';

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
}

export interface ConnectionTestResult {
  ok: boolean;
  orgName?: string;
  syncVersion?: number;
  error?: string;
  hint?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  version?: string;
  timestamp?: string;
  error?: string;
}

export interface PullOrgStateResult {
  ok: boolean;
  orgState?: FreshTrackOrgState;
  error?: string;
  hint?: string;
}

// ============================================
// Direct Fetch Helper
// ============================================

async function directFetch(
  endpoint: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const config = getEffectiveConfig();
  if (!config.freshtrackUrl) {
    return { data: null, error: new Error('FreshTrack URL not configured') };
  }

  const url = `${config.freshtrackUrl}/functions/v1/${endpoint}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw_response: text.slice(0, 2048) };
    }

    if (!response.ok && !data.success) {
      data._http_status = response.status;
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error('Network error') };
  }
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
  orgIdOverride?: string,
): Promise<ExportSyncResult> {
  const orgId = orgIdOverride || webhookConfig.testOrgId;
  if (!orgId) {
    return { success: false, error: 'No organization selected. Set Org ID in Export Settings or Testing tab.' };
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

  const payload = {
    org_id: orgId,
    sync_id: `emu-export-${Date.now()}`,
    synced_at: new Date().toISOString(),
    gateways: gatewayPayload,
    devices: devicePayload,
    sensors: sensorPayload,
  };

  try {
    let data: Record<string, unknown> | null;
    let fetchError: Error | null;

    if (isDirectModeAvailable()) {
      const cfg = getEffectiveConfig();
      ({ data, error: fetchError } = await directFetch('emulator-sync', 'POST', {
        'Authorization': `Bearer ${cfg.emulatorSyncApiKey}`,
        'X-Emulator-Sync-Key': cfg.emulatorSyncApiKey,
      }, payload));
    } else {
      const result = await supabase.functions.invoke('export-sync', { body: payload });
      data = result.data;
      fetchError = result.error;
    }

    if (fetchError) {
      return { success: false, error: fetchError.message, error_code: 'INVOKE_ERROR' };
    }

    // Handle validation errors (400)
    if (data?.error && data?.details) {
      return {
        success: false,
        error: data.error as string,
        error_code: (data.error_code as string) || 'VALIDATION_ERROR',
        details: data.details as Array<{ path: string; message: string }>,
      };
    }

    return {
      success: (data?.success as boolean) ?? false,
      sync_run_id: data?.sync_run_id as string | undefined,
      counts: data?.counts as ExportSyncResult['counts'],
      warnings: (data?.warnings as string[]) || [],
      errors: (data?.errors as string[]) || [],
      error: data?.success ? undefined : ((data?.error as string) || 'Unknown error'),
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
  orgIdOverride?: string,
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
    let data: Record<string, unknown> | null;
    let fetchError: Error | null;

    if (isDirectModeAvailable()) {
      const cfg = getEffectiveConfig();
      ({ data, error: fetchError } = await directFetch('ingest-readings', 'POST', {
        'X-Device-API-Key': cfg.deviceIngestApiKey,
      }, { readings }));
    } else {
      const result = await supabase.functions.invoke('export-readings', { body: { readings } });
      data = result.data;
      fetchError = result.error;
    }

    if (fetchError) {
      return { success: false, error: fetchError.message, error_code: 'INVOKE_ERROR', ingested: 0, failed: readings.length };
    }

    return {
      success: (data?.success as boolean) ?? false,
      ingested: (data?.ingested as number) ?? 0,
      failed: (data?.failed as number) ?? 0,
      results: data?.results as ExportReadingsResult['results'],
      error: data?.success ? undefined : ((data?.error as string) || 'Unknown error'),
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
    let data: Record<string, unknown> | null;
    let fetchError: Error | null;

    if (isDirectModeAvailable()) {
      const cfg = getEffectiveConfig();
      ({ data, error: fetchError } = await directFetch(
        `org-state-api?org_id=${encodeURIComponent(orgId)}`,
        'GET',
        { 'Authorization': `Bearer ${cfg.orgStateSyncApiKey}` },
      ));
    } else {
      const result = await supabase.functions.invoke('fetch-org-state', {
        body: { org_id: orgId },
      });
      data = result.data;
      fetchError = result.error;
    }

    if (fetchError) {
      return { ok: false, error: fetchError.message, hint: 'Failed to reach FreshTrack.' };
    }

    if (data?.ok === false) {
      return {
        ok: false,
        error: (data.error as string) || 'FreshTrack returned failure',
        hint: (data.hint as string) || 'Check API keys and org ID.',
      };
    }

    return {
      ok: true,
      orgName: (data?.organization_name || data?.org_name || `Org ${orgId.slice(0, 8)}...`) as string,
      syncVersion: data?.sync_version as number | undefined,
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
// Health Check (direct mode only, no auth)
// ============================================

export async function testFreshTrackHealth(): Promise<HealthCheckResult> {
  const cfg = getEffectiveConfig();
  if (!cfg.freshtrackUrl) {
    return { ok: false, error: 'FreshTrack URL not configured.' };
  }

  try {
    const url = `${cfg.freshtrackUrl}/functions/v1/org-state-api?action=health`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const text = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `Unexpected response: ${text.slice(0, 200)}` };
    }

    if (data.ok) {
      return {
        ok: true,
        version: data.version as string | undefined,
        timestamp: data.timestamp as string | undefined,
      };
    }

    return { ok: false, error: (data.error as string) || 'Health check failed' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// ============================================
// Pull Org State
// ============================================

export async function pullFreshTrackOrgState(
  orgId: string,
): Promise<PullOrgStateResult> {
  try {
    let data: Record<string, unknown> | null;
    let fetchError: Error | null;

    if (isDirectModeAvailable()) {
      const cfg = getEffectiveConfig();
      ({ data, error: fetchError } = await directFetch(
        `org-state-api?org_id=${encodeURIComponent(orgId)}`,
        'GET',
        { 'Authorization': `Bearer ${cfg.orgStateSyncApiKey}` },
      ));
    } else {
      const result = await supabase.functions.invoke('fetch-org-state', {
        body: { org_id: orgId },
      });
      data = result.data;
      fetchError = result.error;
    }

    if (fetchError) {
      return { ok: false, error: fetchError.message, hint: 'Failed to reach FreshTrack.' };
    }

    if (!data || data.ok === false) {
      return {
        ok: false,
        error: (data?.error as string) || 'FreshTrack returned failure',
        hint: (data?.hint as string) || 'Check API keys and org ID.',
      };
    }

    const orgState: FreshTrackOrgState = {
      pulledAt: new Date().toISOString(),
      orgId,
      syncVersion: (data.sync_version as number) || 0,
      updatedAt: data.updated_at as string | undefined,
      sites: (data.sites as FreshTrackOrgState['sites']) || [],
      areas: (data.areas as FreshTrackOrgState['areas']) || [],
      units: (data.units as FreshTrackOrgState['units']) || [],
      sensors: (data.sensors as FreshTrackOrgState['sensors']) || [],
      gateways: (data.gateways as FreshTrackOrgState['gateways']) || [],
      ttn: (data.ttn as FreshTrackOrgState['ttn']) || null,
    };

    return { ok: true, orgState };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
      hint: 'Check your network connection.',
    };
  }
}
