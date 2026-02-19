/**
 * Scenario & Alarm Definitions
 *
 * Comprehensive list of every alarm-generating scenario as clickable items.
 * Each definition specifies which sensor types are affected, what state
 * overrides to apply, and what payload overrides to merge into the uplink.
 */

import type { SensorState } from './emulatorSensorState';
import { ALARM_TRIGGERS } from './deviceLibrary/alarmTriggers';

// ============================================
// Types
// ============================================

export type ScenarioAlarmSeverity = 'normal' | 'warning' | 'critical';

export type ScenarioAlarmCategory =
  | 'Normal Operation'
  | 'Temperature Alarm'
  | 'Door Alarm'
  | 'Environmental'
  | 'Sensor Health'
  | 'Security';

export type AffectedSensorType = 'temperature' | 'door' | 'all';

export interface ScenarioAlarmDef {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  severity: ScenarioAlarmSeverity;
  category: ScenarioAlarmCategory;
  /** Which sensor types this scenario affects during emission */
  affectedSensorTypes: AffectedSensorType;
  /** Partial SensorState overrides applied to affected sensors */
  sensorStateOverrides: Partial<SensorState>;
  /** Extra fields merged into the decoded payload sent to TTN */
  payloadOverrides?: Record<string, unknown>;
  /** Optional RF/signal overrides */
  signalOverrides?: { rssi?: number; snr?: number };
}

// ============================================
// Category display config
// ============================================

export const CATEGORY_ORDER: ScenarioAlarmCategory[] = [
  'Normal Operation',
  'Temperature Alarm',
  'Door Alarm',
  'Environmental',
  'Sensor Health',
  'Security',
];

export const CATEGORY_COLORS: Record<ScenarioAlarmCategory, string> = {
  'Normal Operation': 'bg-green-500/10 text-green-600 border-green-500/30',
  'Temperature Alarm': 'bg-red-500/10 text-red-600 border-red-500/30',
  'Door Alarm': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  'Environmental': 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  'Sensor Health': 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  'Security': 'bg-rose-500/10 text-rose-600 border-rose-500/30',
};

export const CATEGORY_ICON_BG: Record<ScenarioAlarmCategory, string> = {
  'Normal Operation': 'bg-green-500/10 text-green-500',
  'Temperature Alarm': 'bg-red-500/10 text-red-500',
  'Door Alarm': 'bg-amber-500/10 text-amber-500',
  'Environmental': 'bg-blue-500/10 text-blue-500',
  'Sensor Health': 'bg-purple-500/10 text-purple-500',
  'Security': 'bg-rose-500/10 text-rose-500',
};

export const SEVERITY_COLORS: Record<ScenarioAlarmSeverity, string> = {
  normal: 'bg-green-500/10 text-green-600 border-green-500/30',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
};

export const SEVERITY_ICON_BG: Record<ScenarioAlarmSeverity, string> = {
  normal: 'bg-green-500/10 text-green-500',
  warning: 'bg-amber-500/10 text-amber-500',
  critical: 'bg-destructive/10 text-destructive',
};

// ============================================
// All Scenario & Alarm Definitions
// ============================================

