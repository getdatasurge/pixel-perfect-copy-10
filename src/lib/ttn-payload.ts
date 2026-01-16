// TTN (The Things Network) Webhook Payload Utilities

export interface TTNUplinkPayload {
  end_device_ids: {
    device_id: string;
    dev_eui: string;
    application_ids: {
      application_id: string;
    };
  };
  received_at: string;
  uplink_message: {
    decoded_payload: Record<string, unknown>;
    rx_metadata: Array<{
      gateway_ids: {
        gateway_id: string;
        eui: string;
      };
      rssi: number;
      snr: number;
      timestamp?: number;
    }>;
    f_port: number;
    f_cnt: number;  // TTN frame counter
    frm_payload: string;
  };
}

export interface GatewayConfig {
  id: string;
  eui: string;
  name: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  isOnline: boolean;
  // Provisioning status fields
  provisioningStatus?: 'not_started' | 'pending' | 'completed' | 'failed';
  lastProvisionedAt?: string;
  lastProvisionError?: string;
  ttnGatewayId?: string;
}

export interface LoRaWANDevice {
  id: string;
  devEui: string;
  joinEui: string;
  appKey: string;
  name: string;
  type: 'temperature' | 'door';
  gatewayId: string;
  // Location assignment
  siteId?: string;
  unitId?: string;
  // Credential source tracking
  credentialSource?: 'frostguard_pull' | 'frostguard_generated' | 'local_generated' | 'manual_override';
  credentialsLockedFromFrostguard?: boolean;
}

export interface TTNConfig {
  enabled: boolean;
  applicationId: string;
  cluster: string; // e.g., 'eu1', 'nam1', 'au1'
  // Masked credentials for display (from synced_users.ttn)
  api_key_last4?: string | null;
  webhook_secret_last4?: string | null;
  lastStatus?: {
    code: number;
    message: string;
    timestamp: Date;
  };
  lastTestAt?: Date | string | null;
  lastTestSuccess?: boolean | null;
  updated_at?: string | null; // For cache invalidation
  // Gateway owner configuration (required for gateway provisioning)
  gateway_owner_type?: 'user' | 'organization';
  gateway_owner_id?: string | null;
}

export interface WebhookConfig {
  enabled: boolean;
  targetUrl: string;
  applicationId: string;
  sendToLocal: boolean;
  // TTN integration config
  ttnConfig?: TTNConfig;
  ttnWebhookSecret?: string | null;
  lastStatus?: {
    code: number;
    message: string;
    timestamp: Date;
  };
  // Multi-tenant test context
  testOrgId?: string;
  testSiteId?: string;
  testUnitId?: string;
  // Unit selection for device assignment
  selectedUnit?: {
    id: string;
    name: string;
    site_id: string;
    description?: string;
    location?: string;
  };
  availableUnits?: Array<{
    id: string;
    name: string;
    site_id: string;
    description?: string;
    location?: string;
    created_at: string;
  }>;
  // User tracking fields
  selectedUserId?: string | null;
  selectedUserDisplayName?: string | null;
  selectedUserSites?: Array<{ site_id: string; site_name: string | null; is_default: boolean }>;
  contextSetAt?: string | null; // ISO string for localStorage compatibility
  // Hydration state (managed by UserSelectionGate)
  isHydrated?: boolean;
  lastSyncAt?: string;
  lastSyncRunId?: string;
  lastSyncSummary?: string;
  // Pull-based sync state from FrostGuard org-state-api
  lastSyncVersion?: number;
  orgName?: string;
}

// Sync bundle for authenticated sync to Project 1
export interface SyncBundle {
  metadata: {
    sync_run_id: string;
    initiated_at: string;
    source_project: string;
  };
  context: {
    org_id: string;
    site_id?: string;
    unit_id_override?: string;
    selected_user_id?: string;
  };
  entities: {
    gateways: Array<{
      id: string;
      name: string;
      eui: string;
      is_online: boolean;
    }>;
    devices: Array<{
      id: string;
      name: string;
      dev_eui: string;
      join_eui: string;
      app_key: string;
      type: 'temperature' | 'door';
      gateway_id: string;
    }>;
  };
}

export interface TestResult {
  id: string;
  timestamp: Date;
  deviceId: string;
  deviceType: 'temperature' | 'door';
  ttnStatus: 'success' | 'failed' | 'skipped';
  webhookStatus: 'success' | 'failed' | 'pending';
  dbStatus: 'inserted' | 'failed' | 'pending';
  orgApplied: boolean;
  uplinkPath?: 'ttn-simulate' | 'local-webhook' | 'external-webhook';
  error?: string;
}

