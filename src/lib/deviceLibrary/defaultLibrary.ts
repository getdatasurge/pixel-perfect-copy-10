/**
 * Default Device Library
 * 
 * Contains 12 common LoRaWAN device definitions for simulation.
 */

import type { DeviceLibrary } from './types';

export const defaultDeviceLibrary: DeviceLibrary = {
  metadata: {
    version: '1.0.0',
    last_updated: '2025-01-16',
    categories: ['temperature', 'door', 'co2', 'leak', 'gps', 'meter', 'motion', 'air_quality', 'combo'],
    manufacturers: ['Milesight', 'Dragino', 'Tektelic', 'Netvox', 'Elsys', 'Browan'],
  },
  devices: [
    // ============================================
    // Temperature / Humidity Sensors
    // ============================================
    {
      id: 'milesight-em300-th',
      name: 'EM300-TH',
      manufacturer: 'Milesight',
      category: 'temperature',
      model: 'EM300-TH',
      description: 'Temperature and humidity sensor',
      firmware_version: 'v1.2',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.5, humidity: 45, battery: 95 },
        alarm: { temperature: 85.0, humidity: 95, battery: 95 },
      },
    },
    {
      id: 'elsys-ers',
      name: 'ERS',
      manufacturer: 'Elsys',
      category: 'temperature',
      model: 'ERS',
      description: 'Indoor temperature and humidity sensor',
      firmware_version: 'v5.0',
      default_fport: 5,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'int', min: 0, max: 100, unit: '%' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          motion: { type: 'int', min: 0, max: 255 },
          vdd: { type: 'int', min: 2000, max: 3600, unit: 'mV' },
        },
      },
      examples: {
        normal: { temperature: 21.3, humidity: 52, light: 450, motion: 12, vdd: 3450 },
        alarm: { temperature: 55.0, humidity: 95, light: 0, motion: 0, vdd: 2100 },
      },
    },
    
    // ============================================
    // Door / Open-Close Sensors
    // ============================================
    {
      id: 'dragino-lds02',
      name: 'LDS02',
      manufacturer: 'Dragino',
      category: 'door',
      model: 'LDS02',
      description: 'LoRaWAN Door Sensor',
      firmware_version: 'v1.5',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_open: { type: 'bool' },
          open_count: { type: 'int', min: 0, max: 65535, increment: true },
          last_open_duration: { type: 'int', min: 0, max: 65535, unit: 'sec' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_open: false, open_count: 142, last_open_duration: 8, battery: 88 },
        alarm: { door_open: true, open_count: 143, last_open_duration: 3600, battery: 88 },
      },
    },
    {
      id: 'netvox-r311a',
      name: 'R311A',
      manufacturer: 'Netvox',
      category: 'door',
      model: 'R311A',
      description: 'Wireless Door/Window Sensor',
      firmware_version: 'v2.1',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          status: { type: 'enum', values: ['open', 'closed'] },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          tamper: { type: 'bool' },
        },
      },
      examples: {
        normal: { status: 'closed', battery_voltage: 3.2, tamper: false },
        alarm: { status: 'open', battery_voltage: 3.2, tamper: true },
      },
    },
    
    // ============================================
    // CO2 / Air Quality Sensors
    // ============================================
    {
      id: 'milesight-am319',
      name: 'AM319',
      manufacturer: 'Milesight',
      category: 'co2',
      model: 'AM319',
      description: '9-in-1 Indoor Air Quality Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          pm2_5: { type: 'int', min: 0, max: 500, unit: 'µg/m³' },
          pm10: { type: 'int', min: 0, max: 500, unit: 'µg/m³' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          tvoc: { type: 'int', min: 0, max: 60000, unit: 'ppb' },
          pressure: { type: 'float', min: 300, max: 1100, precision: 1, unit: 'hPa' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 650, pm2_5: 12, pm10: 18, temperature: 23.5, humidity: 48, tvoc: 120, pressure: 1013.2, battery: 92 },
        alarm: { co2: 4500, pm2_5: 350, pm10: 450, temperature: 23.5, humidity: 48, tvoc: 50000, pressure: 1013.2, battery: 92 },
      },
    },
    {
      id: 'elsys-ers-co2',
      name: 'ERS CO2',
      manufacturer: 'Elsys',
      category: 'co2',
      model: 'ERS-CO2',
      description: 'Indoor CO2 sensor with temperature and humidity',
      firmware_version: 'v5.0',
      default_fport: 5,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 0, max: 10000, unit: 'ppm' },
          temperature: { type: 'float', min: -40, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'int', min: 0, max: 100, unit: '%' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          vdd: { type: 'int', min: 2000, max: 3600, unit: 'mV' },
        },
      },
      examples: {
        normal: { co2: 580, temperature: 22.1, humidity: 55, light: 320, vdd: 3380 },
        alarm: { co2: 5000, temperature: 22.1, humidity: 55, light: 320, vdd: 2200 },
      },
    },
    
    // ============================================
    // Leak Sensors
    // ============================================
    {
      id: 'dragino-ldds75',
      name: 'LDDS75',
      manufacturer: 'Dragino',
      category: 'leak',
      model: 'LDDS75',
      description: 'Distance Detection Sensor (Water Level)',
      firmware_version: 'v1.3',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          distance: { type: 'int', min: 20, max: 750, unit: 'cm' },
          battery: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          sensor_flag: { type: 'bool' },
        },
      },
      examples: {
        normal: { distance: 250, battery: 3.45, sensor_flag: false },
        alarm: { distance: 25, battery: 3.45, sensor_flag: true },
      },
    },
    {
      id: 'netvox-r718wa2',
      name: 'R718WA2',
      manufacturer: 'Netvox',
      category: 'leak',
      model: 'R718WA2',
      description: 'Wireless Water Leak Detector',
      firmware_version: 'v1.8',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_leak: { type: 'bool' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
        },
      },
      examples: {
        normal: { water_leak: false, battery_voltage: 3.25 },
        alarm: { water_leak: true, battery_voltage: 3.25 },
      },
    },
    
    // ============================================
    // GPS Trackers
    // ============================================
    {
      id: 'dragino-lt-22222-l',
      name: 'LT-22222-L',
      manufacturer: 'Dragino',
      category: 'gps',
      model: 'LT-22222-L',
      description: 'LoRaWAN Tracker with GPS',
      firmware_version: 'v1.6',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          latitude: { type: 'float', min: -90, max: 90, precision: 6 },
          longitude: { type: 'float', min: -180, max: 180, precision: 6 },
          altitude: { type: 'int', min: -100, max: 10000, unit: 'm' },
          speed: { type: 'float', min: 0, max: 200, precision: 1, unit: 'km/h' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
          gps_fix: { type: 'bool' },
        },
      },
      examples: {
        normal: { latitude: 37.7749, longitude: -122.4194, altitude: 25, speed: 0, battery: 78, gps_fix: true },
        alarm: { latitude: 0, longitude: 0, altitude: 0, speed: 0, battery: 15, gps_fix: false },
      },
    },
    
    // ============================================
    // Meters
    // ============================================
    {
      id: 'tektelic-kona-pulse',
      name: 'KONA Pulse Counter',
      manufacturer: 'Tektelic',
      category: 'meter',
      model: 'KONA-PULSE',
      description: 'Pulse counter for utility metering',
      firmware_version: 'v2.3',
      default_fport: 10,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          pulse_count: { type: 'int', min: 0, max: 4294967295, increment: true },
          pulse_rate: { type: 'float', min: 0, max: 10000, precision: 1, unit: 'pulses/min' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
        },
      },
      examples: {
        normal: { pulse_count: 123456, pulse_rate: 12.5, battery: 89, temperature: 22.5 },
        alarm: { pulse_count: 123456, pulse_rate: 0, battery: 5, temperature: -35 },
      },
    },
    
    // ============================================
    // Motion / Occupancy Sensors
    // ============================================
    {
      id: 'browan-tbms100',
      name: 'TBMS100',
      manufacturer: 'Browan',
      category: 'motion',
      model: 'TBMS100',
      description: 'PIR Motion Sensor',
      firmware_version: 'v1.1',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          motion_detected: { type: 'bool' },
          motion_count: { type: 'int', min: 0, max: 65535, increment: true },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { motion_detected: false, motion_count: 856, temperature: 23.2, battery: 94 },
        alarm: { motion_detected: true, motion_count: 857, temperature: 23.2, battery: 94 },
      },
    },
    
    // ============================================
    // Combo Sensors
    // ============================================
    {
      id: 'milesight-em300-mcs',
      name: 'EM300-MCS',
      manufacturer: 'Milesight',
      category: 'combo',
      model: 'EM300-MCS',
      description: 'Magnetic Contact Switch with Temperature',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          magnet_status: { type: 'enum', values: ['open', 'closed'] },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { magnet_status: 'closed', temperature: 4.2, humidity: 65, battery: 91 },
        alarm: { magnet_status: 'open', temperature: 25.0, humidity: 65, battery: 91 },
      },
    },
  ],
};
