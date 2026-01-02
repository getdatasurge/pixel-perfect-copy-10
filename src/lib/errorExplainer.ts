// Error Explainer for Emulator Debug Terminal
// Provides deterministic, actionable explanations for common errors

import { DebugEntry, DebugCategory, getEntries } from './debugLogger';

export interface ErrorExplanation {
  whatHappened: string;
  mostLikelyCause: string;
  whatToDoNext: string[];
  relatedLogFilters: {
    categories: DebugCategory[];
    searchTerms: string[];
  };
  severity: 'critical' | 'warning' | 'info';
  documentationLink?: string;
}

interface ErrorPattern {
  id: string;
  match: (entry: DebugEntry) => boolean;
  explain: (entry: DebugEntry) => ErrorExplanation;
}

// Emulator-specific error patterns
const ERROR_PATTERNS: ErrorPattern[] = [
  // org-state-api 401 - Auth failure
  {
    id: 'org-state-401',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('401') || data.includes('401') || data.includes('unauthorized')) &&
             (msg.includes('org-state') || msg.includes('fetch-org-state') || entry.category === 'org-sync');
    },
    explain: () => ({
      whatHappened: 'FrostGuard rejected the sync request with a 401 Unauthorized error.',
      mostLikelyCause: 'The PROJECT2_SYNC_API_KEY secret is either missing, incorrect, or has been revoked in FrostGuard.',
      whatToDoNext: [
        'Verify PROJECT2_SYNC_API_KEY is configured in project secrets',
        'Confirm the key matches the one configured in FrostGuard\'s org-state-api',
        'Check if the key has been rotated or expired',
        'Try refreshing the user context after fixing the key',
      ],
      relatedLogFilters: {
        categories: ['org-sync', 'network'],
        searchTerms: ['401', 'unauthorized', 'api key'],
      },
      severity: 'critical',
    }),
  },

  // org-state-api 400 - Bad request
  {
    id: 'org-state-400',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('400') || data.includes('bad request')) &&
             (msg.includes('org-state') || msg.includes('fetch-org-state') || entry.category === 'org-sync');
    },
    explain: () => ({
      whatHappened: 'FrostGuard returned a 400 Bad Request error for the org state sync.',
      mostLikelyCause: 'The request is malformed - likely missing org_id or the org_id format is invalid.',
      whatToDoNext: [
        'Ensure a user is properly selected in the emulator',
        'Check that the selected user has a valid organization_id',
        'Verify the org_id is a valid UUID format',
        'Look at the network tab for request details',
      ],
      relatedLogFilters: {
        categories: ['org-sync', 'context'],
        searchTerms: ['400', 'org_id', 'bad request'],
      },
      severity: 'critical',
    }),
  },

  // org-state-api 500 - Server error
  {
    id: 'org-state-500',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('500') || data.includes('internal server error') || data.includes('upstream')) &&
             (msg.includes('org-state') || msg.includes('fetch-org-state') || entry.category === 'org-sync');
    },
    explain: () => ({
      whatHappened: 'FrostGuard encountered an internal server error (500) during the sync request.',
      mostLikelyCause: 'The upstream FrostGuard org-state-api function failed. This could be a temporary issue or a bug in FrostGuard.',
      whatToDoNext: [
        'Wait a moment and try refreshing the user context',
        'Export a support snapshot and share with the FrostGuard team',
        'Check if FrostGuard services are operational',
        'Look for error patterns in FrostGuard logs if accessible',
      ],
      relatedLogFilters: {
        categories: ['org-sync', 'network', 'error'],
        searchTerms: ['500', 'server error', 'upstream'],
      },
      severity: 'critical',
    }),
  },

  // FrostGuard URL not configured
  {
    id: 'frostguard-url-missing',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return msg.includes('frostguard') && (msg.includes('url') || msg.includes('not configured') || data.includes('frostguard_supabase_url'));
    },
    explain: () => ({
      whatHappened: 'The FrostGuard API URL is not configured in project secrets.',
      mostLikelyCause: 'The FROSTGUARD_SUPABASE_URL secret is missing from the edge function environment.',
      whatToDoNext: [
        'Add FROSTGUARD_SUPABASE_URL to the project secrets',
        'Use the format: https://<project-id>.supabase.co',
        'Ensure the edge functions are redeployed after adding the secret',
      ],
      relatedLogFilters: {
        categories: ['network', 'error'],
        searchTerms: ['frostguard', 'url', 'configured'],
      },
      severity: 'critical',
    }),
  },

  // Sync API key not configured
  {
    id: 'sync-api-key-missing',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('sync') || msg.includes('api key')) && 
             (msg.includes('not configured') || msg.includes('missing') || data.includes('project2_sync_api_key'));
    },
    explain: () => ({
      whatHappened: 'The sync API key is not configured in project secrets.',
      mostLikelyCause: 'The PROJECT2_SYNC_API_KEY secret is missing from the edge function environment.',
      whatToDoNext: [
        'Add PROJECT2_SYNC_API_KEY to the project secrets',
        'Get the API key value from FrostGuard configuration',
        'Ensure the edge functions are redeployed after adding the secret',
      ],
      relatedLogFilters: {
        categories: ['network', 'org-sync', 'error'],
        searchTerms: ['api key', 'configured', 'secret'],
      },
      severity: 'critical',
    }),
  },

  // Entities removed after sync - expected behavior
  {
    id: 'entities-removed-sync',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      return (msg.includes('removed') && (msg.includes('sensor') || msg.includes('gateway') || msg.includes('site'))) ||
             (msg.includes('missing from') && msg.includes('payload')) ||
             (msg.includes('state replacement') && entry.data?.removed_count && (entry.data.removed_count as number) > 0);
    },
    explain: (entry) => {
      const removedCount = entry.data?.removed_count || 'some';
      const entityType = entry.message.includes('gateway') ? 'gateways' : 
                         entry.message.includes('sensor') ? 'sensors' : 'entities';
      return {
        whatHappened: `${removedCount} ${entityType} were removed from local state after syncing with FrostGuard.`,
        mostLikelyCause: 'This is expected behavior. The entities no longer exist in FrostGuard\'s authoritative org state. The emulator uses FrostGuard as the source of truth.',
        whatToDoNext: [
          'If entities were accidentally deleted in FrostGuard, restore them there',
          'Check FrostGuard\'s org management to verify entity status',
          'The removed entities are listed in the log data',
          'This sync model ensures data consistency across systems',
        ],
        relatedLogFilters: {
          categories: ['org-sync'],
          searchTerms: ['removed', 'missing', 'state replacement'],
        },
        severity: 'info',
      };
    },
  },

  // TTN 403 - Forbidden (missing rights)
  {
    id: 'ttn-403',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('403') || data.includes('403') || data.includes('forbidden') || data.includes('permission')) &&
             (entry.category === 'ttn' || entry.category === 'provisioning' || msg.includes('ttn'));
    },
    explain: () => ({
      whatHappened: 'The Things Network rejected the request with a 403 Forbidden error.',
      mostLikelyCause: 'The TTN API key lacks the required permissions for device/gateway management.',
      whatToDoNext: [
        'Go to The Things Network Console',
        'Open your application → API Keys',
        'Create or edit the API key to include:',
        '  • "Write to Application" (devices.write)',
        '  • "Link as Application" (for full access)',
        'Update the API key in your TTN settings',
      ],
      relatedLogFilters: {
        categories: ['ttn', 'provisioning'],
        searchTerms: ['403', 'forbidden', 'permission', 'rights'],
      },
      severity: 'critical',
    }),
  },

  // TTN 409 - Device already exists
  {
    id: 'ttn-409-exists',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('409') || data.includes('409') || data.includes('already exists') || data.includes('conflict')) &&
             (entry.category === 'ttn' || entry.category === 'provisioning');
    },
    explain: () => ({
      whatHappened: 'The device or gateway already exists in TTN (409 Conflict).',
      mostLikelyCause: 'The entity with this DevEUI/GatewayEUI is already registered in the TTN application.',
      whatToDoNext: [
        'The entity may already be correctly linked - check TTN Console',
        'If you need to re-register, delete the device in TTN first',
        'Use the "Link Existing" flow instead of "Create New"',
        'Consider using upsert operations for idempotent provisioning',
      ],
      relatedLogFilters: {
        categories: ['ttn', 'provisioning'],
        searchTerms: ['409', 'exists', 'conflict', 'duplicate'],
      },
      severity: 'warning',
    }),
  },

  // TTN 404 - Application not found
  {
    id: 'ttn-404',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('404') || data.includes('404') || data.includes('not found')) &&
             (entry.category === 'ttn' || entry.category === 'provisioning') &&
             (data.includes('application') || msg.includes('application'));
    },
    explain: () => ({
      whatHappened: 'The TTN application was not found (404 Not Found).',
      mostLikelyCause: 'The application ID is incorrect, or you\'re connecting to the wrong TTN cluster.',
      whatToDoNext: [
        'Verify the application ID in your TTN settings',
        'Check that you\'re using the correct TTN cluster (eu1, nam1, au1)',
        'Ensure the application exists in The Things Network Console',
        'The application ID is case-sensitive',
      ],
      relatedLogFilters: {
        categories: ['ttn', 'provisioning'],
        searchTerms: ['404', 'not found', 'application'],
      },
      severity: 'critical',
    }),
  },

  // TTN API key lacks permission (general)
  {
    id: 'ttn-permission-denied',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('permission') || msg.includes('lacks') || data.includes('insufficient_rights')) &&
             (entry.category === 'ttn' || entry.category === 'provisioning');
    },
    explain: () => ({
      whatHappened: 'The TTN API key lacks the required permissions for this operation.',
      mostLikelyCause: 'The API key was created with limited rights that don\'t include the required operation.',
      whatToDoNext: [
        'Go to The Things Network Console → Your Application → API Keys',
        'Required permissions for device operations:',
        '  • devices.read - List and view devices',
        '  • devices.write - Create and update devices',
        '  • gateways.read - List gateways (if needed)',
        '  • gateways.write - Register gateways (if needed)',
        'Create a new key with the required permissions',
      ],
      relatedLogFilters: {
        categories: ['ttn', 'provisioning'],
        searchTerms: ['permission', 'rights', 'denied'],
      },
      severity: 'critical',
    }),
  },

  // sync-to-frostguard 400 - Validation error
  {
    id: 'sync-to-frostguard-400',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('400') || data.includes('validation') || data.includes('invalid')) &&
             (msg.includes('sync-to-frostguard') || msg.includes('frostguard') && msg.includes('sync'));
    },
    explain: () => ({
      whatHappened: 'FrostGuard rejected the sync payload with a 400 Validation Error.',
      mostLikelyCause: 'The data being synced has schema mismatches or missing required fields.',
      whatToDoNext: [
        'Check the error details for specific validation failures',
        'Ensure all required fields are present (org_id, site_id for sensors)',
        'Verify data formats match FrostGuard\'s expected schema',
        'Check for duplicate device IDs or EUIs',
      ],
      relatedLogFilters: {
        categories: ['org-sync', 'network', 'error'],
        searchTerms: ['400', 'validation', 'invalid', 'sync-to-frostguard'],
      },
      severity: 'critical',
    }),
  },

  // Unique constraint violation
  {
    id: 'unique-constraint',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('unique') && msg.includes('constraint')) ||
             data.includes('unique constraint') ||
             data.includes('duplicate key');
    },
    explain: () => ({
      whatHappened: 'A database unique constraint violation occurred.',
      mostLikelyCause: 'An entity with the same unique identifier (like DevEUI) already exists in the database.',
      whatToDoNext: [
        'Check if the entity already exists and needs to be linked instead of created',
        'Use upsert operations for idempotent operations',
        'If re-creating, delete the existing entity first',
        'Verify you\'re not accidentally creating duplicates',
      ],
      relatedLogFilters: {
        categories: ['provisioning', 'error'],
        searchTerms: ['unique', 'constraint', 'duplicate', 'exists'],
      },
      severity: 'warning',
    }),
  },

  // Retry exhaustion
  {
    id: 'retry-exhausted',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      return msg.includes('failed after') && msg.includes('attempt');
    },
    explain: (entry) => {
      const attemptMatch = entry.message.match(/(\d+)\s*attempt/i);
      const attempts = attemptMatch ? attemptMatch[1] : 'multiple';
      return {
        whatHappened: `The operation failed after ${attempts} retry attempts.`,
        mostLikelyCause: 'Network instability, service unavailability, or persistent server errors.',
        whatToDoNext: [
          'Check your network connection',
          'Verify the target service (FrostGuard/TTN) is operational',
          'Wait a moment and try again',
          'Check for rate limiting if making many requests',
          'Export support snapshot if issue persists',
        ],
        relatedLogFilters: {
          categories: ['network', 'error'],
          searchTerms: ['failed', 'attempt', 'retry', 'timeout'],
        },
        severity: 'warning',
      };
    },
  },

  // Network/fetch error
  {
    id: 'network-error',
    match: (entry) => {
      const msg = entry.message.toLowerCase();
      const data = JSON.stringify(entry.data || {}).toLowerCase();
      return (msg.includes('network') || msg.includes('fetch') || data.includes('typeerror')) &&
             (msg.includes('error') || msg.includes('failed'));
    },
    explain: () => ({
      whatHappened: 'A network error occurred while making an HTTP request.',
      mostLikelyCause: 'Network connectivity issues, CORS problems, or the target server is unreachable.',
      whatToDoNext: [
        'Check your internet connection',
        'Verify the target URL is correct and accessible',
        'Check browser console for CORS errors',
        'Try refreshing the page',
      ],
      relatedLogFilters: {
        categories: ['network', 'error'],
        searchTerms: ['network', 'fetch', 'failed', 'cors'],
      },
      severity: 'critical',
    }),
  },
];

