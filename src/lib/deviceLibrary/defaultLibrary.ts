/**
 * Default Device Library
 *
 * Contains 40 common LoRaWAN device definitions for simulation.
 * Field names use FreshTrack canonical names:
 *   battery_level (0-100%), battery_voltage (V), temperature (°C),
 *   humidity (%), door_status ('open'|'closed'), door_open (bool), etc.
 */

import type { DeviceLibrary } from './types';

export const defaultDeviceLibrary: DeviceLibrary = {
  metadata: {
    version: '2.0.0',
    last_updated: '2026-02-16',
    categories: [
      'temperature', 'temperature_humidity', 'door', 'contact',
      'co2', 'leak', 'gps', 'meter', 'motion', 'air_quality',
      'combo', 'multi_sensor',
    ],
    manufacturers: ['Milesight', 'Dragino', 'Tektelic', 'Netvox', 'Elsys', 'Browan'],
  },
  devices: [
    // ============================================
    // Temperature Sensors
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.5, humidity: 45, battery_level: 95 },
        alarm: { temperature: 85.0, humidity: 95, battery_level: 95 },
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
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 21.3, humidity: 52, light: 450, motion: 12, battery_voltage: 3.45, battery_level: 95 },
        alarm: { temperature: 55.0, humidity: 95, light: 0, motion: 0, battery_voltage: 2.10, battery_level: 10 },
      },
    },
    {
      id: 'netvox-r718t',
      name: 'R718T',
      manufacturer: 'Netvox',
      category: 'temperature',
      model: 'R718T',
      description: 'Wireless Temperature Sensor',
      firmware_version: 'v1.5',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.0, battery_voltage: 3.30, battery_level: 90 },
        alarm: { temperature: -35.0, battery_voltage: 2.10, battery_level: 8 },
      },
    },
    {
      id: 'dragino-lht52',
      name: 'LHT52',
      manufacturer: 'Dragino',
      category: 'temperature',
      model: 'LHT52',
      description: 'LoRaWAN Temperature Sensor',
      firmware_version: 'v1.3',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 23.1, humidity: 50, battery_voltage: 3.40, battery_level: 92 },
        alarm: { temperature: 80.0, humidity: 10, battery_voltage: 2.60, battery_level: 12 },
      },
    },

    // ============================================
    // Temperature + Humidity Sensors
    // ============================================
    {
      id: 'dragino-lht65',
      name: 'LHT65',
      manufacturer: 'Dragino',
      category: 'temperature_humidity',
      model: 'LHT65',
      description: 'LoRaWAN Temperature & Humidity Sensor',
      firmware_version: 'v1.8',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          ext_temperature: { type: 'float', min: -55, max: 125, precision: 1, unit: '°C' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.8, humidity: 55, ext_temperature: 4.2, battery_voltage: 3.48, battery_level: 94 },
        alarm: { temperature: -30.0, humidity: 95, ext_temperature: -45.0, battery_voltage: 2.55, battery_level: 8 },
      },
    },
    {
      id: 'browan-tbhh100',
      name: 'TBHH100',
      manufacturer: 'Browan',
      category: 'temperature_humidity',
      model: 'TBHH100',
      description: 'Ambient Temperature & Humidity Sensor',
      firmware_version: 'v1.2',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 23.5, humidity: 48, battery_level: 96 },
        alarm: { temperature: 55.0, humidity: 95, battery_level: 96 },
      },
    },
    {
      id: 'tektelic-kona-home',
      name: 'KONA Home Sensor',
      manufacturer: 'Tektelic',
      category: 'temperature_humidity',
      model: 'KONA-HOME',
      description: 'Smart Home Temperature & Humidity Sensor',
      firmware_version: 'v3.1',
      default_fport: 10,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.0, humidity: 50, battery_voltage: 3.25, battery_level: 88 },
        alarm: { temperature: -38.0, humidity: 99, battery_voltage: 2.10, battery_level: 5 },
      },
    },
    {
      id: 'netvox-r718ab',
      name: 'R718AB',
      manufacturer: 'Netvox',
      category: 'temperature_humidity',
      model: 'R718AB',
      description: 'Wireless Temperature & Humidity Sensor',
      firmware_version: 'v2.0',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 21.5, humidity: 52, battery_voltage: 3.20, battery_level: 85 },
        alarm: { temperature: 80.0, humidity: 98, battery_voltage: 2.15, battery_level: 7 },
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_open: false, open_count: 142, last_open_duration: 8, battery_level: 88 },
        alarm: { door_open: true, open_count: 143, last_open_duration: 3600, battery_level: 88 },
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
          door_status: { type: 'enum', values: ['open', 'closed'] },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          tamper: { type: 'bool' },
        },
      },
      examples: {
        normal: { door_status: 'closed', battery_voltage: 3.2, battery_level: 85, tamper: false },
        alarm: { door_status: 'open', battery_voltage: 3.2, battery_level: 85, tamper: true },
      },
    },
    {
      id: 'milesight-ws101',
      name: 'WS101',
      manufacturer: 'Milesight',
      category: 'door',
      model: 'WS101',
      description: 'Smart Button / Door Sensor',
      firmware_version: 'v1.4',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', battery_level: 92 },
        alarm: { door_status: 'open', battery_level: 92 },
      },
    },
    {
      id: 'browan-tbdw100',
      name: 'TBDW100',
      manufacturer: 'Browan',
      category: 'door',
      model: 'TBDW100',
      description: 'Door/Window Sensor',
      firmware_version: 'v1.0',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_open: { type: 'bool' },
          open_count: { type: 'int', min: 0, max: 65535, increment: true },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_open: false, open_count: 88, battery_level: 94 },
        alarm: { door_open: true, open_count: 89, battery_level: 94 },
      },
    },

    // ============================================
    // Contact Sensors
    // ============================================
    {
      id: 'netvox-r311g',
      name: 'R311G',
      manufacturer: 'Netvox',
      category: 'contact',
      model: 'R311G',
      description: 'Wireless Light Sensor with Contact',
      firmware_version: 'v1.6',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          contact: { type: 'bool' },
          illuminance: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { contact: false, illuminance: 350, battery_voltage: 3.15, battery_level: 82 },
        alarm: { contact: true, illuminance: 0, battery_voltage: 3.15, battery_level: 82 },
      },
    },
    {
      id: 'tektelic-seal',
      name: 'SEAL',
      manufacturer: 'Tektelic',
      category: 'contact',
      model: 'SEAL',
      description: 'Smart Contact Sensor',
      firmware_version: 'v2.0',
      default_fport: 10,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          contact: { type: 'bool' },
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { contact: false, temperature: 22.5, battery_voltage: 3.30, battery_level: 90 },
        alarm: { contact: true, temperature: 22.5, battery_voltage: 3.30, battery_level: 90 },
      },
    },

    // ============================================
    // CO2 / Air Quality Sensors
    // ============================================
    {
      id: 'milesight-am319',
      name: 'AM319',
      manufacturer: 'Milesight',
      category: 'air_quality',
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 650, pm2_5: 12, pm10: 18, temperature: 23.5, humidity: 48, tvoc: 120, pressure: 1013.2, battery_level: 92 },
        alarm: { co2: 4500, pm2_5: 350, pm10: 450, temperature: 23.5, humidity: 48, tvoc: 50000, pressure: 1013.2, battery_level: 92 },
      },
    },
    {
      id: 'milesight-am307',
      name: 'AM307',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM307',
      description: '7-in-1 Indoor Air Quality Sensor',
      firmware_version: 'v1.1',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          tvoc: { type: 'int', min: 0, max: 60000, unit: 'ppb' },
          pressure: { type: 'float', min: 300, max: 1100, precision: 1, unit: 'hPa' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          pir: { type: 'enum', values: ['trigger', 'idle'] },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 520, temperature: 22.8, humidity: 50, tvoc: 85, pressure: 1015.0, light: 380, pir: 'idle', battery_level: 90 },
        alarm: { co2: 4800, temperature: 22.8, humidity: 50, tvoc: 55000, pressure: 1015.0, light: 0, pir: 'trigger', battery_level: 90 },
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
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 580, temperature: 22.1, humidity: 55, light: 320, battery_voltage: 3.38, battery_level: 92 },
        alarm: { co2: 5000, temperature: 22.1, humidity: 55, light: 320, battery_voltage: 2.20, battery_level: 12 },
      },
    },
    {
      id: 'elsys-ers-eye',
      name: 'ERS Eye',
      manufacturer: 'Elsys',
      category: 'air_quality',
      model: 'ERS-EYE',
      description: 'Occupancy sensor with air quality monitoring',
      firmware_version: 'v5.0',
      default_fport: 5,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'int', min: 0, max: 100, unit: '%' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          motion: { type: 'int', min: 0, max: 255 },
          co2: { type: 'int', min: 0, max: 10000, unit: 'ppm' },
          voc: { type: 'int', min: 0, max: 65535, unit: 'ppb' },
          occupancy: { type: 'int', min: 0, max: 255 },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.5, humidity: 48, light: 400, motion: 15, co2: 600, voc: 150, occupancy: 3, battery_voltage: 3.40, battery_level: 94 },
        alarm: { temperature: 22.5, humidity: 48, light: 0, motion: 0, co2: 4500, voc: 50000, occupancy: 0, battery_voltage: 2.15, battery_level: 8 },
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
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          sensor_flag: { type: 'bool' },
        },
      },
      examples: {
        normal: { distance: 250, battery_voltage: 3.45, battery_level: 92, sensor_flag: false },
        alarm: { distance: 25, battery_voltage: 3.45, battery_level: 92, sensor_flag: true },
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_leak: false, battery_voltage: 3.25, battery_level: 88 },
        alarm: { water_leak: true, battery_voltage: 3.25, battery_level: 88 },
      },
    },
    {
      id: 'milesight-em300-sld',
      name: 'EM300-SLD',
      manufacturer: 'Milesight',
      category: 'leak',
      model: 'EM300-SLD',
      description: 'Spot Leak Detection Sensor',
      firmware_version: 'v1.1',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_leak: { type: 'bool' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_leak: false, temperature: 23.0, humidity: 52, battery_level: 95 },
        alarm: { water_leak: true, temperature: 23.0, humidity: 85, battery_level: 95 },
      },
    },
    {
      id: 'dragino-llms01',
      name: 'LLMS01',
      manufacturer: 'Dragino',
      category: 'leak',
      model: 'LLMS01',
      description: 'LoRaWAN Leak & Level Monitoring Sensor',
      firmware_version: 'v1.2',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_leak: { type: 'bool' },
          water_level: { type: 'int', min: 0, max: 5000, unit: 'mm' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_leak: false, water_level: 0, battery_voltage: 3.40, battery_level: 90 },
        alarm: { water_leak: true, water_level: 250, battery_voltage: 3.40, battery_level: 90 },
      },
    },
    {
      id: 'browan-tbwh100',
      name: 'TBWH100',
      manufacturer: 'Browan',
      category: 'leak',
      model: 'TBWH100',
      description: 'Water Leak Detection Sensor',
      firmware_version: 'v1.0',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_leak: { type: 'bool' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_leak: false, battery_level: 96 },
        alarm: { water_leak: true, battery_level: 96 },
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          gps_fix: { type: 'bool' },
        },
      },
      examples: {
        normal: { latitude: 37.7749, longitude: -122.4194, altitude: 25, speed: 0, battery_level: 78, gps_fix: true },
        alarm: { latitude: 0, longitude: 0, altitude: 0, speed: 0, battery_level: 15, gps_fix: false },
      },
    },
    {
      id: 'browan-tblt100',
      name: 'TBLT100',
      manufacturer: 'Browan',
      category: 'gps',
      model: 'TBLT100',
      description: 'LoRaWAN GPS Tracker',
      firmware_version: 'v1.3',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          latitude: { type: 'float', min: -90, max: 90, precision: 6 },
          longitude: { type: 'float', min: -180, max: 180, precision: 6 },
          altitude: { type: 'int', min: -100, max: 10000, unit: 'm' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          gps_fix: { type: 'bool' },
        },
      },
      examples: {
        normal: { latitude: 40.7128, longitude: -74.006, altitude: 10, battery_level: 85, gps_fix: true },
        alarm: { latitude: 0, longitude: 0, altitude: 0, battery_level: 10, gps_fix: false },
      },
    },
    {
      id: 'milesight-at101',
      name: 'AT101',
      manufacturer: 'Milesight',
      category: 'gps',
      model: 'AT101',
      description: 'Asset Tracker with GPS/WiFi/BLE',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          latitude: { type: 'float', min: -90, max: 90, precision: 6 },
          longitude: { type: 'float', min: -180, max: 180, precision: 6 },
          altitude: { type: 'int', min: -100, max: 10000, unit: 'm' },
          speed: { type: 'float', min: 0, max: 200, precision: 1, unit: 'km/h' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          gps_fix: { type: 'bool' },
        },
      },
      examples: {
        normal: { latitude: 51.5074, longitude: -0.1278, altitude: 15, speed: 5.2, temperature: 22.0, battery_level: 72, gps_fix: true },
        alarm: { latitude: 0, longitude: 0, altitude: 0, speed: 0, temperature: -15.0, battery_level: 8, gps_fix: false },
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
        },
      },
      examples: {
        normal: { pulse_count: 123456, pulse_rate: 12.5, battery_level: 89, temperature: 22.5 },
        alarm: { pulse_count: 123456, pulse_rate: 0, battery_level: 5, temperature: -35 },
      },
    },
    {
      id: 'dragino-lsn50v2',
      name: 'LSN50v2',
      manufacturer: 'Dragino',
      category: 'meter',
      model: 'LSN50v2',
      description: 'LoRaWAN Sensor Node (Analog/Digital Inputs)',
      firmware_version: 'v1.4',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          adc_1: { type: 'float', min: 0, max: 30.0, precision: 2, unit: 'V' },
          adc_2: { type: 'float', min: 0, max: 30.0, precision: 2, unit: 'V' },
          digital_1: { type: 'bool' },
          temperature: { type: 'float', min: -55, max: 125, precision: 1, unit: '°C' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { adc_1: 2.45, adc_2: 0.82, digital_1: false, temperature: 24.5, battery_voltage: 3.50, battery_level: 95 },
        alarm: { adc_1: 28.5, adc_2: 0, digital_1: true, temperature: 24.5, battery_voltage: 2.55, battery_level: 8 },
      },
    },
    {
      id: 'netvox-r718n3',
      name: 'R718N3',
      manufacturer: 'Netvox',
      category: 'meter',
      model: 'R718N3',
      description: '3-Phase Current Meter',
      firmware_version: 'v1.2',
      default_fport: 6,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          current_1: { type: 'float', min: 0, max: 300, precision: 1, unit: 'A' },
          current_2: { type: 'float', min: 0, max: 300, precision: 1, unit: 'A' },
          current_3: { type: 'float', min: 0, max: 300, precision: 1, unit: 'A' },
          multiplier: { type: 'int', min: 1, max: 100 },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { current_1: 12.5, current_2: 11.8, current_3: 13.2, multiplier: 1, battery_voltage: 3.25, battery_level: 88 },
        alarm: { current_1: 280.0, current_2: 295.0, current_3: 260.0, multiplier: 1, battery_voltage: 3.25, battery_level: 88 },
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
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { motion_detected: false, motion_count: 856, temperature: 23.2, battery_level: 94 },
        alarm: { motion_detected: true, motion_count: 857, temperature: 23.2, battery_level: 94 },
      },
    },
    {
      id: 'milesight-vs121',
      name: 'VS121',
      manufacturer: 'Milesight',
      category: 'motion',
      model: 'VS121',
      description: 'AI Workplace Occupancy Sensor',
      firmware_version: 'v2.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          people_count_all: { type: 'int', min: 0, max: 255 },
          region_count: { type: 'int', min: 0, max: 8 },
          motion_detected: { type: 'bool' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { people_count_all: 5, region_count: 2, motion_detected: true, battery_level: 88 },
        alarm: { people_count_all: 50, region_count: 8, motion_detected: true, battery_level: 88 },
      },
    },
    {
      id: 'tektelic-kona-pir',
      name: 'KONA PIR',
      manufacturer: 'Tektelic',
      category: 'motion',
      model: 'KONA-PIR',
      description: 'PIR Motion Detector',
      firmware_version: 'v2.1',
      default_fport: 10,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          motion_detected: { type: 'bool' },
          motion_count: { type: 'int', min: 0, max: 65535, increment: true },
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { motion_detected: false, motion_count: 1200, temperature: 22.0, humidity: 48, battery_voltage: 3.20, battery_level: 85 },
        alarm: { motion_detected: true, motion_count: 1201, temperature: 22.0, humidity: 48, battery_voltage: 3.20, battery_level: 85 },
      },
    },

    // ============================================
    // Combo Sensors (door + temp/humidity)
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
          door_status: { type: 'enum', values: ['open', 'closed'] },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', temperature: 4.2, humidity: 65, battery_level: 91 },
        alarm: { door_status: 'open', temperature: 25.0, humidity: 65, battery_level: 91 },
      },
    },
    {
      id: 'milesight-em300-di',
      name: 'EM300-DI',
      manufacturer: 'Milesight',
      category: 'combo',
      model: 'EM300-DI',
      description: 'Magnetic Contact Switch with Temperature & Humidity',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', temperature: 3.8, humidity: 70, battery_level: 93 },
        alarm: { door_status: 'open', temperature: 28.0, humidity: 70, battery_level: 93 },
      },
    },
    {
      id: 'dragino-lse01',
      name: 'LSE01',
      manufacturer: 'Dragino',
      category: 'combo',
      model: 'LSE01',
      description: 'Soil Moisture & Temperature Sensor',
      firmware_version: 'v1.2',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          soil_moisture: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          soil_temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          soil_conductivity: { type: 'int', min: 0, max: 10000, unit: 'µS/cm' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { soil_moisture: 35.0, soil_temperature: 18.5, soil_conductivity: 450, battery_voltage: 3.42, battery_level: 91 },
        alarm: { soil_moisture: 5.0, soil_temperature: -20.0, soil_conductivity: 50, battery_voltage: 2.60, battery_level: 10 },
      },
    },

    // ============================================
    // Multi-Sensors
    // ============================================
    {
      id: 'dragino-lsn50v2-s31',
      name: 'LSN50v2-S31',
      manufacturer: 'Dragino',
      category: 'multi_sensor',
      model: 'LSN50v2-S31',
      description: 'Multi-sensor: Temperature, Humidity, Light',
      firmware_version: 'v1.3',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 80, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          battery_voltage: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 23.0, humidity: 50, light: 420, battery_voltage: 3.45, battery_level: 93 },
        alarm: { temperature: -35.0, humidity: 95, light: 0, battery_voltage: 2.55, battery_level: 8 },
      },
    },
    {
      id: 'elsys-ems',
      name: 'EMS',
      manufacturer: 'Elsys',
      category: 'multi_sensor',
      model: 'EMS',
      description: 'Multi-sensor: Temperature, Humidity, Acceleration',
      firmware_version: 'v5.0',
      default_fport: 5,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'int', min: 0, max: 100, unit: '%' },
          acceleration_x: { type: 'float', min: -16, max: 16, precision: 2, unit: 'g' },
          acceleration_y: { type: 'float', min: -16, max: 16, precision: 2, unit: 'g' },
          acceleration_z: { type: 'float', min: -16, max: 16, precision: 2, unit: 'g' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.5, humidity: 50, acceleration_x: 0.01, acceleration_y: -0.02, acceleration_z: 1.0, battery_voltage: 3.35, battery_level: 90 },
        alarm: { temperature: 55.0, humidity: 95, acceleration_x: 5.0, acceleration_y: -8.0, acceleration_z: 12.0, battery_voltage: 2.15, battery_level: 8 },
      },
    },
    {
      id: 'tektelic-comfort',
      name: 'COMFORT',
      manufacturer: 'Tektelic',
      category: 'multi_sensor',
      model: 'COMFORT',
      description: 'Multi-sensor: Temp, Humidity, Light, PIR, Pressure',
      firmware_version: 'v3.0',
      default_fport: 10,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          light: { type: 'int', min: 0, max: 65535, unit: 'lux' },
          pressure: { type: 'float', min: 300, max: 1100, precision: 1, unit: 'hPa' },
          motion_detected: { type: 'bool' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.8, humidity: 48, light: 350, pressure: 1013.5, motion_detected: false, battery_voltage: 3.20, battery_level: 85 },
        alarm: { temperature: -38.0, humidity: 99, light: 0, pressure: 950.0, motion_detected: true, battery_voltage: 2.10, battery_level: 5 },
      },
    },
    {
      id: 'milesight-em500-smtc',
      name: 'EM500-SMTC',
      manufacturer: 'Milesight',
      category: 'multi_sensor',
      model: 'EM500-SMTC',
      description: 'Soil Moisture, Temperature & Conductivity',
      firmware_version: 'v1.1',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          soil_moisture: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          soil_conductivity: { type: 'int', min: 0, max: 20000, unit: 'µS/cm' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { soil_moisture: 38.5, temperature: 20.0, soil_conductivity: 520, battery_level: 88 },
        alarm: { soil_moisture: 2.0, temperature: -25.0, soil_conductivity: 10, battery_level: 88 },
      },
    },
    {
      id: 'milesight-em310-udl',
      name: 'EM310-UDL',
      manufacturer: 'Milesight',
      category: 'multi_sensor',
      model: 'EM310-UDL',
      description: 'Ultrasonic Distance / Level Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          distance: { type: 'int', min: 25, max: 4500, unit: 'mm' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { distance: 1200, temperature: 22.5, battery_level: 92 },
        alarm: { distance: 30, temperature: 22.5, battery_level: 92 },
      },
    },
  ],
};
