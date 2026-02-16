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
    temperature_humidity: 'temperature_humidity',
    door: 'door',
    contact: 'door',
    co2: 'air_quality',
    leak: 'leak',
    gps: 'gps',
    meter: 'metering',
    motion: 'motion',
    air_quality: 'air_quality',
    multi_sensor: 'multi_sensor',
  };
  return map[category] || 'temperature';
}

// ============================================
// Battery Voltage Estimation
// ============================================

/**
 * Estimate battery voltage from percentage using piecewise Li-SOCl2 chemistry curve.
 * Reference points: 100%→3.6V, 80%→3.2V, 50%→2.8V, 20%→2.4V, 5%→2.0V, 0%→1.8V
 */
function estimateBatteryVoltage(batteryPct: number): number {
  const pct = Math.max(0, Math.min(100, batteryPct));
  // Piecewise linear interpolation between reference points
  const points: [number, number][] = [
    [0, 1.8], [5, 2.0], [20, 2.4], [50, 2.8], [80, 3.2], [100, 3.6],
  ];
  // Find the two surrounding points
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, v0] = points[i];
    const [p1, v1] = points[i + 1];
    if (pct >= p0 && pct <= p1) {
      const t = (pct - p0) / (p1 - p0);
      const voltage = v0 + t * (v1 - v0);
      return Math.round(voltage * 100) / 100;
    }
  }
  return 3.6; // fallback
}

// ============================================
// Sensor Status Calculation
// ============================================

/**
 * Calculate sensor status from emulator state.
 * Priority chain: fault(0) → pending(1) → joining(2) → inactive(3) → active(4)
 */
function calculateSensorStatus(state: SensorState): 'active' | 'inactive' | 'fault' | 'pending' | 'joining' {
  if (state.batteryPct <= 5) return 'fault';
  if (!state.isOnline) return 'inactive';
  if (!state.lastSentAt) return 'joining';
  return 'active';
}

/**
 * Calculate gateway status.
 */
function calculateGatewayStatus(gw: GatewayConfig): 'online' | 'offline' | 'pending' | 'maintenance' {
  if (gw.provisioningStatus === 'pending') return 'pending';
  if (gw.provisioningStatus === 'failed') return 'maintenance';
  return gw.isOnline ? 'online' : 'offline';
}

// ============================================
// Decoded Payload Builder (library-aware)
// ============================================

/**
 * Build decoded_payload using the device library's field definitions.
 * Maps emulator state values to canonical field names from the library,
 * and generates realistic simulated values for fields not in emulator state.
 */
function buildDecodedPayload(
  state: SensorState,
  devType: 'temperature' | 'door',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  // Try library-aware path
  if (state.libraryDeviceId) {
    const libDevice = getDevice(state.libraryDeviceId);
    if (libDevice) {
      const fields = libDevice.simulation_profile.fields;
      for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        payload[fieldName] = resolveFieldValue(fieldName, fieldConfig, state, libDevice.examples?.normal);
      }
      return payload;
    }
  }

  // Legacy fallback: map from emulator state based on device type
  const tempC = Math.round(((state.tempF - 32) * 5 / 9) * 10) / 10;

  if (devType === 'temperature') {
    payload.temperature = tempC;
    payload.humidity = Math.round(state.humidity);
    payload.battery_level = Math.round(state.batteryPct);
    payload.battery_voltage = estimateBatteryVoltage(state.batteryPct);
  } else {
    payload.door_status = state.doorOpen ? 'open' : 'closed';
    payload.door_open = state.doorOpen;
    payload.battery_level = Math.round(state.batteryPct);
    payload.battery_voltage = estimateBatteryVoltage(state.batteryPct);
  }

  return payload;
}

/**
 * Resolve a single field value from emulator state or field config.
 */
