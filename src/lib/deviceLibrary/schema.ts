/**
 * Device Library Validation Schema
 *
 * Zod schemas for validating device library JSON structure.
 */

import { z } from 'zod';

// ============================================
// Field Configuration Schemas
// ============================================

const floatFieldSchema = z.object({
  type: z.literal('float'),
  min: z.number(),
  max: z.number(),
  precision: z.number().int().min(0).max(10).optional(),
  increment: z.boolean().optional(),
  static: z.boolean().optional(),
  default: z.number().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

const intFieldSchema = z.object({
  type: z.literal('int'),
  min: z.number(),
  max: z.number(),
  precision: z.number().int().min(0).max(10).optional(),
  increment: z.boolean().optional(),
  static: z.boolean().optional(),
  default: z.number().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

const boolFieldSchema = z.object({
  type: z.literal('bool'),
  static: z.boolean().optional(),
  default: z.boolean().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

const enumFieldSchema = z.object({
  type: z.literal('enum'),
  values: z.array(z.string()).min(1, 'enum must have at least one value'),
  static: z.boolean().optional(),
  default: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

const stringFieldSchema = z.object({
  type: z.literal('string'),
  static: z.boolean().optional(),
  default: z.string().optional(),
  pattern: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

const fieldConfigSchema = z.discriminatedUnion('type', [
  floatFieldSchema,
  intFieldSchema,
  boolFieldSchema,
  enumFieldSchema,
  stringFieldSchema,
]);

// ============================================
// Simulation Profile Schema
// ============================================

const simulationProfileSchema = z.object({
  fields: z.record(z.string(), fieldConfigSchema).refine(
    data => Object.keys(data).length > 0,
    { message: 'simulation_profile must have at least one field' }
  ),
});

// ============================================
// Device Examples Schema
// ============================================

const deviceExamplesSchema = z.object({
  normal: z.record(z.string(), z.unknown()),
  alarm: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// Device Category
// ============================================

const deviceCategorySchema = z.enum([
  'temperature',
  'temperature_humidity',
  'door',
  'contact',
  'co2',
  'leak',
  'gps',
  'meter',
  'motion',
  'air_quality',
  'combo',
  'multi_sensor',
]);

// ============================================
// Device Definition Schema
// ============================================

const deviceDefinitionSchema = z.object({
  id: z.string()
    .min(1, 'device id is required')
    .regex(/^[a-z0-9-]+$/, 'device id must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1, 'device name is required'),
  manufacturer: z.string().min(1, 'manufacturer is required'),
  category: deviceCategorySchema,
  default_fport: z.number().int().min(1).max(255),
  payload_format: z.enum(['json', 'cayenne', 'custom']),
  simulation_profile: simulationProfileSchema,
  examples: deviceExamplesSchema,
  description: z.string().optional(),
  firmware_version: z.string().optional(),
  model: z.string().optional(),
});

// ============================================
// Library Metadata Schema
// ============================================

const libraryMetadataSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver format (e.g., 1.0.0)'),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_updated must be YYYY-MM-DD format'),
  categories: z.array(deviceCategorySchema),
  manufacturers: z.array(z.string()),
});

// ============================================
// Complete Device Library Schema
// ============================================

export const deviceLibrarySchema = z.object({
  metadata: libraryMetadataSchema,
  devices: z.array(deviceDefinitionSchema).min(1, 'library must have at least one device'),
}).refine(data => {
  // Validate that all devices have unique IDs
  const ids = data.devices.map(d => d.id);
  const uniqueIds = new Set(ids);
  return ids.length === uniqueIds.size;
}, {
  message: 'all device ids must be unique',
  path: ['devices'],
}).refine(data => {
  // Validate that all device categories are in metadata.categories
  const metaCategories = new Set(data.metadata.categories);
  return data.devices.every(d => metaCategories.has(d.category));
}, {
  message: 'all device categories must be listed in metadata.categories',
  path: ['devices'],
}).refine(data => {
  // Validate that all device manufacturers are in metadata.manufacturers
  const metaManufacturers = new Set(data.metadata.manufacturers);
  return data.devices.every(d => metaManufacturers.has(d.manufacturer));
}, {
  message: 'all device manufacturers must be listed in metadata.manufacturers',
  path: ['devices'],
});

// ============================================
// Validation Functions
// ============================================

import type { DeviceLibrary, ValidationResult, ValidationError, ValidationWarning } from './types';

/**
 * Validate a device library JSON object.
 */
export function validateDeviceLibrary(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  const result = deviceLibrarySchema.safeParse(json);
  
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      });
    }
    return { valid: false, errors, warnings };
  }
  
  const library = result.data as DeviceLibrary;
  
  // Additional semantic validations (warnings)
  for (const device of library.devices) {
    // Check if examples.normal has all simulation_profile fields
    const profileFields = Object.keys(device.simulation_profile.fields);
    const exampleFields = Object.keys(device.examples.normal);
    
    for (const field of profileFields) {
      if (!exampleFields.includes(field)) {
        warnings.push({
          path: `devices.${device.id}.examples.normal`,
          message: `Missing field '${field}' in normal example`,
          suggestion: `Add '${field}' to examples.normal for completeness`,
        });
      }
    }
    
    // Check if alarm example has relevant fields
    if (device.examples.alarm) {
      const alarmFields = Object.keys(device.examples.alarm);
      if (alarmFields.length === 0) {
        warnings.push({
          path: `devices.${device.id}.examples.alarm`,
          message: 'Alarm example is empty',
          suggestion: 'Add alarm-specific field values or remove the alarm example',
        });
      }
    }
  }
  
  return { valid: true, errors, warnings };
}

/**
 * Parse and validate a JSON string as a device library.
 */
export function parseDeviceLibrary(jsonString: string): { library: DeviceLibrary | null; result: ValidationResult } {
  let json: unknown;
  
  try {
    json = JSON.parse(jsonString);
  } catch (e) {
    return {
      library: null,
      result: {
        valid: false,
        errors: [{
          path: '',
          message: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
          code: 'json_parse_error',
        }],
        warnings: [],
      },
    };
  }
  
  const result = validateDeviceLibrary(json);
  
  if (result.valid) {
    return { library: json as DeviceLibrary, result };
  }
  
  return { library: null, result };
}