/**
 * Attempts to explain an error entry using known patterns
 */
export function explainError(entry: DebugEntry): ErrorExplanation | null {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.match(entry)) {
      return pattern.explain(entry);
    }
  }
  
  // Generic fallback for errors without specific patterns
  if (entry.level === 'error') {
    return {
      whatHappened: entry.message,
      mostLikelyCause: 'This error doesn\'t match a known pattern. Review the log data for details.',
      whatToDoNext: [
        'Check the expanded log data for more context',
        'Look at related logs in the same category',
        'Export a support snapshot for detailed diagnosis',
        'Check browser DevTools Network tab for failed requests',
      ],
      relatedLogFilters: {
        categories: [entry.category],
        searchTerms: extractSearchTerms(entry),
      },
      severity: 'warning',
    };
  }
  
  return null;
}

/**
 * Finds related log entries based on the explanation's filters
 */
export function getRelatedLogs(entries: DebugEntry[], explanation: ErrorExplanation, currentEntryId: string): DebugEntry[] {
  const { categories, searchTerms } = explanation.relatedLogFilters;
  
  return entries.filter(entry => {
    // Exclude the current entry
    if (entry.id === currentEntryId) return false;
    
    // Must match category
    if (!categories.includes(entry.category)) return false;
    
    // Check if any search term matches
    const entryText = `${entry.message} ${JSON.stringify(entry.data || {})}`.toLowerCase();
    return searchTerms.some(term => entryText.includes(term.toLowerCase()));
  }).slice(0, 10); // Limit to 10 related entries
}

/**
 * Extract meaningful search terms from an entry
 */
function extractSearchTerms(entry: DebugEntry): string[] {
  const terms: string[] = [];
  
  // Extract status codes
  const statusMatch = entry.message.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) terms.push(statusMatch[1]);
  
  // Extract key words
  const keywords = ['error', 'failed', 'missing', 'invalid', 'timeout', 'unauthorized'];
  for (const kw of keywords) {
    if (entry.message.toLowerCase().includes(kw)) {
      terms.push(kw);
    }
  }
  
  // Add category as search term
  terms.push(entry.category);
  
  return terms;
}

/**
 * Get severity badge color
 */
export function getSeverityColor(severity: ErrorExplanation['severity']): string {
  switch (severity) {
    case 'critical': return 'destructive';
    case 'warning': return 'default';
    case 'info': return 'secondary';
    default: return 'outline';
  }
}
