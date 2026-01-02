# FrostGuard Full Codebase Audit Report

**Date:** 2026-01-02
**Auditor:** Claude Code
**Scope:** FrostGuard LoRaWAN Emulator (frontend + backend + Supabase edge functions + DB/RLS + TTN integration)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 1: Architecture Audit](#phase-1-architecture-audit)
   - [1.1 Repository Map](#11-repository-map)
   - [1.2 Critical User Flows](#12-critical-user-flows)
   - [1.3 Complexity Hotspots](#13-complexity-hotspots)
   - [1.4 Separation of Concerns](#14-separation-of-concerns)
   - [1.5 Integration Health](#15-integration-health)
3. [Phase 2: Prioritized Fix Plan](#phase-2-prioritized-fix-plan)
   - [P0 - Critical (Must Fix Now)](#p0---critical-must-fix-now)
   - [P1 - Important (Reliability/UX)](#p1---important-reliabilityux)
   - [P2 - Nice-to-Have (Refactors)](#p2---nice-to-have-refactors)
4. [TTN Integration Stabilization Plan](#ttn-integration-stabilization-plan)
5. [Dead Code Cleanup Map](#dead-code-cleanup-map)
6. [Validation Steps](#validation-steps)

---

## Executive Summary

This audit covers the FrostGuard LoRaWAN Emulator application, a React/TypeScript frontend with Supabase backend that integrates with The Things Network (TTN) for LoRaWAN device simulation. The app pulls authoritative data from an upstream "FrostGuard" project.

### Key Findings

| Category | Count | Severity |
|----------|-------|----------|
| Security Issues | 1 | P0 - Critical |
| Integration Bugs | 3 | P1 - Important |
| Code Quality Issues | 5 | P1/P2 |
| Dead Code Candidates | 4 | P2 |
| Complexity Hotspots | 3 | P2 |

### Critical Issue
**RLS Policy Bypass on `ttn_settings` table** - Overly permissive policies allow any authenticated user to read/modify any organization's TTN API keys.

---

## Phase 1: Architecture Audit

### 1.1 Repository Map

```
pixel-perfect-copy-10/
├── src/
│   ├── App.tsx                    # Main app entry, routing
│   ├── main.tsx                   # React root mount
│   ├── pages/
│   │   ├── Index.tsx              # Landing page → DeviceEmulator
│   │   └── DeviceEmulator.tsx     # LoRaWAN Emulator page wrapper
│   ├── components/
│   │   ├── LoRaWANEmulator.tsx    # MAIN COMPONENT (1628 LOC) - device emulation UI
│   │   └── emulator/
│   │       ├── WebhookSettings.tsx     # TTN config panel (1707 LOC)
│   │       ├── UserSelectionGate.tsx   # User context/FrostGuard sync
│   │       ├── UserSearchDialog.tsx    # User search modal
│   │       ├── TTNSetupWizard.tsx      # Guided TTN setup
│   │       ├── TTNPreflightModal.tsx   # Pre-simulation checks
│   │       ├── DebugTerminal.tsx       # Debug log viewer
│   │       └── ...other UI components
│   ├── lib/
│   │   ├── ttn-payload.ts         # TTN payload types & utilities
│   │   ├── ttnConfigStore.ts      # Centralized TTN config (canonical vs draft)
│   │   ├── frostguardOrgSync.ts   # FrostGuard API integration (911 LOC)
│   │   ├── debugLogger.ts         # Main debug logging system
│   │   ├── debug.ts               # Legacy debug utility (CANDIDATE FOR REMOVAL)
│   │   ├── supportSnapshot.ts     # Support diagnostics export
│   │   └── errorExplainer.ts      # User-friendly error messages
│   ├── integrations/supabase/
│   │   ├── client.ts              # Supabase client singleton
│   │   └── types.ts               # Generated DB types
│   └── hooks/
│       └── use-toast.ts           # Toast notifications
├── supabase/
│   ├── functions/
│   │   ├── ttn-simulate/          # Simulate uplinks to TTN
│   │   ├── ttn-preflight/         # Validate TTN config
│   │   ├── ttn-webhook/           # Receive TTN webhooks
│   │   ├── manage-ttn-settings/   # Test TTN connection
│   │   ├── push-ttn-settings/     # Save TTN settings locally
│   │   ├── fetch-org-state/       # Pull state from FrostGuard
│   │   ├── ttn-batch-provision/   # Register devices in TTN
│   │   ├── ttn-batch-register-gateways/  # Register gateways in TTN
│   │   ├── search-users/          # User search
│   │   └── user-sync/             # User synchronization
│   └── migrations/                # Database migrations with RLS policies
└── package.json                   # Vite + React + TypeScript
```

### 1.2 Critical User Flows

#### Flow 1: TTN Configuration (Developer Panel)
```
UI: WebhookSettings.tsx
 ↓ Save Settings
Edge: push-ttn-settings/index.ts
 ↓ Upsert to ttn_settings table
 ↓ Update synced_users.ttn JSON
DB: ttn_settings, synced_users.ttn
 ↓
UI: Test Connection button
Edge: manage-ttn-settings (action: test_stored)
 ↓ Load from DB → Call TTN API
TTN: GET /api/v3/applications/{app_id}
```

**Issues Found:**
- FrostGuard sync is explicitly SKIPPED in push-ttn-settings (line 76-79): "FrostGuard requires JWT auth, incompatible with cross-project sync"
- Settings saved locally never propagate upstream

#### Flow 2: Uplink Simulation
```
UI: LoRaWANEmulator.tsx → simulateUplink()
 ↓
Edge: ttn-simulate/index.ts
 ↓ loadUserSettings() → synced_users.ttn
 ↓ loadOrgSettings() → ttn_settings (fallback)
 ↓ checkDeviceExists() → TTN GET /devices/{id}
 ↓
TTN: POST /api/v3/as/applications/{app}/devices/{dev}/up/simulate
 ↓ TTN processes → triggers webhook
Edge: ttn-webhook/index.ts
 ↓ Insert sensor_uplinks
 ↓ Upsert unit_telemetry
 ↓ Insert legacy sensor_readings/door_events
DB: sensor_uplinks, unit_telemetry, sensor_readings, door_events
```

**Issues Found:**
- Dual settings lookup (user vs org) with fallback can cause confusion
- Legacy table writes (sensor_readings, door_events) may be dead code

#### Flow 3: User Context & FrostGuard Sync
```
UI: UserSelectionGate.tsx
 ↓ handleUserSelect()
Edge: fetch-org-state/index.ts
 ↓ Call FrostGuard org-state-api
FrostGuard: /functions/v1/org-state-api
 ↓ Return sites, units, sensors, gateways, ttn config
 ↓
UI: setCanonicalConfig() in ttnConfigStore.ts
 ↓ Replace local state with pulled data
Session: sessionStorage["lorawan-emulator-user-context"]
```

**Issues Found:**
- 1-hour session context expiry (line 91-93 in UserSelectionGate.tsx)
- Complex "localDirty" tracking to prevent canonical overwrites

#### Flow 4: Gateway Provisioning
```
UI: Gateway panel → Provision button
Edge: ttn-batch-register-gateways/index.ts
 ↓ loadOrgSettings() → ttn_settings (gateway_owner_type, gateway_owner_id)
 ↓ Build owner-scoped URL: /api/v3/{users|organizations}/{owner}/gateways
TTN: POST /gateways
```

**Issues Found:**
- Requires separate API key with `gateways:write` permission
- Application API keys cannot register gateways (common user confusion)

#### Flow 5: Device Provisioning
```
UI: Device panel → Provision button
Edge: ttn-batch-provision/index.ts
 ↓ Register in Identity Server: POST /applications/{app}/devices
 ↓ Register in Join Server: PUT /js/applications/{app}/devices/{id}
 ↓ Update lora_sensors.status = 'active'
DB: lora_sensors
```

### 1.3 Complexity Hotspots

| File | LOC | Cyclomatic Complexity | Issue |
|------|-----|----------------------|-------|
| `src/components/LoRaWANEmulator.tsx` | 1628 | High | Monolithic component, handles devices, gateways, simulation, UI state |
| `src/components/emulator/WebhookSettings.tsx` | 1707 | High | TTN config, testing, permissions, wizards all in one component |
| `src/lib/frostguardOrgSync.ts` | 911 | Medium | Many responsibilities: fetch, backfill, unit creation, device assignment |

#### Top 10 "Central" Modules (Import Analysis)
1. `@/lib/ttn-payload` - Used by all emulator components
2. `@/integrations/supabase/client` - Used by all data access
3. `@/lib/debugLogger` - Used across components and edge functions
4. `@/hooks/use-toast` - UI feedback
5. `@/lib/ttnConfigStore` - TTN config state management

#### Duplicate Logic Identified
| Pattern | Locations | Fix |
|---------|-----------|-----|
| `normalizeDevEui()` | ttn-payload.ts, ttn-simulate, ttn-preflight, ttn-batch-provision | Extract to shared module |
| `generateTTNDeviceId()` | ttn-payload.ts, ttn-simulate, ttn-preflight | Extract to shared module |
| `corsHeaders` object | Every edge function | Create shared CORS utility |
| TTN settings loading | ttn-simulate, ttn-preflight, manage-ttn-settings | Create shared settings loader |

### 1.4 Separation of Concerns

#### Current Architecture Issues

1. **UI ↔ State Coupling**
   - WebhookSettings.tsx manages both UI rendering AND TTN config persistence
   - LoRaWANEmulator.tsx owns device/gateway state but also handles simulation logic

2. **Multiple Sources of Truth**
   - `config.ttnConfig` (prop-based)
   - `ttnConfigStore` (centralized store)
   - `sessionStorage["lorawan-emulator-user-context"]` (persisted context)
   - `ttn_settings` table (DB)
   - `synced_users.ttn` JSON column (DB)

3. **Edge Function Code Duplication**
   - Each function has its own CORS handling
   - Each function has its own Supabase client creation
   - Each function has its own DevEUI normalization

#### Recommended Boundaries
```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer                                                     │
│ - React components (render only)                            │
│ - Event handlers call domain layer                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Domain Layer                                                 │
│ - ttnService.ts (TTN API operations)                        │
│ - deviceService.ts (device CRUD)                            │
│ - configService.ts (config management)                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Data Access Layer                                            │
│ - supabaseClient.ts (centralized client)                    │
│ - repositories (typed queries)                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Edge Functions (Backend)                                     │
│ - Shared utilities in supabase/functions/_shared/           │
│ - Consistent response envelopes                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.5 Integration Health

#### Supabase Auth/Session ✅
- Client properly initialized with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Edge functions use `SUPABASE_SERVICE_ROLE_KEY` for elevated access

#### RLS Coverage ⚠️ CRITICAL ISSUE

**File:** `supabase/migrations/20251231070526_77599965-766b-431f-83c4-0b0101113341.sql`

```sql
-- PROBLEM: These policies bypass org membership checks
CREATE POLICY "Allow webhook select on ttn_settings"
ON ttn_settings FOR SELECT
USING (true);  -- ← ANY authenticated user can read ALL orgs' TTN settings

CREATE POLICY "Allow webhook insert on ttn_settings"
ON ttn_settings FOR INSERT
WITH CHECK (true);  -- ← ANY authenticated user can insert for ANY org

CREATE POLICY "Allow webhook update on ttn_settings"
ON ttn_settings FOR UPDATE
USING (true);  -- ← ANY authenticated user can update ANY org's API keys
```

**Impact:** Any authenticated user can read/modify any organization's TTN API keys.

**Fix Required:** These "webhook" policies should either:
1. Be removed (edge functions use service role key which bypasses RLS)
2. Or require `auth.uid() IS NULL` (for webhook-only access via service role)

#### Edge Function Patterns

| Pattern | Status | Notes |
|---------|--------|-------|
| CORS handling | ✅ Consistent | All functions handle OPTIONS preflight |
| Response envelopes | ⚠️ Inconsistent | Some return `{ok, error}`, others `{success, error}` |
| Auth headers | ✅ | Uses Bearer token for TTN, service role for DB |
| Request ID propagation | ✅ | Most functions generate and return request_id |
| Error structure | ⚠️ | Mix of `error`/`message`, `hint`, `error_code` |

#### TTN Integration Health

| Check | Status | Issue |
|-------|--------|-------|
| Cluster detection | ✅ | Parses from Console URL |
| Key type validation | ⚠️ | Format check exists but no permission preflight on save |
| Application verification | ✅ | manage-ttn-settings tests connection |
| Device preflight | ✅ | ttn-preflight checks device registration |
| Gateway provisioning | ⚠️ | Requires separate Personal/Org key (user confusion) |
| Webhook secret | ⚠️ | Optional, not validated on receive |

---

## Phase 2: Prioritized Fix Plan

### P0 - Critical (Must Fix Now)

#### P0-1: RLS Policy Security Hole on `ttn_settings`

**Problem:** Overly permissive RLS policies allow any authenticated user to access any organization's TTN API keys.

**Root Cause:** Migration `20251231070526_*.sql` added "webhook" policies with `USING (true)` that bypass org membership checks.

**Evidence:** Lines 25-35 of the migration file.

**Proposed Fix:**
```sql
-- Remove the permissive policies (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Allow webhook select on ttn_settings" ON ttn_settings;
DROP POLICY IF EXISTS "Allow webhook insert on ttn_settings" ON ttn_settings;
DROP POLICY IF EXISTS "Allow webhook update on ttn_settings" ON ttn_settings;
```

**Files to Touch:**
- New migration: `supabase/migrations/YYYYMMDDHHMMSS_fix_ttn_settings_rls.sql`

**Validation:**
1. Run migration
2. Attempt to query `ttn_settings` as User A for Org B → should fail
3. Verify edge functions still work (they use service role)

**Rollback:** Drop the new migration, re-run the original

---

### P1 - Important (Reliability/UX)

#### P1-1: FrostGuard Sync Disabled - TTN Settings Drift

**Problem:** `push-ttn-settings` explicitly skips FrostGuard push, causing local TTN settings to never sync upstream.

**Root Cause:** FrostGuard's `manage-ttn-settings` requires JWT auth, incompatible with cross-project API key auth.

**Evidence:** Lines 76-79 in `push-ttn-settings/index.ts`:
```typescript
console.log(`[push-ttn-settings][${requestId}] TTN_PUSH_SKIPPED_NO_FG_SUPPORT`, {
  reason: 'FrostGuard manage-ttn-settings requires JWT auth, incompatible with cross-project sync',
});
```

**Proposed Fix Options:**
1. **Option A:** Implement service-to-service auth in FrostGuard's manage-ttn-settings
2. **Option B:** Create a dedicated sync API in FrostGuard that accepts API key auth
3. **Option C (interim):** Document that TTN settings are local-only, add UI warning

**Files to Touch:**
- `supabase/functions/push-ttn-settings/index.ts`
- (FrostGuard project) edge functions

**Validation:**
1. Save TTN settings in emulator
2. Verify settings appear in FrostGuard DB

---

#### P1-2: Normalize Response Envelopes

**Problem:** Inconsistent response shapes across edge functions.

**Evidence:**
- ttn-simulate uses `{success: true/false, ...}`
- fetch-org-state uses `{ok: true/false, ...}`
- manage-ttn-settings uses `{ok: true/false, connected: true/false, ...}`

**Proposed Fix:** Standardize on:
```typescript
interface EdgeFunctionResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  error_code?: string;
  hint?: string;
  request_id: string;
}
```

**Files to Touch:**
- All edge functions in `supabase/functions/`
- Frontend code that parses responses

---

#### P1-3: Extract Shared Edge Function Utilities

**Problem:** Duplicate code across edge functions (CORS, DevEUI normalization, Supabase client).

**Proposed Fix:** Create shared module:
```
supabase/functions/_shared/
├── cors.ts           # CORS headers and OPTIONS handler
├── supabase.ts       # Supabase client factory
├── ttn-utils.ts      # normalizeDevEui, generateTTNDeviceId, etc.
├── response.ts       # buildResponse helper
└── settings.ts       # loadUserSettings, loadOrgSettings
```

**Files to Touch:**
- Create `supabase/functions/_shared/` directory
- Refactor all edge functions to import from shared

---

#### P1-4: Gateway Provisioning UX - Key Type Guidance

**Problem:** Users attempt gateway provisioning with Application API keys, which lack gateway permissions.

**Evidence:** Error handling in `ttn-batch-register-gateways/index.ts` lines 224-232.

**Proposed Fix:**
1. Add preflight check for gateway permissions before provisioning
2. Show clear UI guidance on required key type
3. Consider separate "Gateway API Key" field in settings

**Files to Touch:**
- `src/components/emulator/WebhookSettings.tsx` - Add key type selector
- `supabase/functions/ttn-batch-register-gateways/index.ts` - Add permission preflight

---

#### P1-5: Dual Settings Source Confusion

**Problem:** TTN settings loaded from both `synced_users.ttn` and `ttn_settings` table with fallback logic.

**Evidence:** `ttn-simulate/index.ts` lines 282-341 - complex fallback from user → org settings.

**Proposed Fix:**
1. Document the canonical settings hierarchy
2. Add UI indicator showing which settings source is active
3. Consider simplifying to single source (org-level `ttn_settings`)

---

### P2 - Nice-to-Have (Refactors)

#### P2-1: Split LoRaWANEmulator.tsx (1628 LOC)

**Problem:** Monolithic component handling too many responsibilities.

**Proposed Split:**
```
LoRaWANEmulator.tsx →
├── DevicePanel.tsx      # Device list and management
├── GatewayPanel.tsx     # Gateway list and management
├── SimulationPanel.tsx  # Uplink simulation controls
├── TelemetryPanel.tsx   # Live telemetry display
└── useEmulatorState.ts  # Custom hook for state management
```

---

#### P2-2: Split WebhookSettings.tsx (1707 LOC)

**Proposed Split:**
```
WebhookSettings.tsx →
├── TTNConnectionCard.tsx   # Enable/disable, cluster, app ID
├── TTNCredentialsCard.tsx  # API key, webhook secret
├── TTNTestPanel.tsx        # Test connection, permissions
├── GatewayOwnerCard.tsx    # Gateway owner config
└── useTTNSettings.ts       # Custom hook for settings state
```

---

#### P2-3: Consolidate Debug Utilities

**Problem:** Two debug modules with overlapping functionality.

**Evidence:**
- `src/lib/debug.ts` (133 LOC) - Legacy sync debugging
- `src/lib/debugLogger.ts` (303 LOC) - Main debug system

**Proposed Fix:** Migrate `debug.ts` functionality to `debugLogger.ts`, then remove `debug.ts`.

---

#### P2-4: Remove Legacy Table Writes

**Problem:** `ttn-webhook` writes to legacy tables that may be unused.

**Evidence:** Lines 224-257 in `ttn-webhook/index.ts`:
```typescript
// Step 4: Also insert into legacy tables for backward compatibility
if (fPort === 1) {
  const { error } = await supabase.from('sensor_readings').insert(sensorData);
```

**Validation Required:** Confirm no other code reads from `sensor_readings` or `door_events` tables.

---

## TTN Integration Stabilization Plan

### Contract Normalization

1. **Request Envelope:**
```typescript
interface TTNRequest {
  request_id: string;  // Client-generated UUID
  org_id: string;
  selected_user_id?: string;
  // ... operation-specific fields
}
```

2. **Response Envelope:**
```typescript
interface TTNResponse<T> {
  ok: boolean;
  request_id: string;  // Echo back for correlation
  data?: T;
  error?: string;
  error_code?: 'AUTH_INVALID' | 'PERMISSION_MISSING' | 'DEVICE_NOT_FOUND' | ...;
  hint?: string;
  ttn_status?: number;  // Raw TTN HTTP status
}
```

### Permission Preflights

Add permission check before operations:
```
Save Settings → Validate key format
Test Connection → Check application:read
Simulate Uplink → Check devices:read + traffic:write
Provision Device → Check devices:write
Provision Gateway → Check gateways:write (requires Personal/Org key)
```

### Key Type Rules

| Operation | Application Key | Personal Key | Organization Key |
|-----------|-----------------|--------------|------------------|
| Read application | ✅ | ✅ | ✅ |
| Simulate uplink | ✅ | ✅ | ✅ |
| Register device | ✅ | ✅ | ✅ |
| Register gateway | ❌ | ✅ (user scope) | ✅ (org scope) |

### Webhook Lifecycle

1. **Create:** Generate webhook secret, configure in TTN Console
2. **Update:** Preserve existing secret unless explicitly changed
3. **Idempotency:** Check if webhook exists before creating

---

## Dead Code Cleanup Map

| File/Code | Type | Proof of Non-Use | Safe to Remove |
|-----------|------|------------------|----------------|
| `src/lib/debug.ts` | Entire file | Superseded by `debugLogger.ts`, only imported in `UserSearchDialog.tsx` | ⚠️ Migrate imports first |
| `eui-xxx` device ID format | Legacy code | ttn-simulate line 372-379 converts to new format | ✅ After confirming no data uses old format |
| `sensor_readings` table writes | Legacy table | Need to verify no reads | ⚠️ Audit consumers first |
| `door_events` table writes | Legacy table | Need to verify no reads | ⚠️ Audit consumers first |
| `localStorage['lorawan-emulator-ttn-cache']` | Cache key | Cleared but never read (line 598 WebhookSettings.tsx) | ✅ Safe to remove |
| Unused imports | Various | TypeScript compiler will identify | ✅ Run `tsc --noEmit` |

### Proof Steps for Dead Code

Before removing any code:
1. Grep for imports: `grep -r "import.*from.*file" src/`
2. Grep for runtime references: `grep -r "functionName\|variableName" src/ supabase/`
3. Check database queries for table usage
4. Review build output for warnings

---

## Validation Steps

### After Each Fix

1. **Lint/Typecheck:**
   ```bash
   npm run lint
   npx tsc --noEmit
   ```

2. **Build:**
   ```bash
   npm run build
   ```

3. **Manual Smoke Test:**
   - [ ] Load app and authenticate
   - [ ] Open Developer → TTN panel
   - [ ] Validate TTN config (success and failure states)
   - [ ] Save config (verify persists, no reversion)
   - [ ] Configure webhook (idempotent)
   - [ ] Test connection (clear output)
   - [ ] Attempt gateway provisioning (shows actionable guidance if blocked)
   - [ ] Simulate uplink (verify delivery)

### RLS Fix Validation

```sql
-- As user A (not in org B)
SELECT * FROM ttn_settings WHERE org_id = 'org-b-uuid';
-- Should return: 0 rows (after fix)

-- As service role (edge function)
SELECT * FROM ttn_settings WHERE org_id = 'org-b-uuid';
-- Should return: 1 row (service role bypasses RLS)
```

---

## Implementation Order

Based on risk and dependencies:

1. **P0-1: RLS Security Fix** (immediate)
2. **P1-3: Extract Shared Utilities** (foundation for other fixes)
3. **P1-2: Normalize Response Envelopes** (using new shared utilities)
4. **P1-4: Gateway Provisioning UX** (user-facing improvement)
5. **P1-1: FrostGuard Sync** (requires upstream changes)
6. **P1-5: Settings Source Simplification** (after sync is working)
7. **P2-3: Consolidate Debug** (cleanup)
8. **P2-1/P2-2: Component Splits** (large refactor, lower risk)
9. **P2-4: Remove Legacy Writes** (after confirming dead)

---

## Appendix: File References

### Edge Functions

| Function | Purpose | LOC |
|----------|---------|-----|
| ttn-simulate | Simulate uplinks to TTN | 540 |
| ttn-preflight | Validate TTN config | 415 |
| ttn-webhook | Receive TTN webhooks | 284 |
| manage-ttn-settings | Test TTN connection | ~400 |
| push-ttn-settings | Save settings locally | 246 |
| fetch-org-state | Pull from FrostGuard | 335 |
| ttn-batch-provision | Register devices | 369 |
| ttn-batch-register-gateways | Register gateways | 466 |

### Key Frontend Files

| File | Purpose | LOC |
|------|---------|-----|
| LoRaWANEmulator.tsx | Main emulator UI | 1628 |
| WebhookSettings.tsx | TTN configuration | 1707 |
| UserSelectionGate.tsx | User context/sync | 775 |
| frostguardOrgSync.ts | FrostGuard API | 911 |
| ttnConfigStore.ts | Config state | 311 |
| ttn-payload.ts | TTN types/utils | 369 |

---

*Report generated by Claude Code audit. All findings should be validated before implementation.*
