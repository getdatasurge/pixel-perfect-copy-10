/**
 * Default Device Library
 *
 * Contains 40 LoRaWAN device definitions matching the FreshTrack Pro spec.
 * Field names use FreshTrack canonical names:
 *   battery_level (0-100%), battery_voltage (V), temperature (°C),
 *   humidity (%), door_status ('open'|'closed'), door_open (bool), etc.
 * Dragino aliases (TempC_SHT, Hum_SHT, BatV, DOOR_OPEN_STATUS) are
 * resolved at payload generation time in freshtrackExport.ts.
 */

import type { DeviceLibrary } from './types';

export const defaultDeviceLibrary: DeviceLibrary = {
  metadata: {
    version: '3.0.0',
    last_updated: '2026-02-16',
    categories: [
      'temperature', 'temperature_humidity', 'door', 'contact',
      'leak', 'gps', 'meter', 'motion', 'air_quality',
      'multi_sensor',
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
      id: 'milesight-em500-pt100',
      name: 'EM500-PT100',
      manufacturer: 'Milesight',
      category: 'temperature',
      model: 'EM500-PT100',
      description: 'Industrial Temperature Sensor (PT100 Probe)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          temperature: { type: 'float', min: -200, max: 800, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { temperature: 22.0, battery_level: 90 },
        alarm: { temperature: 350.0, battery_level: 90 },
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
          TempC_SHT: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C', description: 'SHT temperature' },
          Hum_SHT: { type: 'float', min: 0, max: 100, precision: 1, unit: '%', description: 'SHT humidity' },
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { TempC_SHT: 23.1, Hum_SHT: 50.0, BatV: 3.40, battery_level: 92 },
        alarm: { TempC_SHT: 80.0, Hum_SHT: 10.0, BatV: 2.60, battery_level: 12 },
      },
    },
    {
      id: 'dragino-lsn50v2-d23',
      name: 'LSN50v2-D23',
      manufacturer: 'Dragino',
      category: 'temperature',
      model: 'LSN50v2-D23',
      description: 'LoRaWAN Sensor Node with DS18B20 Temperature Probe',
      firmware_version: 'v1.4',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          TempC_DS: { type: 'float', min: -55, max: 125, precision: 1, unit: '°C', description: 'DS18B20 temperature' },
          TempC_SHT: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C', description: 'SHT temperature' },
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { TempC_DS: 4.2, TempC_SHT: 22.8, BatV: 3.48, battery_level: 94 },
        alarm: { TempC_DS: -45.0, TempC_SHT: -30.0, BatV: 2.55, battery_level: 8 },
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
          TempC_SHT: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C', description: 'SHT temperature' },
          Hum_SHT: { type: 'float', min: 0, max: 100, precision: 1, unit: '%', description: 'SHT humidity' },
          TempC_DS: { type: 'float', min: -55, max: 125, precision: 1, unit: '°C', description: 'External DS18B20' },
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { TempC_SHT: 22.8, Hum_SHT: 55.0, TempC_DS: 4.2, BatV: 3.48, battery_level: 94 },
        alarm: { TempC_SHT: -30.0, Hum_SHT: 95.0, TempC_DS: -45.0, BatV: 2.55, battery_level: 8 },
      },
    },
    {
      id: 'dragino-lht65n',
      name: 'LHT65N',
      manufacturer: 'Dragino',
      category: 'temperature_humidity',
      model: 'LHT65N',
      description: 'LoRaWAN Temperature & Humidity Sensor (New Version)',
      firmware_version: 'v1.9',
      default_fport: 2,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          TempC_SHT: { type: 'float', min: -40, max: 85, precision: 1, unit: '°C', description: 'SHT temperature' },
          Hum_SHT: { type: 'float', min: 0, max: 100, precision: 1, unit: '%', description: 'SHT humidity' },
          TempC_DS: { type: 'float', min: -55, max: 125, precision: 1, unit: '°C', description: 'External probe' },
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { TempC_SHT: 23.0, Hum_SHT: 52.0, TempC_DS: 4.5, BatV: 3.50, battery_level: 95 },
        alarm: { TempC_SHT: -28.0, Hum_SHT: 96.0, TempC_DS: -42.0, BatV: 2.52, battery_level: 7 },
      },
    },
    {
      id: 'generic-tbs220',
      name: 'TBS220',
      manufacturer: '',
      category: 'gps',
      model: 'TBS220',
      description: 'GPS Tracker',
      firmware_version: 'v1.2',
      default_fport: 102,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          gps_lat: { type: 'float', min: -90, max: 90, precision: 4 },
          gps_lon: { type: 'float', min: -180, max: 180, precision: 4 },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { gps: { lat: 40.7128, lon: -74.0060 }, battery_level: 80 },
        alarm: { gps: { lat: 0, lon: 0 }, battery_level: 10 },
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
          DOOR_OPEN_STATUS: { type: 'enum', values: ['open', 'closed'], description: 'Dragino door status' },
          open_count: { type: 'int', min: 0, max: 65535, increment: true },
          last_open_duration: { type: 'int', min: 0, max: 65535, unit: 'sec' },
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { DOOR_OPEN_STATUS: 'closed', open_count: 142, last_open_duration: 8, BatV: 3.40, battery_level: 88 },
        alarm: { DOOR_OPEN_STATUS: 'open', open_count: 143, last_open_duration: 3600, BatV: 3.40, battery_level: 88 },
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
          door: { type: 'bool', description: 'true = open, false = closed' },
          battery_voltage: { type: 'float', min: 2.0, max: 3.6, precision: 2, unit: 'V' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door: false, battery_voltage: 3.0, battery_level: 85 },
        alarm: { door: true, battery_voltage: 3.0, battery_level: 85 },
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
      id: 'milesight-ws301',
      name: 'WS301',
      manufacturer: 'Milesight',
      category: 'door',
      model: 'WS301',
      description: 'Magnetic Contact Switch',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', battery_level: 94 },
        alarm: { door_status: 'open', battery_level: 94 },
      },
    },
    {
      id: 'milesight-ws302',
      name: 'WS302',
      manufacturer: 'Milesight',
      category: 'door',
      model: 'WS302',
      description: 'Door Magnetic Contact Switch',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', battery_level: 93 },
        alarm: { door_status: 'open', battery_level: 93 },
      },
    },
    {
      id: 'milesight-ws156',
      name: 'WS156',
      manufacturer: 'Milesight',
      category: 'door',
      model: 'WS156',
      description: 'Magnetic Contact Switch with Temperature',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', temperature: 22.0, battery_level: 90 },
        alarm: { door_status: 'open', temperature: 22.0, battery_level: 90 },
      },
    },
    {
      id: 'generic-ds3604',
      name: 'DS3604',
      manufacturer: '',
      category: 'door',
      model: 'DS3604',
      description: 'Door Contact Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          door_status: { type: 'enum', values: ['open', 'closed'] },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { door_status: 'closed', battery_level: 91 },
        alarm: { door_status: 'open', battery_level: 91 },
      },
    },

    // ============================================
    // CO2 / Air Quality Sensors
    // ============================================
    {
      id: 'elsys-ers-co2',
      name: 'ERS CO2',
      manufacturer: 'Elsys',
      category: 'air_quality',
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
      id: 'milesight-am103',
      name: 'AM103',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM103',
      description: '3-in-1 Indoor Air Quality Sensor (CO2/Temp/Humidity)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 550, temperature: 22.5, humidity: 50, battery_level: 90 },
        alarm: { co2: 4800, temperature: 22.5, humidity: 50, battery_level: 90 },
      },
    },
    {
      id: 'milesight-am104',
      name: 'AM104',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM104',
      description: '4-in-1 Indoor Air Quality Sensor (CO2/Temp/Humidity/Pressure)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          pressure: { type: 'float', min: 300, max: 1100, precision: 1, unit: 'hPa' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 520, temperature: 23.0, humidity: 48, pressure: 1013.5, battery_level: 91 },
        alarm: { co2: 4600, temperature: 23.0, humidity: 48, pressure: 1013.5, battery_level: 91 },
      },
    },
    {
      id: 'milesight-am107',
      name: 'AM107',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM107',
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
      id: 'milesight-am308',
      name: 'AM308',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM308',
      description: '8-in-1 Indoor Air Quality Sensor',
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
        normal: { co2: 600, pm2_5: 15, pm10: 22, temperature: 23.0, humidity: 47, tvoc: 100, pressure: 1014.0, battery_level: 93 },
        alarm: { co2: 4600, pm2_5: 380, pm10: 420, temperature: 23.0, humidity: 47, tvoc: 45000, pressure: 1014.0, battery_level: 93 },
      },
    },
    {
      id: 'milesight-am103l',
      name: 'AM103L',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM103L',
      description: '3-in-1 Indoor Air Quality Sensor (Lite)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 560, temperature: 22.0, humidity: 51, battery_level: 92 },
        alarm: { co2: 4900, temperature: 22.0, humidity: 51, battery_level: 92 },
      },
    },
    {
      id: 'milesight-am104l',
      name: 'AM104L',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM104L',
      description: '4-in-1 Indoor Air Quality Sensor (Lite)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          co2: { type: 'int', min: 400, max: 5000, unit: 'ppm' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          humidity: { type: 'float', min: 0, max: 100, precision: 1, unit: '%' },
          pressure: { type: 'float', min: 300, max: 1100, precision: 1, unit: 'hPa' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { co2: 530, temperature: 22.5, humidity: 49, pressure: 1012.8, battery_level: 89 },
        alarm: { co2: 4700, temperature: 22.5, humidity: 49, pressure: 1012.8, battery_level: 89 },
      },
    },
    {
      id: 'milesight-am107l',
      name: 'AM107L',
      manufacturer: 'Milesight',
      category: 'air_quality',
      model: 'AM107L',
      description: '7-in-1 Indoor Air Quality Sensor (Lite)',
      firmware_version: 'v1.0',
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
        normal: { co2: 540, temperature: 22.6, humidity: 50, tvoc: 90, pressure: 1014.5, light: 400, pir: 'idle', battery_level: 88 },
        alarm: { co2: 4700, temperature: 22.6, humidity: 50, tvoc: 52000, pressure: 1014.5, light: 0, pir: 'trigger', battery_level: 88 },
      },
    },

    // ============================================
    // Leak / Water Level Sensors
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
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
          sensor_flag: { type: 'bool' },
        },
      },
      examples: {
        normal: { distance: 250, BatV: 3.45, battery_level: 92, sensor_flag: false },
        alarm: { distance: 25, BatV: 3.45, battery_level: 92, sensor_flag: true },
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
      id: 'milesight-em500-swl',
      name: 'EM500-SWL',
      manufacturer: 'Milesight',
      category: 'leak',
      model: 'EM500-SWL',
      description: 'Submersible Water Level Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_level: { type: 'int', min: 0, max: 5000, unit: 'mm' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_level: 1200, temperature: 18.5, battery_level: 90 },
        alarm: { water_level: 4800, temperature: 18.5, battery_level: 90 },
      },
    },
    {
      id: 'milesight-em500-swl-l050',
      name: 'EM500-SWL-L050',
      manufacturer: 'Milesight',
      category: 'leak',
      model: 'EM500-SWL-L050',
      description: 'Submersible Water Level Sensor (Extended Cable)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          water_level: { type: 'int', min: 0, max: 5000, unit: 'mm' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { water_level: 1500, temperature: 19.0, battery_level: 88 },
        alarm: { water_level: 4900, temperature: 19.0, battery_level: 88 },
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

    // ============================================
    // Meters / Industrial
    // ============================================
    {
      id: 'tektelic-kona-pulse',
      name: 'KONA Pulse Counter',
      manufacturer: 'Tektelic',
      category: 'meter',
      model: 'KONA Pulse Counter',
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
      category: 'temperature',
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
          BatV: { type: 'float', min: 2.5, max: 3.6, precision: 2, unit: 'V', description: 'Battery voltage' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { adc_1: 2.45, adc_2: 0.82, digital_1: false, temperature: 24.5, BatV: 3.50, battery_level: 95 },
        alarm: { adc_1: 28.5, adc_2: 0, digital_1: true, temperature: 24.5, BatV: 2.55, battery_level: 8 },
      },
    },
    {
      id: 'milesight-em500-pp',
      name: 'EM500-PP',
      manufacturer: 'Milesight',
      category: 'meter',
      model: 'EM500-PP',
      description: 'Pipe Pressure Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          pressure: { type: 'float', min: 0, max: 3600, precision: 1, unit: 'kPa' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { pressure: 250.5, temperature: 22.0, battery_level: 92 },
        alarm: { pressure: 3500.0, temperature: 22.0, battery_level: 92 },
      },
    },
    {
      id: 'milesight-em500-pp-l050',
      name: 'EM500-PP-L050',
      manufacturer: 'Milesight',
      category: 'meter',
      model: 'EM500-PP-L050',
      description: 'Pipe Pressure Sensor (Extended Cable)',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          pressure: { type: 'float', min: 0, max: 3600, precision: 1, unit: 'kPa' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { pressure: 280.0, temperature: 21.5, battery_level: 91 },
        alarm: { pressure: 3400.0, temperature: 21.5, battery_level: 91 },
      },
    },
    {
      id: 'milesight-em500-udl',
      name: 'EM500-UDL',
      manufacturer: 'Milesight',
      category: 'temperature',
      model: 'EM500-UDL',
      description: 'Ultrasonic Distance/Level Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          distance: { type: 'int', min: 25, max: 3500, unit: 'mm' },
          temperature: { type: 'float', min: -30, max: 70, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { distance: 1500, temperature: 22.0, battery_level: 90 },
        alarm: { distance: 30, temperature: 22.0, battery_level: 90 },
      },
    },

    // ============================================
    // Motion / Occupancy Sensors
    // ============================================
    {
      id: 'milesight-tbms100',
      name: 'TBMS100',
      manufacturer: 'Milesight',
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
      id: 'milesight-ws303',
      name: 'WS303',
      manufacturer: 'Milesight',
      category: 'temperature',
      model: 'WS303',
      description: 'PIR Motion Sensor',
      firmware_version: 'v1.0',
      default_fport: 85,
      payload_format: 'json',
      simulation_profile: {
        fields: {
          motion_detected: { type: 'bool' },
          temperature: { type: 'float', min: -20, max: 60, precision: 1, unit: '°C' },
          battery_level: { type: 'int', min: 0, max: 100, unit: '%' },
        },
      },
      examples: {
        normal: { motion_detected: false, temperature: 22.5, battery_level: 91 },
        alarm: { motion_detected: true, temperature: 22.5, battery_level: 91 },
      },
    },

    // ============================================
    // Multi-Sensors (door + temp/humidity combos)
    // ============================================
    {
      id: 'milesight-em300-mcs',
      name: 'EM300-MCS',
      manufacturer: 'Milesight',
      category: 'multi_sensor',
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
      id: 'milesight-em300-mcs-l050',
      name: 'EM300-MCS-L050',
      manufacturer: 'Milesight',
      category: 'multi_sensor',
      model: 'EM300-MCS-L050',
      description: 'Magnetic Contact Switch with Temperature (Extended Cable)',
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
        normal: { door_status: 'closed', temperature: 3.8, humidity: 68, battery_level: 89 },
        alarm: { door_status: 'open', temperature: 26.0, humidity: 68, battery_level: 89 },
      },
    },

    // ============================================
    // Multi-Sensors
    // ============================================
    {
      id: 'milesight-em500-smtc',
      name: 'EM500-SMTC',
      manufacturer: 'Milesight',
      category: 'temperature',
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
