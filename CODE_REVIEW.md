# Code Review Report

**Date**: 2026-01-02
**Reviewer**: Senior Software Engineer
**Project**: LoRaWAN Device Emulator (Pixel Perfect Copy)

---

## Table of Contents

1. [Top 5 Functions for Refactoring](#1-top-5-functions-for-refactoring)
2. [Configuration & Secrets Audit](#2-configuration--secrets-audit)
3. [Dependency Review](#3-dependency-review)
4. [Automated Quality Gates](#4-automated-quality-gates)
5. [Documentation Template](#5-documentation-template)

---

## 1. Top 5 Functions for Refactoring

### 1.1 `executeSync` (UserSelectionGate.tsx:138-426)

**Current Issues:**
- 288 lines of mixed concerns
- Handles API calls, state updates, session storage, toast notifications, and async backfill
- Too many responsibilities in a single function

**Before (Simplified Excerpt):**
```typescript
const executeSync = useCallback(async (user: UserProfile) => {
  setIsLoading(true);
  setError(null);
  setSyncSummary(null);

  const syncRunId = crypto.randomUUID();
  const syncedAt = new Date().toISOString();

  try {
    const result = await fetchOrgState(user.organization_id);
    if (!result.ok || !result.data) {
      setError({ message: result.error || 'Failed' });
      setIsLoading(false);
      return;
    }

    // ... 200+ more lines of state transformation, storage, and side effects
  } catch (err) {
    // error handling
  } finally {
    setIsLoading(false);
  }
}, [config, gateways, devices, onConfigChange, onGatewaysChange, onDevicesChange]);
```

**After (Refactored):**
```typescript
// Step 1: Extract data transformation into a pure function
function transformOrgStateToEntities(
  orgState: OrgStateResponse
): { gateways: GatewayConfigType[]; devices: LoRaWANDevice[] } {
  const gateways = (orgState.gateways || []).map(g => ({
    id: g.id,
    name: g.name,
    eui: g.gateway_eui,
    isOnline: g.is_online,
  }));

  const devices = (orgState.sensors || []).map(s => ({
    id: s.id,
    name: s.name,
    devEui: s.dev_eui,
    joinEui: s.join_eui || '',
    appKey: s.app_key || '',
    type: s.type === 'door' ? 'door' : 'temperature' as const,
    gatewayId: s.gateway_id || '',
    siteId: s.site_id,
    unitId: s.unit_id,
    credentialSource: s.join_eui && s.app_key ? 'frostguard_pull' as const : undefined,
    credentialsLockedFromFrostguard: !!(s.join_eui && s.app_key),
  }));

  return { gateways, devices };
}

// Step 2: Extract config building into a pure function
function buildHydratedConfig(
  baseConfig: WebhookConfig,
  user: UserProfile,
  orgState: OrgStateResponse,
  syncMetadata: { syncedAt: string; syncRunId: string }
): WebhookConfig {
  const sites = (orgState.sites || []).map(s => ({
    site_id: s.id,
    site_name: s.name || null,
    is_default: s.is_default || false,
  }));

  const siteToSelect = sites.find(s => s.is_default)?.site_id
    || sites[0]?.site_id
    || user.default_site_id;

  const ttnConfig = orgState.ttn ? {
    enabled: orgState.ttn.enabled || false,
    applicationId: orgState.ttn.application_id || '',
    cluster: orgState.ttn.cluster || 'eu1',
    api_key_last4: orgState.ttn.api_key_last4 || null,
    webhook_secret_last4: orgState.ttn.webhook_secret_last4 || null,
  } : undefined;

  return {
    ...baseConfig,
    testOrgId: user.organization_id,
    testSiteId: siteToSelect,
    orgName: orgState.organization?.name,
    selectedUserId: user.id,
    selectedUserDisplayName: user.full_name || user.email || user.id,
    selectedUserSites: sites,
    ttnConfig,
    contextSetAt: syncMetadata.syncedAt,
    isHydrated: true,
    lastSyncAt: syncMetadata.syncedAt,
    lastSyncRunId: syncMetadata.syncRunId,
  };
}

// Step 3: Extract session storage into a hook
function useSessionPersistence(storageKey: string) {
  const save = useCallback((context: StoredUserContext) => {
    sessionStorage.setItem(storageKey, JSON.stringify(context));
  }, [storageKey]);

  const clear = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem('lorawan-emulator-gateways');
    localStorage.removeItem('lorawan-emulator-devices');
  }, [storageKey]);

  const restore = useCallback((): StoredUserContext | null => {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) return null;
    try {
      const context: StoredUserContext = JSON.parse(stored);
      const syncedAt = new Date(context.syncedAt);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return syncedAt > hourAgo && context.selectedUserId ? context : null;
    } catch {
      sessionStorage.removeItem(storageKey);
      return null;
    }
  }, [storageKey]);

  return { save, clear, restore };
}

// Step 4: Simplified executeSync using composed functions
const executeSync = useCallback(async (user: UserProfile) => {
  setIsLoading(true);
  setError(null);

  const syncMetadata = {
    syncRunId: crypto.randomUUID(),
    syncedAt: new Date().toISOString(),
  };

  try {
    const result = await fetchOrgState(user.organization_id);
    if (!result.ok || !result.data) {
      setError({ message: result.error || 'Failed to fetch org state' });
      return;
    }

    const { gateways, devices } = transformOrgStateToEntities(result.data);
    const hydratedConfig = buildHydratedConfig(config, user, result.data, syncMetadata);

    // Apply state updates
    onGatewaysChange(gateways);
    onDevicesChange(devices);
    onConfigChange(hydratedConfig);

    // Persist to session
    sessionPersistence.save({
      ...hydratedConfig,
      pulledGateways: gateways,
      pulledDevices: devices,
    } as StoredUserContext);

    setIsHydrated(true);
    toast({ title: 'Context Ready', description: `Synced v${result.data.sync_version}` });

    // Trigger async backfill (fire-and-forget)
    triggerCredentialBackfillIfNeeded(user.organization_id, devices);

  } catch (err) {
    setError({ message: err instanceof Error ? err.message : String(err) });
  } finally {
    setIsLoading(false);
  }
}, [config, onConfigChange, onGatewaysChange, onDevicesChange, sessionPersistence]);
```

---

### 1.2 `fetchOrgState` (frostguardOrgSync.ts:176-486)

**Current Issues:**
- 310 lines mixing retry logic, error handling, and logging
- Nested try-catch blocks
- Multiple return paths with similar error structures

**Before (Excerpt):**
```typescript
export async function fetchOrgState(orgId: string): Promise<FetchOrgStateResult> {
  let lastError: string = 'Unknown error';
  const startTime = performance.now();

  // ... 30 lines of setup

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('fetch-org-state', {
        body: { org_id: orgId },
      });

      if (error) {
        // ... 50 lines of error handling
      }

      if (!data) {
        // ... 15 lines
      }

      if (!data.ok) {
        // ... 40 lines of structured error handling
      }

      // ... 30 lines of success handling

    } catch (err) {
      // ... 30 lines of catch handling
    }
  }
  // ... final error return
}
```

**After (Refactored):**
```typescript
// Step 1: Extract retry logic into a reusable utility
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts: number;
    initialBackoffMs: number;
    shouldRetry: (error: unknown) => boolean;
    onRetry?: (attempt: number, error: unknown) => void;
  }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!options.shouldRetry(error) || attempt === options.maxAttempts - 1) {
        throw error;
      }

      options.onRetry?.(attempt, error);
      const backoff = options.initialBackoffMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}

// Step 2: Create error classification helper
function classifyOrgStateError(error: unknown): { shouldRetry: boolean; details: FrostGuardErrorDetails } {
  const message = error instanceof Error ? error.message : String(error);

  // Non-retryable errors
  if (message.includes('401') || message.includes('403')) {
    return { shouldRetry: false, details: { /* ... */ } };
  }
  if (message.includes('CORS') || message.includes('blocked')) {
    return { shouldRetry: false, details: { /* ... */ } };
  }

  // Retryable errors
  return { shouldRetry: true, details: { /* ... */ } };
}

// Step 3: Simplified main function
export async function fetchOrgState(orgId: string): Promise<FetchOrgStateResult> {
  // Validate input
  if (!isValidUUID(orgId)) {
    return { ok: false, error: 'Invalid organization ID', errorDetails: { /* ... */ } };
  }

  const startTime = performance.now();
  const timer = logTimed('org-sync', 'Fetch org state', { org_id: orgId });

  try {
    const data = await withRetry(
      async () => {
        const { data, error } = await supabase.functions.invoke('fetch-org-state', {
          body: { org_id: orgId },
        });

        if (error) throw error;
        if (!data) throw new Error('No data returned');
        if (!data.ok) throw new OrgStateError(data);

        return data;
      },
      {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        shouldRetry: (err) => classifyOrgStateError(err).shouldRetry,
        onRetry: (attempt) => log('network', 'warn', `Retry ${attempt + 1}`),
      }
    );

    timer.end();
    return { ok: true, data };

  } catch (error) {
    timer.end();
    const { details } = classifyOrgStateError(error);
    return { ok: false, error: details.message, errorDetails: details };
  }
}
```

---

### 1.3 `manage-ttn-settings` Edge Function (1128 lines)

**Current Issues:**
- Monolithic switch statement with 8 actions
- Each handler is 50-200 lines
- Difficult to test individual actions

**Before:**
```typescript
Deno.serve(async (req) => {
  // ... CORS handling

  switch (action) {
    case 'load':
      return await handleLoad(supabaseAdmin, org_id, requestId);
    case 'save':
      return await handleSave(supabaseAdmin, body, requestId);
    case 'test':
      return await handleTest(body, requestId);
    case 'test_stored':
      return await handleTestStored(supabaseAdmin, body, requestId);
    case 'check_device':
      return await handleCheckDevice(body, requestId);
    case 'check_gateway':
      return await handleCheckGateway(supabaseAdmin, body, requestId);
    case 'check_gateway_permissions':
      return await handleCheckGatewayPermissions(supabaseAdmin, body, requestId);
    case 'check_app_permissions':
      return await handleCheckAppPermissions(body, requestId);
    default:
      return errorResponse(`Unknown action: ${action}`, 'VALIDATION_ERROR', 400, requestId);
  }
});
```

**Recommended Refactoring:**
Split into separate edge functions:
```
supabase/functions/
├── ttn-settings-load/index.ts      (~80 lines)
├── ttn-settings-save/index.ts      (~100 lines)
├── ttn-test-connection/index.ts    (~150 lines)
├── ttn-check-device/index.ts       (~50 lines)
├── ttn-check-gateway/index.ts      (~100 lines)
└── _shared/
    ├── ttn-client.ts               (TTN API wrapper)
    ├── response-helpers.ts         (buildResponse, errorResponse)
    └── validation.ts               (cluster validation, etc.)
```

---

### 1.4 `handleCheckGatewayPermissions` (manage-ttn-settings:932-1128)

**Current Issues:**
- 196 lines for a single permission check
- Duplicate fetch/error handling patterns
- Complex conditional hint building

**After (Refactored):**
```typescript
interface PermissionCheckResult {
  granted: boolean;
  status: number;
  error?: string;
}

async function checkTTNPermission(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown
): Promise<PermissionCheckResult> {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // 200, 400, 409 = has permission
    const granted = [200, 400, 409].includes(response.status);

    return { granted, status: response.status };
  } catch (e) {
    return { granted: false, status: 0, error: e instanceof Error ? e.message : 'Network error' };
  }
}

async function handleCheckGatewayPermissions(
  supabase: SupabaseClient,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  // Load configuration
  const config = await loadGatewayOwnerConfig(supabase, body.org_id);
  if (!config.ok) {
    return buildResponse({ ok: false, ...config.error }, 200, requestId);
  }

  const { apiKey, cluster, ownerType, ownerId } = config.data;
  const baseUrl = getBaseUrl(cluster);
  const ownerPath = ownerType === 'organization' ? `organizations/${ownerId}` : `users/${ownerId}`;

  // Check permissions in parallel
  const [readResult, writeResult] = await Promise.all([
    checkTTNPermission(baseUrl, apiKey, `/api/v3/${ownerPath}/gateways?limit=1`),
    checkTTNPermission(baseUrl, apiKey, `/api/v3/${ownerPath}/gateways`, 'POST', {
      gateway: { ids: { gateway_id: `perm-check-${Date.now()}` } }
    }),
  ]);

  const allOk = readResult.granted && writeResult.granted;

  return buildResponse({
    ok: allOk,
    permissions: { gateway_read: readResult.granted, gateway_write: writeResult.granted },
    hint: allOk ? undefined : buildPermissionHint(readResult, writeResult, ownerId),
    diagnostics: { cluster, ownerType, ownerId, readStatus: readResult.status, writeStatus: writeResult.status },
  }, 200, requestId);
}
```

---

### 1.5 `handleTestStored` (manage-ttn-settings:327-485)

**Current Issues:**
- 158 lines with multiple data source fallback paths
- Mixing database queries with API testing
- Hard to follow the settings resolution logic

**After (Refactored):**
```typescript
// Step 1: Extract settings resolution into a dedicated function
interface ResolvedTTNSettings {
  enabled: boolean;
  cluster: string;
  applicationId: string;
  apiKey: string;
  source: 'request' | 'synced_user' | 'org_settings';
}

async function resolveTTNSettings(
  supabase: SupabaseClient,
  orgId: string,
  userId?: string,
  overrides?: { cluster?: string; applicationId?: string }
): Promise<{ ok: true; settings: ResolvedTTNSettings } | { ok: false; error: string; code: string; hint: string }> {

  // Priority 1: Use overrides from request if provided
  if (overrides?.cluster && overrides?.applicationId && userId) {
    const apiKey = await getOrgApiKey(supabase, orgId);
    if (!apiKey) {
      return { ok: false, error: 'No API key', code: 'NO_API_KEY', hint: 'Save API key first' };
    }
    return { ok: true, settings: { enabled: true, ...overrides, apiKey, source: 'request' } };
  }

  // Priority 2: Load from synced_users if userId provided
  if (userId) {
    const userSettings = await loadUserTTNSettings(supabase, userId);
    if (userSettings) {
      const apiKey = await getOrgApiKey(supabase, orgId);
      if (!apiKey) {
        return { ok: false, error: 'No API key', code: 'NO_API_KEY', hint: 'User TTN settings synced without API key' };
      }
      return { ok: true, settings: { ...userSettings, apiKey, source: 'synced_user' } };
    }
  }

  // Priority 3: Fall back to org settings
  const orgSettings = await loadOrgTTNSettings(supabase, orgId);
  if (!orgSettings) {
    return { ok: false, error: 'No TTN settings found', code: 'NOT_CONFIGURED', hint: 'Save TTN settings first' };
  }

  return { ok: true, settings: { ...orgSettings, source: 'org_settings' } };
}

// Step 2: Simplified handler
async function handleTestStored(
  supabase: SupabaseClient,
  body: TTNSettingsRequest,
  requestId: string
): Promise<Response> {
  const { org_id, selected_user_id, cluster, application_id } = body;

  if (!org_id) {
    return buildResponse({ ok: false, error: 'org_id required', code: 'VALIDATION_ERROR' }, 200, requestId);
  }

  const resolved = await resolveTTNSettings(supabase, org_id, selected_user_id, { cluster, applicationId: application_id });
  if (!resolved.ok) {
    return buildResponse({ ok: false, ...resolved }, 200, requestId);
  }

  // Test connection with resolved settings
  const testResult = await handleTest({
    cluster: resolved.settings.cluster,
    application_id: resolved.settings.applicationId,
    api_key: resolved.settings.apiKey,
  }, requestId);

  // Save test result if testing org's own settings
  if (!selected_user_id) {
    await saveTestResult(supabase, org_id, testResult);
  }

  return testResult;
}
```

---

## 2. Configuration & Secrets Audit

### 2.1 Environment Variables Used

| Variable | Location | Purpose | Status |
|----------|----------|---------|--------|
| `VITE_SUPABASE_URL` | Frontend (.env) | Supabase project URL | ✅ Properly externalized |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend (.env) | Anonymous key | ✅ Safe for frontend |
| `SUPABASE_URL` | Edge functions | Injected by Supabase | ✅ Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions | Service role key | ✅ Auto-injected |
| `FROSTGUARD_SUPABASE_URL` | Edge functions | FrostGuard endpoint | ⚠️ Manual secret |
| `PROJECT2_SYNC_API_KEY` | Edge functions | Cross-project auth | ⚠️ Manual secret |
| `TTN_API_KEY` | Edge functions | Fallback TTN key | ⚠️ Optional fallback |

### 2.2 Hardcoded Values Found

**Location: `.env` file (COMMITTED TO REPO)**
```
VITE_SUPABASE_PROJECT_ID="jyxzaagcirhbdzvofkom"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIs..."
VITE_SUPABASE_URL="https://jyxzaagcirhbdzvofkom.supabase.co"
```

**Risk Assessment:**
- ⚠️ **MEDIUM RISK**: The `.env` file is committed to the repository
- The keys appear to be the public anon key (safe for frontend)
- However, committing `.env` files is an anti-pattern

**Recommendations:**
1. Add `.env` to `.gitignore`
2. Create `.env.example` with placeholder values
3. Document required env vars in README

### 2.3 Secrets Handling in Code

**Good Practices Found:**
```typescript
// In debugLogger.ts - proper secret redaction
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i, /secret/i, /password/i, /token/i,
  /authorization/i, /bearer/i, /app[_-]?key/i, /private/i,
];
```

```typescript
// In manage-ttn-settings - proper masking
function maskSecret(value: string | null): string | null {
  if (!value || value.length < 8) return value ? '****' : null;
  return `****${value.slice(-4)}`;
}
```

---

## 3. Dependency Review

### 3.1 Production Dependencies Analysis

| Package | Version | Assessment |
|---------|---------|------------|
| `@supabase/supabase-js` | ^2.89.0 | ✅ Current, well-maintained |
| `@tanstack/react-query` | ^5.83.0 | ⚠️ Installed but underutilized |
| `react` | ^18.3.1 | ✅ Current stable |
| `react-router-dom` | ^6.30.1 | ✅ Current |
| `zod` | ^3.25.76 | ⚠️ Installed but not widely used |
| `date-fns` | ^3.6.0 | ✅ Good choice for dates |
| `lucide-react` | ^0.462.0 | ✅ Icon library |
| `recharts` | ^2.15.4 | ✅ Charts |

### 3.2 Recommendations

**Underutilized Dependencies:**
1. **`@tanstack/react-query`**: Installed but the codebase uses manual fetch + useState. Consider migrating to use TanStack Query for:
   - `fetchOrgState` → `useQuery`
   - `assignDeviceToUnit` → `useMutation`
   - Automatic caching and refetching

2. **`zod`**: Only used in form validation. Could be expanded to:
   - Edge function input validation
   - API response validation
   - Type inference

### 3.3 Missing Dependencies

| Need | Recommended Package |
|------|-------------------|
| Testing | `vitest`, `@testing-library/react` |
| E2E Testing | `playwright` or `cypress` |
| Code formatting | `prettier` (already configured in ESLint) |
| Pre-commit hooks | `husky`, `lint-staged` |

---

## 4. Automated Quality Gates

### 4.1 Current ESLint Configuration

The existing `eslint.config.js` is minimal:
```javascript
rules: {
  ...reactHooks.configs.recommended.rules,
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  "@typescript-eslint/no-unused-vars": "off",  // ⚠️ Too permissive
}
```

### 4.2 Recommended ESLint Configuration

Create/update `eslint.config.js`:

```javascript
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "supabase/functions/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // TypeScript - stricter rules
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": ["warn", {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Code quality
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-nested-ternary": "error",
      "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
      "complexity": ["warn", 15],
    },
  },
);
```

### 4.3 Prettier Configuration

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "avoid"
}
```

Create `.prettierignore`:
```
dist/
node_modules/
supabase/.temp/
*.md
```

### 4.4 Pre-commit Hooks

Install dependencies:
```bash
npm install -D husky lint-staged
npx husky init
```

Create `.husky/pre-commit`:
```bash
npx lint-staged
```

Create `.lintstagedrc`:
```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

### 4.5 Package.json Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx}\"",
    "format:check": "prettier --check \"src/**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "prepare": "husky"
  }
}
```

---

## 5. Documentation Template

### 5.1 README.md Template

```markdown
# LoRaWAN Device Emulator

A React-based emulator for LoRaWAN devices, enabling testing of TTN (The Things Network) integrations and FrostGuard synchronization.

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Supabase CLI (for edge functions)

### Installation

\`\`\`bash
# Clone the repository
git clone <repo-url>
cd pixel-perfect-copy-10

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your Supabase credentials

# Start development server
npm run dev
\`\`\`

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/public key |

### Edge Function Secrets

Configure these in Supabase Dashboard → Edge Functions → Secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `FROSTGUARD_SUPABASE_URL` | Yes | FrostGuard Supabase endpoint |
| `PROJECT2_SYNC_API_KEY` | Yes | API key for cross-project sync |
| `TTN_API_KEY` | No | Fallback TTN API key |

## Architecture

\`\`\`
src/
├── components/
│   ├── emulator/           # Main emulator components
│   │   ├── LoRaWANEmulator.tsx
│   │   ├── DeviceManager.tsx
│   │   └── WebhookSettings.tsx
│   └── ui/                 # shadcn/ui primitives
├── hooks/                  # React hooks
├── lib/                    # Utilities and API clients
│   ├── frostguardOrgSync.ts
│   ├── debugLogger.ts
│   └── ttn-payload.ts
└── integrations/
    └── supabase/           # Supabase client & types

supabase/functions/         # Deno edge functions
├── fetch-org-state/
├── manage-ttn-settings/
├── ttn-preflight/
└── ...
\`\`\`

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on :8080 |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |

### Edge Functions

\`\`\`bash
# Deploy all functions
supabase functions deploy

# Test locally
supabase functions serve
\`\`\`

## Key Concepts

### Pull-Based Sync
The emulator uses a pull-based architecture where FrostGuard is the source of truth. On user selection, the app:
1. Fetches org state from FrostGuard via `fetch-org-state` edge function
2. Replaces local state with pulled data
3. Stores context in sessionStorage for restoration

### TTN Integration
- Devices are registered with TTN via the `ttn-batch-provision` function
- Uplinks are simulated via the `ttn-uplink` function
- Configuration is validated via `ttn-preflight`

## Contributing

1. Create a feature branch
2. Make changes
3. Run `npm run lint && npm run typecheck`
4. Submit PR

## License

MIT
\`\`\`

---

## Summary

### Priority Actions

| Priority | Action | Effort |
|----------|--------|--------|
| P0 | Add `.env` to `.gitignore` | 5 min |
| P0 | Set up pre-commit hooks | 30 min |
| P1 | Refactor `executeSync` into composable functions | 2-3 hours |
| P1 | Split `manage-ttn-settings` into separate functions | 4-6 hours |
| P2 | Add basic test coverage (start with utils) | 1 day |
| P2 | Migrate to TanStack Query for data fetching | 1 day |
| P3 | Extract shared utilities for edge functions | 2-4 hours |

### Code Quality Score

| Category | Current | Target |
|----------|---------|--------|
| Separation of Concerns | 4/10 | 7/10 |
| Test Coverage | 0% | 60% |
| Type Safety | 7/10 | 9/10 |
| Documentation | 3/10 | 7/10 |
| Maintainability | 5/10 | 8/10 |