// Sync operation result for entity sync feedback
export interface SyncResult {
  id: string;
  timestamp: Date;
  sync_run_id: string;
  status: 'success' | 'partial' | 'failed';
  method: 'endpoint' | 'direct' | null;
  stages: {
    emulator: 'success';
    api: 'success' | 'failed' | 'skipped';
    database: 'success' | 'failed' | 'pending';
    orgApplied: boolean;
  };
  counts: {
    gatewaysSynced: number;
    gatewaysFailed: number;
    devicesSynced: number;
    devicesFailed: number;
  };
  errors: string[];
  summary: string;
  // Synced entity details (sanitized - no app_key)
  synced_entities?: {
    gateways: Array<{ id: string; name: string; eui: string; is_online: boolean }>;
    devices: Array<{ id: string; name: string; type: string; dev_eui: string; join_eui: string; gateway_id: string }>;
  };
}

// Generate a random 16-character hex string (8 bytes) for EUI
export function generateEUI(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

// Generate a random 32-character hex string (16 bytes) for AppKey
export function generateAppKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

// Normalize DevEUI: strip colons/spaces/dashes, lowercase, validate 16 hex chars
export function normalizeDevEui(devEui: string): string | null {
  const cleaned = devEui.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return null; // Invalid format
  }
  return cleaned;
}

// Normalize Gateway EUI (alias for normalizeDevEui - same format)
export function normalizeGatewayEui(eui: string): string | null {
  return normalizeDevEui(eui);
}

// Validate Gateway EUI format and return detailed error
export function validateGatewayEui(eui: string): { valid: boolean; error?: string; normalized?: string } {
  if (!eui || eui.trim().length === 0) {
    return { valid: false, error: 'Gateway EUI is required' };
  }
  
  const cleaned = eui.replace(/[:\s-]/g, '').toLowerCase();
  
  if (cleaned.length !== 16) {
    return { 
      valid: false, 
      error: `Gateway EUI must be 16 hex characters (8 bytes). Got ${cleaned.length} characters.` 
    };
  }
  
  if (!/^[a-f0-9]{16}$/.test(cleaned)) {
    return { 
      valid: false, 
      error: 'Gateway EUI contains invalid characters. Must be hexadecimal (0-9, A-F).' 
    };
  }
  
  return { valid: true, normalized: cleaned };
}

// Generate canonical TTN device_id from DevEUI
// Format: sensor-{normalized_deveui}
// Example: DevEUI "0F8FE95CABA665D4" -> "sensor-0f8fe95caba665d4"
export function generateTTNDeviceId(devEui: string): string {
  const normalized = normalizeDevEui(devEui);
  if (!normalized) {
    throw new Error(`Invalid DevEUI format: ${devEui}. Must be 16 hex characters.`);
  }
  return `sensor-${normalized}`;
}

// Generate canonical TTN gateway_id from Gateway EUI
// Format: emu-gw-{normalized_eui}
// Example: EUI "0F8FE95CABA665D4" -> "emu-gw-0f8fe95caba665d4"
export function generateTTNGatewayId(eui: string): string {
  const normalized = normalizeGatewayEui(eui);
  if (!normalized) {
    throw new Error(`Invalid Gateway EUI format: ${eui}. Must be 16 hex characters.`);
  }
  return `emu-gw-${normalized}`;
}

// Generate device ID from DevEUI (legacy - now defaults to 'sensor' prefix)
export function generateDeviceId(devEui: string, prefix: string = 'sensor'): string {
  const normalized = devEui.replace(/[:\s-]/g, '').toLowerCase();
  return `${prefix}-${normalized}`;
}

// Encode payload data to base64 (simulating raw LoRaWAN payload)
export function encodePayload(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  return btoa(json);
}

