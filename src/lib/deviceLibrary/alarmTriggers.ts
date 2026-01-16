/**
 * Alarm Triggers
 * 
 * Built-in alarm definitions that can be applied to devices.
 * Each trigger specifies which device categories it supports
 * and what payload overrides to apply.
 */

import type { DeviceCategory } from './types';

// ============================================
// Alarm Trigger Types
// ============================================

export interface AlarmTrigger {
  id: string;
  name: string;
  description: string;
  icon: string;  // Lucide icon name
  severity: 'warning' | 'critical';
  /** Device categories this alarm applies to */
  applicableCategories: DeviceCategory[];
  /** Payload field overrides when alarm is triggered */
  payloadOverrides: Record<string, unknown>;
  /** Optional RF/signal overrides (rssi, snr) */
  signalOverrides?: {
    rssi?: number;
    snr?: number;
  };
}

export type AlarmTriggerId = 
  | 'temp_high'
  | 'temp_low'
  | 'door_stuck_open'
  | 'leak_detected'
  | 'co2_high'
  | 'low_battery'
  | 'poor_signal'
  | 'motion_detected'
  | 'tamper_alert';

// ============================================
// Built-in Alarm Triggers
// ============================================

export const ALARM_TRIGGERS: Record<AlarmTriggerId, AlarmTrigger> = {
  temp_high: {
    id: 'temp_high',
    name: 'High Temperature',
    description: 'Temperature exceeds safe threshold',
    icon: 'Thermometer',
    severity: 'critical',
    applicableCategories: ['temperature', 'combo', 'air_quality'],
    payloadOverrides: {
      temperature: 85.0,
      alarm: true,
      alarm_type: 'high_temp',
    },
  },

  temp_low: {
    id: 'temp_low',
    name: 'Low Temperature',
    description: 'Temperature below freezing threshold',
    icon: 'Snowflake',
    severity: 'warning',
    applicableCategories: ['temperature', 'combo', 'air_quality'],
    payloadOverrides: {
      temperature: -25.0,
      alarm: true,
      alarm_type: 'low_temp',
    },
  },

  door_stuck_open: {
    id: 'door_stuck_open',
    name: 'Door Stuck Open',
    description: 'Door has been open too long',
    icon: 'DoorOpen',
    severity: 'warning',
    applicableCategories: ['door', 'combo'],
    payloadOverrides: {
      door_open: true,
      open_duration: 3600,
      alarm: true,
      alarm_type: 'door_open_timeout',
    },
  },

  leak_detected: {
    id: 'leak_detected',
    name: 'Leak Detected',
    description: 'Water or fluid leak detected',
    icon: 'Droplets',
    severity: 'critical',
    applicableCategories: ['leak'],
    payloadOverrides: {
      leak_detected: true,
      leak_status: 1,
      alarm: true,
      alarm_type: 'leak',
    },
  },

  co2_high: {
    id: 'co2_high',
    name: 'High CO2',
    description: 'CO2 level exceeds safe limit',
    icon: 'Wind',
    severity: 'warning',
    applicableCategories: ['co2', 'air_quality'],
    payloadOverrides: {
      co2: 2500,
      alarm: true,
      alarm_type: 'high_co2',
    },
  },

  low_battery: {
    id: 'low_battery',
    name: 'Low Battery',
    description: 'Battery level critically low',
    icon: 'BatteryLow',
    severity: 'warning',
    applicableCategories: ['temperature', 'door', 'co2', 'leak', 'gps', 'meter', 'motion', 'air_quality', 'combo'],
    payloadOverrides: {
      battery: 5,
      battery_low: true,
      battery_status: 'critical',
    },
  },

  poor_signal: {
    id: 'poor_signal',
    name: 'Poor Signal',
    description: 'Weak gateway connection',
    icon: 'WifiOff',
    severity: 'warning',
    applicableCategories: ['temperature', 'door', 'co2', 'leak', 'gps', 'meter', 'motion', 'air_quality', 'combo'],
    payloadOverrides: {},
    signalOverrides: {
      rssi: -115,
      snr: -5,
    },
  },

  motion_detected: {
    id: 'motion_detected',
    name: 'Motion Detected',
    description: 'Movement detected in monitored area',
    icon: 'Activity',
    severity: 'warning',
    applicableCategories: ['motion'],
    payloadOverrides: {
      motion: true,
      motion_count: 1,
      occupancy: true,
    },
  },

  tamper_alert: {
    id: 'tamper_alert',
    name: 'Tamper Alert',
    description: 'Device has been tampered with',
    icon: 'ShieldAlert',
    severity: 'critical',
    applicableCategories: ['temperature', 'door', 'co2', 'leak', 'gps', 'meter', 'motion', 'air_quality', 'combo'],
    payloadOverrides: {
      tamper: true,
      alarm: true,
      alarm_type: 'tamper',
    },
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get all alarm triggers as an array
 */
export function getAllAlarmTriggers(): AlarmTrigger[] {
  return Object.values(ALARM_TRIGGERS);
}

/**
 * Get alarm trigger by ID
 */
export function getAlarmTrigger(id: AlarmTriggerId): AlarmTrigger | undefined {
  return ALARM_TRIGGERS[id];
}

/**
 * Get alarm triggers applicable to a specific device category
 */
export function getAlarmsForCategory(category: DeviceCategory): AlarmTrigger[] {
  return Object.values(ALARM_TRIGGERS).filter(alarm =>
    alarm.applicableCategories.includes(category)
  );
}

/**
 * Get alarm triggers applicable to multiple categories (intersection)
 */
export function getAlarmsForCategories(categories: DeviceCategory[]): AlarmTrigger[] {
  if (categories.length === 0) return [];
  
  return Object.values(ALARM_TRIGGERS).filter(alarm =>
    categories.some(cat => alarm.applicableCategories.includes(cat))
  );
}

/**
 * Check if an alarm trigger applies to a device category
 */
export function alarmAppliesToCategory(
  alarmId: AlarmTriggerId,
  category: DeviceCategory
): boolean {
  const alarm = ALARM_TRIGGERS[alarmId];
  return alarm ? alarm.applicableCategories.includes(category) : false;
}

/**
 * Get severity color class for UI
 */
export function getSeverityColor(severity: 'warning' | 'critical'): string {
  return severity === 'critical'
    ? 'bg-destructive/10 text-destructive border-destructive/30'
    : 'bg-amber-500/10 text-amber-600 border-amber-500/30';
}

/**
 * Get severity icon background color for UI
 */
export function getSeverityIconBg(severity: 'warning' | 'critical'): string {
  return severity === 'critical'
    ? 'bg-destructive/10 text-destructive'
    : 'bg-amber-500/10 text-amber-500';
}
