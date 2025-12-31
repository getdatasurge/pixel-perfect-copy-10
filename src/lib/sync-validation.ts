export interface ValidationResult {
  isValid: boolean;
  blockingErrors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  label: string;
  fieldPath: string;
  message: string;
  section: 'context' | 'gateways' | 'devices';
}

function isValidHex(value: string | undefined | null, length: number): boolean {
  if (!value) return false;
  return new RegExp(`^[A-Fa-f0-9]{${length}}$`).test(value);
}

function isValidUUID(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateSyncBundle(
  context: { org_id?: string; site_id?: string; selected_user_id?: string },
  gateways: Array<{ id: string; name: string; eui: string }>,
  devices: Array<{ id: string; name: string; dev_eui: string; join_eui: string; app_key: string; type: string }>
): ValidationResult {
  const blockingErrors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Context validation
  if (!context.org_id?.trim()) {
    blockingErrors.push({
      code: 'ORG_ID_MISSING',
      label: 'Organization ID',
      fieldPath: 'context.org_id',
      message: 'Organization ID is required. Select a user or enter an Organization ID.',
      section: 'context',
    });
  } else if (!isValidUUID(context.org_id)) {
    blockingErrors.push({
      code: 'ORG_ID_INVALID',
      label: 'Organization ID',
      fieldPath: 'context.org_id',
      message: 'Organization ID must be a valid UUID.',
      section: 'context',
    });
  }

  if (!context.site_id?.trim()) {
    warnings.push({
      code: 'SITE_ID_MISSING',
      label: 'Site ID',
      fieldPath: 'context.site_id',
      message: 'Site ID not set. Sync will use org-level context only.',
      section: 'context',
    });
  }

  // Gateway validation
  gateways.forEach((gw, i) => {
    if (!gw.name?.trim()) {
      blockingErrors.push({
        code: 'GATEWAY_NAME_MISSING',
        label: `Gateway ${i + 1}: Name`,
        fieldPath: `gateways[${i}].name`,
        message: 'Gateway name is required.',
        section: 'gateways',
      });
    }
    if (!isValidHex(gw.eui, 16)) {
      blockingErrors.push({
        code: 'GATEWAY_EUI_INVALID',
        label: `Gateway ${i + 1}: EUI`,
        fieldPath: `gateways[${i}].eui`,
        message: `Gateway EUI must be 16 hex characters. Got: ${gw.eui?.length || 0}`,
        section: 'gateways',
      });
    }
  });

  // Device validation
  devices.forEach((dev, i) => {
    if (!dev.name?.trim()) {
      blockingErrors.push({
        code: 'DEVICE_NAME_MISSING',
        label: `Device ${i + 1}: Name`,
        fieldPath: `devices[${i}].name`,
        message: 'Device name is required.',
        section: 'devices',
      });
    }
    if (!isValidHex(dev.dev_eui, 16)) {
      blockingErrors.push({
        code: 'DEVICE_DEV_EUI_INVALID',
        label: `Device ${i + 1}: DevEUI`,
        fieldPath: `devices[${i}].dev_eui`,
        message: `DevEUI must be 16 hex characters.`,
        section: 'devices',
      });
    }
    if (!isValidHex(dev.join_eui, 16)) {
      blockingErrors.push({
        code: 'DEVICE_JOIN_EUI_INVALID',
        label: `Device ${i + 1}: JoinEUI`,
        fieldPath: `devices[${i}].join_eui`,
        message: `JoinEUI must be 16 hex characters.`,
        section: 'devices',
      });
    }
    if (!isValidHex(dev.app_key, 32)) {
      blockingErrors.push({
        code: 'DEVICE_APP_KEY_INVALID',
        label: `Device ${i + 1}: AppKey`,
        fieldPath: `devices[${i}].app_key`,
        message: `AppKey must be 32 hex characters.`,
        section: 'devices',
      });
    }
  });

  return {
    isValid: blockingErrors.length === 0,
    blockingErrors,
    warnings,
  };
}
