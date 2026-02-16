

# Fix: Application ID Conflict Across Multiple Data Sources

## Problem Summary

The Application ID keeps flip-flopping between `fg-7873654e-yq` (correct, from FrostGuard live pull) and `fg-7873654e-si` (stale, from the `synced_users` database mirror). This causes the "Cannot Start Emulation" error because the preflight check reads the stale value from the database.

## Root Cause

There are 4 competing sources of the Application ID, and they're not kept in sync:

```text
Source                          Value               Status
-----------------------------------------------------------
1. FrostGuard live pull         fg-7873654e-yq      Correct (authoritative)
2. synced_users.ttn (DB)        fg-7873654e-si      STALE (never updated)
3. ttn_settings (DB)            NULL                 Empty
4. localStorage                 varies               Depends on last write
```

The critical issue: **Both `ttn-preflight` and `ttn-simulate` edge functions** read the Application ID from `synced_users.ttn` in the database, which contains the stale value. The frontend knows the correct value from the FrostGuard live pull, but the edge functions ignore it.

## Fix Plan

### Change 1: Edge functions accept frontend-provided Application ID (Critical)

**File: `supabase/functions/ttn-preflight/index.ts`**

- Add `application_id` field to `PreflightRequest` interface
- When the frontend sends `application_id`, use it instead of (or in preference to) the `synced_users.ttn` mirror value
- Log a warning if there's a mismatch between the frontend value and the DB value

This mirrors what `ttn-simulate` already does (line 381: `applicationId = requestApplicationId || userSettings.application_id`).

### Change 2: Frontend sends Application ID to preflight check

**File: `src/components/LoRaWANEmulator.tsx`**

- In `runPreflightCheck()` (around line 1548), include the `applicationId` from `webhookConfig.ttnConfig.applicationId` in the request body sent to `ttn-preflight`
- This ensures the preflight check uses the same Application ID that the emulation will use

### Change 3: Auto-sync correct Application ID to `synced_users.ttn`

**File: `src/components/emulator/WebhookSettings.tsx`**

- In `loadSettings()` Step 6 (auto-sync), when a fresh pull Application ID differs from the `synced_users.ttn` mirror, also update the `synced_users.ttn.application_id` directly (not just `ttn_settings`)
- This prevents the stale value from persisting across sessions

### Change 4: Suppress misleading "Application ID Mismatch" warning

**File: `src/components/emulator/WebhookSettings.tsx`**

- The mismatch alert (showing "User config has `si` but local ttn_settings has `yq`") is confusing because it compares two wrong sources. After changes 1-3, this alert should only show when there's a genuine conflict between the user's FrostGuard config and the org-level setting, not between two stale mirrors.
- Update the mismatch comparison to use the resolved `effectiveAppId` (which prioritizes the fresh pull) instead of `rawUserTTN.application_id` (which is the stale mirror).

## Technical Details

### ttn-preflight change (most important)

```typescript
// In PreflightRequest interface, add:
application_id?: string;  // Frontend-provided, takes precedence over DB mirror

// In the handler, after loading settings:
if (body.application_id && settings.application_id !== body.application_id) {
  console.warn(`[preflight] App ID override: DB has ${settings.application_id}, frontend sent ${body.application_id}`);
  settings.application_id = body.application_id;
}
```

### LoRaWANEmulator preflight call change

```typescript
// In runPreflightCheck, add application_id to the body:
const { data, error } = await supabase.functions.invoke('ttn-preflight', {
  body: {
    selected_user_id: webhookConfig.selectedUserId,
    org_id: webhookConfig.testOrgId,
    application_id: webhookConfig.ttnConfig?.applicationId,  // NEW
    devices: devicesToCheck,
  },
});
```

### Expected Result

- The preflight check will use `fg-7873654e-yq` (from the frontend's FrostGuard pull) instead of `fg-7873654e-si` (from the stale DB mirror)
- Emulation will start successfully without the "Application not found" error
- The mismatch warning will no longer appear since the effective Application ID will be consistent
- The stale `synced_users.ttn.application_id` will be corrected on the next load

