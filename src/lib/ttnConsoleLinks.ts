/**
 * TTN Console Deep Link Utilities
 * 
 * Generates URLs to specific pages in The Things Network Console
 * to help users create API keys with the right permissions.
 */

/**
 * Get URL to create a Personal API Key in TTN Console
 */
export function getPersonalApiKeyUrl(cluster: string): string {
  return `https://${cluster}.cloud.thethings.network/console/user/api-keys/add`;
}

/**
 * Get URL to create an Organization API Key in TTN Console
 */
export function getOrganizationApiKeyUrl(cluster: string, orgId: string): string {
  return `https://${cluster}.cloud.thethings.network/console/organizations/${orgId}/api-keys/add`;
}

/**
 * Get URL to the API Keys list page for a user
 */
export function getPersonalApiKeysListUrl(cluster: string): string {
  return `https://${cluster}.cloud.thethings.network/console/user/api-keys`;
}

/**
 * Get URL to the API Keys list page for an organization
 */
export function getOrganizationApiKeysListUrl(cluster: string, orgId: string): string {
  return `https://${cluster}.cloud.thethings.network/console/organizations/${orgId}/api-keys`;
}

/**
 * Get the appropriate API Key creation URL based on owner type
 */
export function getGatewayApiKeyUrl(
  cluster: string, 
  ownerType: 'user' | 'organization', 
  ownerId?: string
): string {
  if (ownerType === 'organization' && ownerId) {
    return getOrganizationApiKeyUrl(cluster, ownerId);
  }
  return getPersonalApiKeyUrl(cluster);
}

/**
 * Get a descriptive label for the key type the user should create
 */
export function getKeyTypeLabel(ownerType: 'user' | 'organization'): string {
  return ownerType === 'organization' ? 'Organization API Key' : 'Personal API Key';
}

/**
 * Get the required gateway permissions as a formatted string
 */
export const GATEWAY_PERMISSIONS = ['gateways:read', 'gateways:write'];

/**
 * Instructions for creating a gateway API key
 */
export function getGatewayKeyInstructions(ownerType: 'user' | 'organization'): string[] {
  const location = ownerType === 'organization' 
    ? 'Organization → API Keys' 
    : 'User Settings → API Keys';
  
  return [
    `Go to TTN Console → ${location}`,
    'Click "Add API key"',
    'Select permissions: gateways:read, gateways:write',
    'Click "Create API key" and copy the generated key',
    'Paste the key in the Gateway API Key field above',
  ];
}

/**
 * Parse TTN Organization ID from a TTN Console URL
 * 
 * Examples:
 * - https://nam1.cloud.thethings.network/console/organizations/frostguard/overview
 * - https://eu1.cloud.thethings.network/console/organizations/my-org/api-keys
 * 
 * Returns: { cluster: string, orgId: string } | null
 */
export function parseOrgFromUrl(url: string): { cluster: string; orgId: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    
    // Extract cluster from hostname (e.g., nam1.cloud.thethings.network)
    const clusterMatch = host.match(/^(?:console\.)?(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (!clusterMatch) return null;
    
    const cluster = clusterMatch[1];
    
    // Extract org ID from path (e.g., /console/organizations/frostguard/...)
    const pathMatch = parsed.pathname.match(/\/console\/organizations\/([^\/]+)/);
    if (!pathMatch) return null;
    
    const orgId = pathMatch[1];
    
    return { cluster, orgId };
  } catch {
    return null;
  }
}

/**
 * Parse TTN username from a TTN Console URL
 * 
 * Examples:
 * - https://nam1.cloud.thethings.network/console/user/api-keys
 * 
 * Returns: { cluster: string } | null (username is implicit - it's the logged in user)
 */
export function parseUserFromUrl(url: string): { cluster: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    
    // Extract cluster from hostname
    const clusterMatch = host.match(/^(?:console\.)?(nam1|eu1|au1)\.cloud\.thethings\.network$/);
    if (!clusterMatch) return null;
    
    // Check if it's a user path
    if (!parsed.pathname.includes('/console/user')) return null;
    
    return { cluster: clusterMatch[1] };
  } catch {
    return null;
  }
}
