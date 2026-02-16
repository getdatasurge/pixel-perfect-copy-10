/**
 * Shared settings loading utilities for edge functions
 */

import { getSupabaseClient } from "./supabase.ts";

/**
 * TTN Settings structure
 */
export interface TTNSettings {
  api_key: string | null;
  application_id: string | null;
  cluster: string;
  enabled: boolean;
  webhook_secret?: string | null;
  gateway_owner_type?: string | null;
  gateway_owner_id?: string | null;
}

/**
 * Load TTN settings from synced_users table for a user.
 * This contains the user's personal TTN configuration synced from FrostGuard.
 */
export async function loadUserSettings(userId: string): Promise<TTNSettings | null> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('synced_users')
      .select('ttn')
      .eq('source_user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[settings] Error loading user TTN settings:', error);
      return null;
    }

    if (!data || !data.ttn) {
      console.log(`[settings] No TTN settings found for user ${userId}`);
      return null;
    }

    const ttn = data.ttn as Record<string, unknown>;
    if (!ttn.enabled) {
      console.log(`[settings] TTN not enabled for user ${userId}`);
      return null;
    }

    return {
      api_key: (ttn.api_key as string) || null,
      application_id: (ttn.application_id as string) || null,
      cluster: (ttn.cluster as string) || 'nam1',
      enabled: Boolean(ttn.enabled),
      webhook_secret: (ttn.webhook_secret as string) || null,
      gateway_owner_type: (ttn.gateway_owner_type as string) || null,
      gateway_owner_id: (ttn.gateway_owner_id as string) || null,
    };
  } catch (err) {
    console.error('[settings] Exception loading user settings:', err);
    return null;
  }
}

/**
 * Load TTN settings from ttn_settings table for an organization.
 * This is the org-level canonical TTN configuration.
 */
export async function loadOrgSettings(orgId: string): Promise<TTNSettings | null> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('ttn_settings')
      .select('api_key, application_id, cluster, enabled, webhook_secret, gateway_owner_type, gateway_owner_id')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      console.error('[settings] Error loading org TTN settings:', error);
      return null;
    }

    if (!data || !data.enabled) {
      console.log(`[settings] No enabled TTN settings for org ${orgId}`);
      return null;
    }

    return data as TTNSettings;
  } catch (err) {
    console.error('[settings] Exception loading org settings:', err);
    return null;
  }
}

/**
 * Load TTN settings with fallback from user to org.
 * Tries user settings first, falls back to org settings if user doesn't have API key.
 */
export async function loadTTNSettings(
  selectedUserId: string,
  orgId?: string
): Promise<{ settings: TTNSettings | null; source: 'user' | 'org' | null }> {
  // Try user settings first
  const userSettings = await loadUserSettings(selectedUserId);

  if (userSettings?.api_key) {
    return { settings: userSettings, source: 'user' };
  }

  // Fallback to org settings if available
  if (orgId) {
    console.log(`[settings] User settings missing API key, checking org ${orgId}`);
    const orgSettings = await loadOrgSettings(orgId);

    if (orgSettings?.api_key) {
      // Merge: use user's app/cluster if available, otherwise org's
      if (userSettings) {
        return {
          settings: {
            ...orgSettings,
            application_id: userSettings.application_id || orgSettings.application_id,
            cluster: userSettings.cluster || orgSettings.cluster,
          },
          source: 'org',
        };
      }
      return { settings: orgSettings, source: 'org' };
    }
  }

  // Return user settings even if no API key (for partial config)
  if (userSettings) {
    return { settings: userSettings, source: 'user' };
  }

  return { settings: null, source: null };
}
