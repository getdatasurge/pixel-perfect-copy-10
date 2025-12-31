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
}

export interface LoRaWANDevice {
  id: string;
  devEui: string;
  joinEui: string;
  appKey: string;
  name: string;
  type: 'temperature' | 'door';
  gatewayId: string;
}

export interface TTNConfig {
  enabled: boolean;
  applicationId: string;
  cluster: string; // e.g., 'eu1', 'nam1', 'au1'
  lastStatus?: {
    code: number;
    message: string;
    timestamp: Date;
  };
}

export interface WebhookConfig {
  enabled: boolean;
  targetUrl: string;
  applicationId: string;
  sendToLocal: boolean;
  // TTN integration config
  ttnConfig?: TTNConfig;
  lastStatus?: {
    code: number;
    message: string;
    timestamp: Date;
  };
  // Multi-tenant test context
  testOrgId?: string;
  testSiteId?: string;
  testUnitId?: string;
  // User tracking fields
  selectedUserId?: string | null;
  selectedUserDisplayName?: string | null;
  contextSetAt?: string | null; // ISO string for localStorage compatibility
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

// Generate device ID from DevEUI
export function generateDeviceId(devEui: string, prefix: string = 'eui'): string {
  return `${prefix}-${devEui.toLowerCase()}`;
}

// Encode payload data to base64 (simulating raw LoRaWAN payload)
export function encodePayload(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  return btoa(json);
}

// Build TTN uplink webhook payload
export function buildTTNPayload(
  device: LoRaWANDevice,
  gateway: GatewayConfig,
  decodedPayload: Record<string, unknown>,
  applicationId: string
): TTNUplinkPayload {
  const signalStrength = decodedPayload.signal_strength as number ?? -65;
  
  return {
    end_device_ids: {
      device_id: generateDeviceId(device.devEui),
      dev_eui: device.devEui,
      application_ids: {
        application_id: applicationId,
      },
    },
    received_at: new Date().toISOString(),
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
          timestamp: Date.now(),
        },
      ],
      f_port: device.type === 'temperature' ? 1 : 2,
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