function resolveFieldValue(
  fieldName: string,
  fieldConfig: { type: string; min?: number; max?: number; precision?: number; values?: string[] },
  state: SensorState,
  normalExample?: Record<string, unknown>,
): unknown {
  // Map well-known canonical field names to emulator state
  // Includes Dragino-specific aliases (TempC_SHT, TempC_DS, Hum_SHT, BatV, DOOR_OPEN_STATUS)
  switch (fieldName) {
    case 'temperature':
    case 'ext_temperature':
    case 'soil_temperature':
    case 'TempC_SHT':
    case 'TempC_DS':
      return Math.round(((state.tempF - 32) * 5 / 9) * 10) / 10;
    case 'humidity':
    case 'Hum_SHT':
      return Math.round(state.humidity);
    case 'battery_level':
      return Math.round(state.batteryPct);
    case 'battery_voltage':
    case 'BatV':
      return estimateBatteryVoltage(state.batteryPct);
    case 'door_status':
    case 'DOOR_OPEN_STATUS':
      return state.doorOpen ? 'open' : 'closed';
    case 'door_open':
    case 'door':
    case 'contact':
      return state.doorOpen;
    case 'water_leak':
    case 'sensor_flag':
      return false;
    case 'motion_detected':
      return false;
    case 'gps_fix':
      return true;
    case 'signal_strength':
    case 'rssi':
      return Math.round(state.signalStrength);
    default:
      break;
  }

  // Use normal example value if available
  if (normalExample && fieldName in normalExample) {
    return normalExample[fieldName];
  }

  // Generate from field config
  if (fieldConfig.type === 'float' && fieldConfig.min != null && fieldConfig.max != null) {
    const mid = (fieldConfig.min + fieldConfig.max) / 2;
    const precision = fieldConfig.precision ?? 1;
    return parseFloat(mid.toFixed(precision));
  }
  if (fieldConfig.type === 'int' && fieldConfig.min != null && fieldConfig.max != null) {
    return Math.round((fieldConfig.min + fieldConfig.max) / 2);
  }
  if (fieldConfig.type === 'bool') {
    return false;
  }
  if (fieldConfig.type === 'enum' && fieldConfig.values && fieldConfig.values.length > 0) {
    return fieldConfig.values[0];
  }

  return null;
}

// ============================================
// Pre-Send Validation
// ============================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Validate the sync payload before sending to FreshTrack.
 * Returns an array of issues; empty = valid.
 */
function validateSyncPayload(payload: {
  org_id: string;
  gateways: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  sensors: Array<Record<string, unknown>>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!UUID_RE.test(payload.org_id)) {
    issues.push({ field: 'org_id', message: `org_id must be UUID format, got "${payload.org_id}"` });
  }

  for (let i = 0; i < payload.gateways.length; i++) {
    const gw = payload.gateways[i];
    const eui = gw.gateway_eui as string || '';
    if (eui.length < 1 || eui.length > 32) {
      issues.push({ field: `gateways[${i}].gateway_eui`, message: `gateway_eui must be 1-32 chars, got ${eui.length}` });
    }
  }

  for (let i = 0; i < payload.devices.length; i++) {
    const dev = payload.devices[i];
    const serial = dev.serial_number as string || '';
    if (serial.length < 1 || serial.length > 100) {
      issues.push({ field: `devices[${i}].serial_number`, message: `serial_number must be 1-100 chars, got ${serial.length}` });
    }
    const devEui = dev.dev_eui as string || '';
    if (devEui.length < 1 || devEui.length > 32) {
      issues.push({ field: `devices[${i}].dev_eui`, message: `dev_eui must be 1-32 chars, got ${devEui.length}` });
    }
    const name = dev.name as string || '';
    if (name.length < 1 || name.length > 100) {
      issues.push({ field: `devices[${i}].name`, message: `name must be 1-100 chars, got ${name.length}` });
    }
  }

  for (let i = 0; i < payload.sensors.length; i++) {
    const s = payload.sensors[i];
    const devEui = s.dev_eui as string || '';
    if (devEui.length < 1 || devEui.length > 32) {
      issues.push({ field: `sensors[${i}].dev_eui`, message: `dev_eui must be 1-32 chars, got ${devEui.length}` });
    }
    const name = s.name as string || '';
    if (name.length < 1 || name.length > 100) {
      issues.push({ field: `sensors[${i}].name`, message: `name must be 1-100 chars, got ${name.length}` });
    }
  }

  return issues;
}

/**
 * Validate readings before sending to FreshTrack.
 * Returns an array of issues; empty = valid.
 */
