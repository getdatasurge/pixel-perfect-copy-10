import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export interface LockInfo {
  user_id: string;
  session_id: string;
  started_at: string;
  last_heartbeat_at: string;
  device_info: string;
}

export interface LockResult {
  ok: boolean;
  message?: string;
  error?: string;
  lock_info?: LockInfo;
  locked?: boolean;
  stale?: boolean;
}

/**
 * Acquire an emulator lock for an organization
 */
export async function acquireEmulatorLock(
  orgId: string,
  userId: string,
  sessionId: string,
  deviceInfo?: string,
  force = false
): Promise<LockResult> {
  try {
    const { data, error } = await supabase.functions.invoke('emulator-lock', {
      body: {
        action: 'acquire',
        org_id: orgId,
        user_id: userId,
        session_id: sessionId,
        device_info: deviceInfo || `${navigator.userAgent.slice(0, 100)}`,
        force,
      },
    });

    if (error) {
      console.error('[emulatorLock] Acquire error:', error);
      return { ok: false, error: error.message };
    }

    return data as LockResult;
  } catch (err) {
    console.error('[emulatorLock] Acquire exception:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Release an emulator lock
 */
export async function releaseEmulatorLock(
  orgId: string,
  sessionId: string
): Promise<LockResult> {
  try {
    const { data, error } = await supabase.functions.invoke('emulator-lock', {
      body: {
        action: 'release',
        org_id: orgId,
        session_id: sessionId,
      },
    });

    if (error) {
      console.error('[emulatorLock] Release error:', error);
      return { ok: false, error: error.message };
    }

    return data as LockResult;
  } catch (err) {
    console.error('[emulatorLock] Release exception:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Send a heartbeat to keep the lock alive
 */
export async function sendEmulatorHeartbeat(
  orgId: string,
  sessionId: string
): Promise<LockResult> {
  try {
    const { data, error } = await supabase.functions.invoke('emulator-lock', {
      body: {
        action: 'heartbeat',
        org_id: orgId,
        session_id: sessionId,
      },
    });

    if (error) {
      console.error('[emulatorLock] Heartbeat error:', error);
      return { ok: false, error: error.message };
    }

    return data as LockResult;
  } catch (err) {
    console.error('[emulatorLock] Heartbeat exception:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Check if a lock exists for an organization
 */
export async function checkEmulatorLock(orgId: string): Promise<LockResult> {
  try {
    const { data, error } = await supabase.functions.invoke('emulator-lock', {
      body: {
        action: 'check',
        org_id: orgId,
      },
    });

    if (error) {
      console.error('[emulatorLock] Check error:', error);
      return { ok: false, error: error.message };
    }

    return data as LockResult;
  } catch (err) {
    console.error('[emulatorLock] Check exception:', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Release lock via sendBeacon (for tab close)
 * Returns true if beacon was queued successfully
 */
export function releaseEmulatorLockBeacon(orgId: string, sessionId: string): boolean {
  if (!SUPABASE_URL) return false;
  
  const url = `${SUPABASE_URL}/functions/v1/emulator-lock`;
  const payload = JSON.stringify({
    action: 'release',
    org_id: orgId,
    session_id: sessionId,
  });

  return navigator.sendBeacon(url, payload);
}