export const SCENARIO_ALARM_DEFS: ScenarioAlarmDef[] = [
  // ── Normal Operation ──────────────────────
  {
    id: 'normal_freezer',
    name: 'Normal Freezer',
    description: 'Stable freezer at -18°F to -10°F',
    icon: 'Snowflake',
    severity: 'normal',
    category: 'Normal Operation',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: -18,
      maxTempF: -10,
      tempF: -14,
      humidity: 30,
      batteryPct: 95,
      signalStrength: -65,
    },
  },
  {
    id: 'normal_fridge',
    name: 'Normal Refrigerator',
    description: 'Stable fridge at 35°F to 40°F',
    icon: 'Thermometer',
    severity: 'normal',
    category: 'Normal Operation',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 35,
      maxTempF: 40,
      tempF: 37,
      humidity: 45,
      batteryPct: 95,
      signalStrength: -65,
    },
  },
  {
    id: 'normal_door',
    name: 'Normal Door (Closed)',
    description: 'Door sensor reporting closed state',
    icon: 'DoorClosed',
    severity: 'normal',
    category: 'Normal Operation',
    affectedSensorTypes: 'door',
    sensorStateOverrides: {
      doorOpen: false,
      batteryPct: 90,
      signalStrength: -70,
    },
  },

  // ── Temperature Alarms ────────────────────
  {
    id: 'temp_excursion_mild',
    name: 'Mild Temp Excursion',
    description: 'Borderline temperature 41-45°F',
    icon: 'ThermometerSun',
    severity: 'warning',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 41,
      maxTempF: 45,
      tempF: 43,
      humidity: 55,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'temp_excursion_mild',
    },
  },
  {
    id: 'temp_high_fridge',
    name: 'Fridge Too Warm',
    description: 'FDA danger zone 45-55°F',
    icon: 'Thermometer',
    severity: 'critical',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 45,
      maxTempF: 55,
      tempF: 50,
      humidity: 70,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: {
      ...ALARM_TRIGGERS.temp_high.payloadOverrides,
      temperature: 50.0,
    },
  },
  {
    id: 'temp_high_freezer',
    name: 'Freezer Too Warm',
    description: 'Thawing temperature 0-15°F',
    icon: 'Snowflake',
    severity: 'critical',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 0,
      maxTempF: 15,
      tempF: 8,
      humidity: 50,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'freezer_thaw',
    },
  },
  {
    id: 'temp_critical',
    name: 'Critical High Temp',
    description: 'Equipment failure 60-85°F',
    icon: 'Flame',
    severity: 'critical',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 60,
      maxTempF: 85,
      tempF: 72,
      humidity: 80,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.temp_high.payloadOverrides,
  },
  {
    id: 'temp_low',
    name: 'Below Freezing',
    description: 'Dangerously cold -30 to -25°F',
    icon: 'Snowflake',
    severity: 'warning',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: -30,
      maxTempF: -25,
      tempF: -27,
      humidity: 20,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.temp_low.payloadOverrides,
  },
  {
    id: 'temp_rapid_rise',
    name: 'Rapid Temperature Rise',
    description: 'Compressor failure 55-75°F',
    icon: 'TrendingUp',
    severity: 'critical',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 55,
      maxTempF: 75,
      tempF: 65,
      humidity: 75,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'rapid_temp_rise',
    },
  },
  {
    id: 'power_outage',
    name: 'Power Outage',
    description: 'Battery draining + temp rising 50-65°F',
    icon: 'ZapOff',
    severity: 'critical',
    category: 'Temperature Alarm',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      minTempF: 50,
      maxTempF: 65,
      tempF: 58,
      humidity: 70,
      batteryPct: 15,
      signalStrength: -80,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'power_outage',
      battery_low: true,
    },
  },

  // ── Door Alarms ───────────────────────────
  {
    id: 'door_stuck_open',
    name: 'Door Stuck Open',
    description: 'Door open for extended period (1hr+)',
    icon: 'DoorOpen',
    severity: 'warning',
    category: 'Door Alarm',
    affectedSensorTypes: 'door',
    sensorStateOverrides: {
      doorOpen: true,
      batteryPct: 90,
      signalStrength: -70,
    },
    payloadOverrides: ALARM_TRIGGERS.door_stuck_open.payloadOverrides,
  },
  {
    id: 'door_rapid_cycling',
    name: 'Door Rapid Cycling',
    description: 'Frequent open/close events',
    icon: 'RefreshCw',
    severity: 'warning',
    category: 'Door Alarm',
    affectedSensorTypes: 'door',
    sensorStateOverrides: {
      doorOpen: true,
      batteryPct: 85,
      signalStrength: -70,
    },
    payloadOverrides: {
      door_open: true,
      open_count: 50,
      alarm: true,
      alarm_type: 'door_rapid_cycling',
    },
  },

  // ── Environmental ─────────────────────────
  {
    id: 'leak_detected',
    name: 'Leak Detected',
    description: 'Water or fluid leak alarm',
    icon: 'Droplets',
    severity: 'critical',
    category: 'Environmental',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.leak_detected.payloadOverrides,
  },
  {
    id: 'co2_high',
    name: 'High CO2 Level',
    description: 'CO2 exceeds 2500 ppm safe limit',
    icon: 'Wind',
    severity: 'warning',
    category: 'Environmental',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.co2_high.payloadOverrides,
  },
  {
    id: 'humidity_excursion',
    name: 'High Humidity',
    description: 'Condensation risk 85-95% RH',
    icon: 'CloudRain',
    severity: 'warning',
    category: 'Environmental',
    affectedSensorTypes: 'temperature',
    sensorStateOverrides: {
      humidity: 92,
      batteryPct: 95,
      signalStrength: -65,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'humidity_excursion',
    },
  },

  // ── Sensor Health ─────────────────────────
  {
    id: 'low_battery',
    name: 'Low Battery',
    description: 'Battery at warning level (8%)',
    icon: 'BatteryLow',
    severity: 'warning',
    category: 'Sensor Health',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 8,
    },
    payloadOverrides: ALARM_TRIGGERS.low_battery.payloadOverrides,
  },
  {
    id: 'battery_critical',
    name: 'Battery Critical',
    description: 'Battery near dead (3%)',
    icon: 'BatteryWarning',
    severity: 'critical',
    category: 'Sensor Health',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 3,
    },
    payloadOverrides: {
      battery: 3,
      battery_low: true,
      battery_status: 'critical',
      alarm: true,
      alarm_type: 'battery_critical',
    },
  },
  {
    id: 'poor_signal',
    name: 'Poor Signal',
    description: 'Weak gateway connection (-95 dBm)',
    icon: 'WifiOff',
    severity: 'warning',
    category: 'Sensor Health',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      signalStrength: -95,
    },
    signalOverrides: { rssi: -95, snr: 1 },
  },
  {
    id: 'signal_critical',
    name: 'Signal Critical',
    description: 'Near loss of connectivity (-115 dBm)',
    icon: 'WifiOff',
    severity: 'critical',
    category: 'Sensor Health',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      signalStrength: -115,
    },
    signalOverrides: ALARM_TRIGGERS.poor_signal.signalOverrides,
  },
  {
    id: 'sensor_offline',
    name: 'Sensor Offline',
    description: 'Device stopped reporting',
    icon: 'RadioTower',
    severity: 'critical',
    category: 'Sensor Health',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      isOnline: false,
    },
    payloadOverrides: {
      alarm: true,
      alarm_type: 'offline',
    },
  },

  // ── Security ──────────────────────────────
  {
    id: 'motion_detected',
    name: 'Motion Detected',
    description: 'Movement in monitored area',
    icon: 'Activity',
    severity: 'warning',
    category: 'Security',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 90,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.motion_detected.payloadOverrides,
  },
  {
    id: 'tamper_alert',
    name: 'Tamper Alert',
    description: 'Device has been tampered with',
    icon: 'ShieldAlert',
    severity: 'critical',
    category: 'Security',
    affectedSensorTypes: 'all',
    sensorStateOverrides: {
      batteryPct: 90,
      signalStrength: -65,
    },
    payloadOverrides: ALARM_TRIGGERS.tamper_alert.payloadOverrides,
  },
];

// ============================================
// Helpers
// ============================================

/** Get definitions grouped by category in display order */
export function getGroupedScenarios(): Map<ScenarioAlarmCategory, ScenarioAlarmDef[]> {
  const grouped = new Map<ScenarioAlarmCategory, ScenarioAlarmDef[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, SCENARIO_ALARM_DEFS.filter(d => d.category === cat));
  }
  return grouped;
}

/** Get a definition by ID */
export function getScenarioAlarmById(id: string): ScenarioAlarmDef | undefined {
  return SCENARIO_ALARM_DEFS.find(d => d.id === id);
}
