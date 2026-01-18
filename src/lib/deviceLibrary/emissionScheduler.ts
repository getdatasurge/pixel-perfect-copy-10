/**
 * Emission Scheduler
 * 
 * Manages independent emission intervals per device for multi-device
 * concurrent emulation with independent state tracking.
 */

// ============================================
// Types
// ============================================

/**
 * Emission status for a device
 */
export interface DeviceEmissionStatus {
  deviceId: string;
  isRunning: boolean;
  intervalMs: number;
  lastEmittedAt: string | null;
  nextFireAt: string | null; // Added for drift correction visibility
  emissionCount: number;
  errors: number;
  startedAt: string | null;
}

/**
 * Emission callback type
 */
export type EmissionCallback = (deviceId: string) => void | Promise<void>;

/**
 * Device interval entry - using setTimeout for drift correction
 */
interface IntervalEntry {
  timeout: ReturnType<typeof setTimeout>;
  callback: EmissionCallback;
  intervalMs: number;
  nextFireAt: number; // Epoch ms for drift correction
}

// ============================================
// EmissionScheduler Class
// ============================================

/**
 * Emission Scheduler - manages per-device intervals and status
 * 
 * Features:
 * - Independent intervals per device
 * - Status tracking (emission count, errors, last emitted)
 * - Start/stop individual devices or all
 * - Update interval without stopping
 */
export class EmissionScheduler {
  private intervals: Map<string, IntervalEntry> = new Map();
  private status: Map<string, DeviceEmissionStatus> = new Map();

  constructor() {
    // Initialize empty maps
  }

  /**
   * Start emission for a single device with drift-corrected scheduling
   * Uses chained setTimeout instead of setInterval to prevent timing drift
   */
  startDevice(
    deviceId: string,
    intervalSec: number,
    callback: EmissionCallback,
    options?: { emitImmediately?: boolean }
  ): void {
    // Stop existing timer if any
    this.stopDevice(deviceId);

    const intervalMs = intervalSec * 1000;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Calculate first fire time
    let nextFireAt = now + intervalMs;

    // Initialize or reset status
    const existingStatus = this.status.get(deviceId);
    this.status.set(deviceId, {
      deviceId,
      isRunning: true,
      intervalMs,
      lastEmittedAt: existingStatus?.lastEmittedAt || null,
      nextFireAt: new Date(nextFireAt).toISOString(),
      emissionCount: existingStatus?.emissionCount || 0,
      errors: existingStatus?.errors || 0,
      startedAt: nowIso,
    });

    // Drift-corrected scheduling using chained setTimeout
    const scheduleNext = () => {
      const currentTime = Date.now();
      const delay = Math.max(0, nextFireAt - currentTime);

      const timeout = setTimeout(async () => {
        // Check if still running (might have been stopped)
        if (!this.intervals.has(deviceId)) return;

        try {
          await callback(deviceId);
          this.recordEmission(deviceId);
        } catch (error) {
          this.recordError(deviceId);
          console.error(`[EmissionScheduler] Error emitting for ${deviceId}:`, error);
        }

        // Schedule next tick based on EXPECTED time (drift correction)
        nextFireAt += intervalMs;

        // If we're behind (e.g., tab was backgrounded), catch up but don't spam
        const currentNow = Date.now();
        if (nextFireAt < currentNow) {
          console.log(`[EmissionScheduler] Drift detected for ${deviceId}, resyncing`);
          nextFireAt = currentNow + intervalMs;
        }

        // Update status with next fire time
        const status = this.status.get(deviceId);
        if (status) {
          this.status.set(deviceId, {
            ...status,
            nextFireAt: new Date(nextFireAt).toISOString(),
          });
        }

        // Store updated entry and schedule next
        this.intervals.set(deviceId, {
          timeout,
          callback,
          intervalMs,
          nextFireAt,
        });

        scheduleNext();
      }, delay);

      // Store initial entry
      this.intervals.set(deviceId, {
        timeout,
        callback,
        intervalMs,
        nextFireAt,
      });
    };

    // Emit immediately if requested, then start scheduling
    if (options?.emitImmediately) {
      (async () => {
        try {
          await callback(deviceId);
          this.recordEmission(deviceId);
        } catch (error) {
          this.recordError(deviceId);
          console.error(`[EmissionScheduler] Error on immediate emit for ${deviceId}:`, error);
        }
        scheduleNext();
      })();
    } else {
      scheduleNext();
    }

    console.log(`[EmissionScheduler] Started device ${deviceId} with ${intervalSec}s interval (drift-corrected)`);
  }

