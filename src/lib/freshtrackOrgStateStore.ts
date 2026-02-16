/**
 * FreshTrack Org State Store
 *
 * Caches the pulled FreshTrack organization state in sessionStorage
 * so it persists across tab switches but not across sessions.
 */

const STORAGE_KEY = 'lorawan-emulator-freshtrack-org-state';

export interface FreshTrackSite {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  timezone?: string;
  is_active: boolean;
}

export interface FreshTrackArea {
  id: string;
  name: string;
  description?: string | null;
  site_id: string;
  sort_order?: number;
  is_active: boolean;
}

export interface FreshTrackUnit {
  id: string;
  name: string;
  unit_type?: string;
  area_id?: string;
  site_id: string;
  temp_limit_high?: number | null;
  temp_limit_low?: number | null;
  status?: string;
  is_active: boolean;
  created_at?: string;
}

export interface FreshTrackSensor {
  id: string;
  name: string;
  dev_eui: string;
  app_eui?: string | null;
  sensor_type: string;
  status: string;
  site_id?: string | null;
  unit_id?: string | null;
  ttn_device_id?: string | null;
  ttn_application_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  is_primary?: boolean;
  last_seen_at?: string | null;
}

export interface FreshTrackGateway {
  id: string;
  name: string;
  gateway_eui: string;
  status: string;
  site_id?: string | null;
  description?: string | null;
  last_seen_at?: string | null;
}

export interface FreshTrackTTNConfig {
  enabled: boolean;
  provisioning_status?: string;
  cluster?: string | null;
  application_id?: string | null;
  webhook_id?: string | null;
  webhook_url?: string | null;
  api_key_last4?: string | null;
  updated_at?: string | null;
}

export interface FreshTrackOrgState {
  pulledAt: string;
  orgId: string;
  syncVersion: number;
  updatedAt?: string;
  sites: FreshTrackSite[];
  areas: FreshTrackArea[];
  units: FreshTrackUnit[];
  sensors: FreshTrackSensor[];
  gateways: FreshTrackGateway[];
  ttn: FreshTrackTTNConfig | null;
}

export function loadOrgState(): FreshTrackOrgState | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[FreshTrackOrgState] Failed to load:', e);
  }
  return null;
}

export function saveOrgState(state: FreshTrackOrgState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[FreshTrackOrgState] Failed to save:', e);
  }
}

export function clearOrgState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[FreshTrackOrgState] Failed to clear:', e);
  }
}
