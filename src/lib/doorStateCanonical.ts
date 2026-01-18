/**
 * Canonical Door State Conversion
 * 
 * Single source of truth for all door state representations.
 * Use this EVERYWHERE to ensure consistency between UI, payloads, and logs.
 */

/**
 * Canonical representation of door state
 * All door-related code should use this interface
 */
export interface CanonicalDoorState {
  /** Boolean truth value - source of truth */
  isOpen: boolean;
  /** String representation for payloads */
  door_status: 'open' | 'closed';
  /** Boolean representation for FrostGuard compatibility */
  door_open: boolean;
  /** UI label */
  label: 'Open' | 'Closed';
}

/**
 * Convert boolean to canonical door state
 * USE THIS EVERYWHERE for consistency
 * 
 * Contract:
 * - If isOpen === true  => door_status: "open",  door_open: true,  label: "Open"
 * - If isOpen === false => door_status: "closed", door_open: false, label: "Closed"
 */
export function toCanonicalDoor(isOpen: boolean): CanonicalDoorState {
  return {
    isOpen,
    door_status: isOpen ? 'open' : 'closed',
    door_open: isOpen,
    label: isOpen ? 'Open' : 'Closed',
  };
}

/**
 * Parse door state from string to boolean
 * Accepts: 'open', 'closed', 'true', 'false', '1', '0'
 */
export function parseDoorStatus(status: string | boolean): boolean {
  if (typeof status === 'boolean') return status;
  const normalized = String(status).toLowerCase().trim();
  return normalized === 'open' || normalized === 'true' || normalized === '1';
}

/**
 * Generate unique trace ID for door uplink debugging
 * Format: door-{timestamp}-{random}
 */
export function generateDoorTraceId(): string {
  return `door-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate that UI state matches payload state
 * Returns true if consistent, throws if mismatch
 */
export function validateDoorConsistency(
  uiIsOpen: boolean,
  payloadDoorStatus: string,
  payloadDoorOpen?: boolean
): { valid: boolean; error?: string } {
  const canonical = toCanonicalDoor(uiIsOpen);
  
  if (payloadDoorStatus !== canonical.door_status) {
    return {
      valid: false,
      error: `Mismatch: UI shows ${canonical.label} but payload has door_status="${payloadDoorStatus}"`,
    };
  }
  
  if (payloadDoorOpen !== undefined && payloadDoorOpen !== canonical.door_open) {
    return {
      valid: false,
      error: `Mismatch: UI shows ${canonical.label} but payload has door_open=${payloadDoorOpen}`,
    };
  }
  
  return { valid: true };
}

/**
 * Log door state with trace ID for debugging
 */
export function logDoorTrace(
  traceId: string,
  deviceId: string,
  devEui: string,
  truthIsOpen: boolean,
  payloadPreview: Record<string, unknown>
): void {
  const canonical = toCanonicalDoor(truthIsOpen);
  
  console.log('[DOOR_UPLINK_TRACE]', {
    trace_id: traceId,
    deviceId,
    dev_eui: devEui,
    // Truth source
    truth_isOpen: truthIsOpen,
    // Canonical representation
    canonical_door_status: canonical.door_status,
    canonical_door_open: canonical.door_open,
    canonical_label: canonical.label,
    // Payload values being sent
    payload_door_status: payloadPreview.door_status,
    payload_door_open: payloadPreview.door_open,
    // Consistency check
    is_consistent: 
      payloadPreview.door_status === canonical.door_status &&
      payloadPreview.door_open === canonical.door_open,
    timestamp: new Date().toISOString(),
  });
}