  /**
   * Stop emission for a single device
   */
  stopDevice(deviceId: string): void {
    const entry = this.intervals.get(deviceId);
    if (entry) {
      clearTimeout(entry.timeout);
      this.intervals.delete(deviceId);
    }

    const status = this.status.get(deviceId);
    if (status) {
      this.status.set(deviceId, {
        ...status,
        isRunning: false,
        nextFireAt: null,
      });
    }

    console.log(`[EmissionScheduler] Stopped device ${deviceId}`);
  }

  /**
   * Stop all device emissions
   */
  stopAll(): void {
    const deviceIds = Array.from(this.intervals.keys());

    for (const [deviceId, entry] of this.intervals) {
      clearTimeout(entry.timeout);

      const status = this.status.get(deviceId);
      if (status) {
        this.status.set(deviceId, {
          ...status,
          isRunning: false,
          nextFireAt: null,
        });
      }
    }

    this.intervals.clear();
    console.log(`[EmissionScheduler] Stopped all devices: ${deviceIds.join(', ')}`);
  }

  /**
   * Check if a device is actively emitting
   */
  isRunning(deviceId: string): boolean {
    return this.intervals.has(deviceId);
  }

  /**
   * Get emission status for a device
   */
  getStatus(deviceId: string): DeviceEmissionStatus | null {
    return this.status.get(deviceId) || null;
  }

  /**
   * Get status for all devices
   */
  getAllStatus(): DeviceEmissionStatus[] {
    return Array.from(this.status.values());
  }

  /**
   * Get only running devices' status
   */
  getRunningStatus(): DeviceEmissionStatus[] {
    return Array.from(this.status.values()).filter(s => s.isRunning);
  }

  /**
   * Update interval for a running device
   * Restarts the interval with the new timing
   */
  updateInterval(deviceId: string, intervalSec: number): void {
    const entry = this.intervals.get(deviceId);
    if (!entry) {
      console.warn(`[EmissionScheduler] Cannot update interval: device ${deviceId} not running`);
      return;
    }

    // Restart with new interval
    this.startDevice(deviceId, intervalSec, entry.callback);
  }

  /**
   * Record successful emission
   */
  recordEmission(deviceId: string): void {
    const status = this.status.get(deviceId);
    if (status) {
      this.status.set(deviceId, {
        ...status,
        lastEmittedAt: new Date().toISOString(),
        emissionCount: status.emissionCount + 1,
      });
    }
  }

  /**
   * Record emission error
   */
  recordError(deviceId: string): void {
    const status = this.status.get(deviceId);
    if (status) {
      this.status.set(deviceId, {
        ...status,
        errors: status.errors + 1,
      });
    }
  }

  /**
   * Get active device count
   */
  get activeCount(): number {
    return this.intervals.size;
  }

  /**
   * Get total emission count across all devices
   */
  get totalEmissions(): number {
    let total = 0;
    for (const status of this.status.values()) {
      total += status.emissionCount;
    }
    return total;
  }

  /**
   * Get total error count across all devices
   */
  get totalErrors(): number {
    let total = 0;
    for (const status of this.status.values()) {
      total += status.errors;
    }
    return total;
  }

  /**
   * Reset status counters for a device
   */
  resetStatus(deviceId: string): void {
    const status = this.status.get(deviceId);
    if (status) {
      this.status.set(deviceId, {
        ...status,
        emissionCount: 0,
        errors: 0,
        lastEmittedAt: null,
        startedAt: null,
      });
    }
  }

  /**
   * Reset all status counters
   */
  resetAllStatus(): void {
    for (const deviceId of this.status.keys()) {
      this.resetStatus(deviceId);
    }
  }

  /**
   * Get summary for logging
   */
  getSummary(): {
    activeDevices: number;
    totalEmissions: number;
    totalErrors: number;
    devices: Array<{
      deviceId: string;
      isRunning: boolean;
      intervalSec: number;
      emissionCount: number;
      errors: number;
      lastEmittedAt: string | null;
    }>;
  } {
    return {
      activeDevices: this.activeCount,
      totalEmissions: this.totalEmissions,
      totalErrors: this.totalErrors,
      devices: Array.from(this.status.values()).map(s => ({
        deviceId: s.deviceId,
        isRunning: s.isRunning,
        intervalSec: s.intervalMs / 1000,
        emissionCount: s.emissionCount,
        errors: s.errors,
        lastEmittedAt: s.lastEmittedAt,
      })),
    };
  }
}

/**
 * Create a new EmissionScheduler instance
 */
export function createEmissionScheduler(): EmissionScheduler {
  return new EmissionScheduler();
}