// Build TTN uplink webhook payload
// Optionally accepts a server timestamp for consistent time sync
// f_cnt parameter allows passing frame counter from device library simulation
export function buildTTNPayload(
  device: LoRaWANDevice,
  gateway: GatewayConfig,
  decodedPayload: Record<string, unknown>,
  applicationId: string,
  serverTimestamp?: string,
  f_cnt?: number,
  f_port?: number
): TTNUplinkPayload {
  const signalStrength = decodedPayload.signal_strength as number ?? -65;
  const receivedAt = serverTimestamp || new Date().toISOString();
  const timestampMs = serverTimestamp 
    ? new Date(serverTimestamp).getTime() 
    : Date.now();
  
  // Use provided f_port, or default based on device type
  const port = f_port ?? (device.type === 'temperature' ? 1 : 2);
  
  // Use provided f_cnt or generate a random one for backward compatibility
  const frameCount = f_cnt ?? Math.floor(Math.random() * 65535);
  
  return {
    end_device_ids: {
      device_id: generateDeviceId(device.devEui),
      dev_eui: device.devEui,
      application_ids: {
        application_id: applicationId,
      },
    },
    received_at: receivedAt,
    uplink_message: {
      decoded_payload: decodedPayload,
      rx_metadata: [
        {
          gateway_ids: {
            gateway_id: gateway.id,
            eui: gateway.eui,
          },
          rssi: signalStrength,
          snr: 7.5 + (Math.random() - 0.5) * 3, // SNR typically 5-10 dB
          timestamp: timestampMs,
        },
      ],
      f_port: port,
      f_cnt: frameCount,
      frm_payload: encodePayload(decodedPayload),
    },
  };
}

// Build QR code data in LoRaWAN Alliance format
export function buildQRCodeData(device: LoRaWANDevice): string {
  // Format: URN:DEV:LW:DEVEUI_JOINEUI_APPKEY
  return `URN:DEV:LW:${device.devEui}_${device.joinEui}_${device.appKey}`;
}

// Parse QR code data
export function parseQRCodeData(data: string): { devEui: string; joinEui: string; appKey: string } | null {
  const match = data.match(/^URN:DEV:LW:([A-F0-9]{16})_([A-F0-9]{16})_([A-F0-9]{32})$/i);
  if (!match) return null;
  return {
    devEui: match[1].toUpperCase(),
    joinEui: match[2].toUpperCase(),
    appKey: match[3].toUpperCase(),
  };
}

// Create a new device with auto-generated credentials
export function createDevice(
  name: string,
  type: 'temperature' | 'door',
  gatewayId: string
): LoRaWANDevice {
  return {
    id: crypto.randomUUID(),
    devEui: generateEUI(),
    joinEui: generateEUI(),
    appKey: generateAppKey(),
    name,
    type,
    gatewayId,
  };
}

// Create a new gateway with auto-generated EUI
export function createGateway(name: string): GatewayConfig {
  return {
    id: `gateway-${Date.now().toString(36)}`,
    eui: generateEUI(),
    name,
    isOnline: true,
  };
}

// =============================================================================
// Per-Device Payload Builders
// Each device sends ONLY its own payload - no bundling across devices
// =============================================================================

export interface DeviceSensorState {
  // Temperature sensor fields
  tempF: number;
  minTempF: number;
  maxTempF: number;
  humidity: number;
  // Door sensor fields
  doorOpen: boolean;
  // Common fields
  batteryPct: number;
  signalStrength: number;
}

/**
 * Build temperature payload for a temperature sensor
 * Contains only temperature/humidity readings + metadata
 */
export function buildTempPayload(
  state: DeviceSensorState,
  orgContext?: { org_id?: string | null; site_id?: string | null; unit_id?: string | null }
): Record<string, unknown> {
  // Generate random temp within configured range
  const temp = state.minTempF + Math.random() * (state.maxTempF - state.minTempF);
  const humidity = state.humidity + (Math.random() - 0.5) * 5;
  
  return {
    temperature: Math.round(temp * 10) / 10,
    humidity: Math.round(humidity * 10) / 10,
    battery_level: Math.round(state.batteryPct),
    signal_strength: Math.round(state.signalStrength),
    reading_type: 'scheduled',
    // Multi-tenant context
    org_id: orgContext?.org_id || null,
    site_id: orgContext?.site_id || null,
    unit_id: orgContext?.unit_id || null,
  };
}

/**
 * Build door payload for a door sensor
 * Contains only door state + metadata
 */
export function buildDoorPayload(
  state: DeviceSensorState,
  orgContext?: { org_id?: string | null; site_id?: string | null; unit_id?: string | null }
): Record<string, unknown> {
  return {
    door_status: state.doorOpen ? 'open' : 'closed',
    battery_level: Math.round(state.batteryPct),
    signal_strength: Math.round(state.signalStrength),
    // Multi-tenant context
    org_id: orgContext?.org_id || null,
    site_id: orgContext?.site_id || null,
    unit_id: orgContext?.unit_id || null,
  };
}