function validateReadings(readings: Array<Record<string, unknown>>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const unitId = r.unit_id as string || '';
    if (!UUID_RE.test(unitId)) {
      issues.push({ field: `readings[${i}].unit_id`, message: `unit_id must be UUID format` });
    }
    const temp = r.temperature as number | undefined;
    if (temp != null && (temp < -100 || temp > 300)) {
      issues.push({ field: `readings[${i}].temperature`, message: `temperature ${temp} out of range [-100, 300]` });
    }
    const hum = r.humidity as number | undefined;
    if (hum != null && (hum < 0 || hum > 100)) {
      issues.push({ field: `readings[${i}].humidity`, message: `humidity ${hum} out of range [0, 100]` });
    }
    const bat = r.battery_level as number | undefined;
    if (bat != null && (bat < 0 || bat > 100)) {
      issues.push({ field: `readings[${i}].battery_level`, message: `battery_level ${bat} out of range [0, 100]` });
    }
    const batV = r.battery_voltage as number | undefined;
    if (batV != null && (batV < 0 || batV > 10)) {
      issues.push({ field: `readings[${i}].battery_voltage`, message: `battery_voltage ${batV} out of range [0, 10]` });
    }
    const sig = r.signal_strength as number | undefined;
    if (sig != null && (sig < -150 || sig > 0)) {
      issues.push({ field: `readings[${i}].signal_strength`, message: `signal_strength ${sig} out of range [-150, 0]` });
    }
  }

  return issues;
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
    status: calculateGatewayStatus(gw),
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

    // Build decoded_payload using library-aware builder
    const decodedPayload = state
      ? buildDecodedPayload(state, dev.type)
      : {};

    return {
      serial_number: dev.devEui,
      unit_id: dev.unitId || null,
      status: state ? calculateSensorStatus(state) : 'active',
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
      status: state ? calculateSensorStatus(state) : 'active',
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

  // Pre-send validation
  const validationIssues = validateSyncPayload(payload);
  if (validationIssues.length > 0) {
    return {
      success: false,
      error: `Validation failed: ${validationIssues[0].message}`,
      error_code: 'CLIENT_VALIDATION',
      details: validationIssues.map(v => ({ path: v.field, message: v.message })),
    };
  }

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

    // Handle 401/403 authentication errors
    const httpStatus = data?._http_status as number | undefined;
    if (httpStatus === 401 || httpStatus === 403) {
      return { success: false, error: `Authentication failed (${httpStatus}). Check your API keys.`, error_code: 'AUTH_ERROR' };
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

    // Handle 207 partial success: body has both counts AND non-empty errors[]
    const responseErrors = (data?.errors as string[]) || [];
    const isPartial = httpStatus === 207 || (data?.success && responseErrors.length > 0);
    const isSuccess = (data?.success as boolean) ?? false;

    return {
      success: isSuccess || !!isPartial,
      sync_run_id: data?.sync_run_id as string | undefined,
      counts: data?.counts as ExportSyncResult['counts'],
      warnings: (data?.warnings as string[]) || [],
      errors: responseErrors,
      error: isPartial
        ? `Partial sync (207): ${responseErrors.length} error(s)`
        : (isSuccess ? undefined : ((data?.error as string) || 'Unknown error')),
      error_code: isPartial ? 'PARTIAL_SUCCESS' : undefined,
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

      // Core reading fields
      const reading: Record<string, unknown> = {
        unit_id: dev.unitId,
        temperature: state.tempF,
        temperature_unit: 'F',
        source: 'simulator',
        device_serial: dev.devEui,
        device_model: modelInfo.model,
        recorded_at: new Date().toISOString(),
      };

      // Type-specific fields
      if (state.type === 'temperature' || dev.type === 'temperature') {
        reading.humidity = Math.round(state.humidity);
      }
      if (state.type === 'door' || dev.type === 'door') {
        reading.door_open = state.doorOpen;
      }

      // Library-aware: include decoded_payload fields
      const decodedPayload = buildDecodedPayload(state, dev.type);
      reading.decoded_payload = decodedPayload;

      // Battery & signal
      reading.battery_level = Math.round(state.batteryPct);
      reading.battery_voltage = estimateBatteryVoltage(state.batteryPct);
      reading.signal_strength = Math.round(state.signalStrength);

      // Source metadata
      reading.source_metadata = {
        emulator_version: '2.0.0',
        library_device_id: state.libraryDeviceId || null,
        device_model: modelInfo.model,
        manufacturer: modelInfo.manufacturer,
        sensor_type: modelInfo.sensorType,
        emission_mode: 'simulated',
      };

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

  const allReadings = readings as Array<Record<string, unknown>>;

  // Pre-send validation
  const validationIssues = validateReadings(allReadings);
  if (validationIssues.length > 0) {
    console.warn('[FreshTrackExport] Reading validation warnings:', validationIssues);
    // Log but don't block — server will enforce hard limits
  }

  // Batch into chunks of 100
  const BATCH_SIZE = 100;
  const batches: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < allReadings.length; i += BATCH_SIZE) {
    batches.push(allReadings.slice(i, i + BATCH_SIZE));
  }

  let totalIngested = 0;
  let totalFailed = 0;
  const allResults: Array<{ unit_id: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      let data: Record<string, unknown> | null;
      let fetchError: Error | null;

      if (isDirectModeAvailable()) {
        const cfg = getEffectiveConfig();
        ({ data, error: fetchError } = await directFetch('ingest-readings', 'POST', {
          'X-Device-API-Key': cfg.deviceIngestApiKey,
        }, { readings: batch }));
      } else {
        const result = await supabase.functions.invoke('export-readings', { body: { readings: batch } });
        data = result.data;
        fetchError = result.error;
      }

      if (fetchError) {
        const httpStatus = (fetchError as Record<string, unknown>)?._http_status;
        if (httpStatus === 401 || httpStatus === 403) {
          return { success: false, error: `Authentication failed (${httpStatus}). Check your API keys.`, error_code: 'AUTH_ERROR', ingested: totalIngested, failed: totalFailed + batch.length, sentReadings: allReadings };
        }
        errors.push(fetchError.message);
        totalFailed += batch.length;
        continue;
      }

      // Handle 401/403 from directFetch
      const httpStatus = data?._http_status as number | undefined;
      if (httpStatus === 401 || httpStatus === 403) {
        return { success: false, error: `Authentication failed (${httpStatus}). Check your API keys.`, error_code: 'AUTH_ERROR', ingested: totalIngested, failed: totalFailed + batch.length, sentReadings: allReadings };
      }

      totalIngested += (data?.ingested as number) ?? 0;
      totalFailed += (data?.failed as number) ?? 0;
      if (data?.results) {
        allResults.push(...(data.results as Array<{ unit_id: string; success: boolean; error?: string }>));
      }
      if (!data?.success) {
        errors.push((data?.error as string) || 'Batch failed');
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Network error');
      totalFailed += batch.length;
    }
  }

  const hasErrors = errors.length > 0;
  return {
    success: totalIngested > 0 || !hasErrors,
    ingested: totalIngested,
    failed: totalFailed,
    results: allResults.length > 0 ? allResults : undefined,
    error: hasErrors ? errors.join('; ') : undefined,
    error_code: hasErrors && totalIngested === 0 ? 'BATCH_FAILED' : undefined,
    sentReadings: allReadings,
  };
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

    // Handle 401/403
    const httpStatus = data?._http_status as number | undefined;
    if (httpStatus === 401 || httpStatus === 403) {
      return { ok: false, error: `Authentication failed (${httpStatus}).`, hint: 'Check your Org State Sync API key.' };
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

/**
 * Legacy alias for pullFreshTrackOrgState — used by ExportPanel.
 * Returns OrgStateResult shape for backward compatibility.
 */
export async function pullOrgState(orgId: string): Promise<OrgStateResult> {
  const result = await pullFreshTrackOrgState(orgId);
  if (!result.ok || !result.orgState) {
    return { ok: false, error: result.error };
  }
  const s = result.orgState;
  return {
    ok: true,
    sites: s.sites,
    areas: s.areas,
    units: s.units.map(u => ({ id: u.id, name: u.name, unit_type: u.unit_type || '', site_id: u.site_id, area_id: u.area_id || '', status: u.status || 'active' })),
    sensors: s.sensors.map(se => ({ id: se.id, name: se.name, dev_eui: se.dev_eui, sensor_type: se.sensor_type, unit_id: se.unit_id || null })),
    gateways: s.gateways.map(g => ({ id: g.id, name: g.name, gateway_eui: g.gateway_eui, status: g.status })),
    syncVersion: s.syncVersion,
  };
}
