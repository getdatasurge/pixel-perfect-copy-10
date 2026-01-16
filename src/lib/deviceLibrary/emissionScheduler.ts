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
  emissionCount: number;
  errors: number;
  startedAt: string | null;
}

/**
 * Emission callback type
 */
export type EmissionCallback = (deviceId: string) => void | Promise<void>;

/**
 * Device interval entry
 */
interface IntervalEntry {
  interval: ReturnType<typeof setInterval>;
  callback: EmissionCallback;
  intervalMs: number;
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
   * Start emission for a single device
   */
  startDevice(
    deviceId: string,
    intervalSec: number,
    callback: EmissionCallback,
    options?: { emitImmediately?: boolean }
  ): void {
    // Stop existing interval if any
    this.stopDevice(deviceId);

    const intervalMs = intervalSec * 1000;
    const now = new Date().toISOString();

    // Initialize or reset status
    const existingStatus = this.status.get(deviceId);
    this.status.set(deviceId, {
      deviceId,
      isRunning: true,
      intervalMs,
      lastEmittedAt: existingStatus?.lastEmittedAt || null,
      emissionCount: existingStatus?.emissionCount || 0,
      errors: existingStatus?.errors || 0,
      startedAt: now,
    });

    // Create interval
    const interval = setInterval(async () => {
      try {
        await callback(deviceId);
        this.recordEmission(deviceId);
      } catch (error) {
        this.recordError(deviceId);
        console.error(`[EmissionScheduler] Error emitting for ${deviceId}:`, error);
      }
    }, intervalMs);

    // Store interval entry
    this.intervals.set(deviceId, {
      interval,
      callback,
      intervalMs,
    });

    // Emit immediately if requested
    if (options?.emitImmediately) {
      // Use setTimeout(0) to make it async and avoid blocking
      setTimeout(async () => {
        try {
          await callback(deviceId);
          this.recordEmission(deviceId);
        } catch (error) {
          this.recordError(deviceId);
          console.error(`[EmissionScheduler] Error on immediate emit for ${deviceId}:`, error);
        }
      }, 0);
    }

    console.log(`[EmissionScheduler] Started device ${deviceId} with ${intervalSec}s interval`);
  }

  /**
   * Stop emission for a single device
   */
  stopDevice(deviceId: string): void {
    const entry = this.intervals.get(deviceId);
    if (entry) {
      clearInterval(entry.interval);
      this.intervals.delete(deviceId);
    }

    const status = this.status.get(deviceId);
    if (status) {
      this.status.set(deviceId, {
        ...status,
        isRunning: false,
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
      clearInterval(entry.interval);
      
      const status = this.status.get(deviceId);
      if (status) {
        this.status.set(deviceId, {
          ...status,
          isRunning: false,
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
