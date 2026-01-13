/**
 * Server Time Synchronization Utility
 * 
 * Tracks the offset between browser time and server time to ensure
 * consistent timestamps across the emulator, payloads, and database.
 */

// Offset in milliseconds: serverTime - browserTime
let serverTimeOffset = 0;

// Last sync timestamp for staleness detection
let lastSyncAt: Date | null = null;

/**
 * Update the server time offset from an authoritative server timestamp.
 * Call this after receiving a response from ttn-simulate.
 */
export function updateServerOffset(serverTimestamp: string): void {
  const serverTime = new Date(serverTimestamp).getTime();
  const browserTime = Date.now();
  serverTimeOffset = serverTime - browserTime;
  lastSyncAt = new Date();
  
  console.log('[serverTime] Offset updated:', {
    serverTimestamp,
    offsetMs: serverTimeOffset,
    offsetSeconds: Math.round(serverTimeOffset / 1000),
  });
}

/**
 * Get the current server-synchronized time as a Date object.
 */
export function getServerTime(): Date {
  return new Date(Date.now() + serverTimeOffset);
}

/**
 * Get the current server-synchronized time as an ISO string.
 */
export function getServerTimeISO(): string {
  return getServerTime().toISOString();
}

/**
 * Get the current time offset in milliseconds.
 * Positive = server ahead, Negative = server behind
 */
export function getServerTimeOffset(): number {
  return serverTimeOffset;
}

/**
 * Get the last time the offset was synced.
 */
export function getLastSyncTime(): Date | null {
  return lastSyncAt;
}

/**
 * Check if the time sync is stale (older than the given threshold).
 * @param thresholdMs - Maximum age in milliseconds (default: 5 minutes)
 */
export function isTimeSyncStale(thresholdMs: number = 5 * 60 * 1000): boolean {
  if (!lastSyncAt) return true;
  return Date.now() - lastSyncAt.getTime() > thresholdMs;
}

/**
 * Reset the time offset (for testing or reconnection).
 */
export function resetServerTimeOffset(): void {
  serverTimeOffset = 0;
  lastSyncAt = null;
}
