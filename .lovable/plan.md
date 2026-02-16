

# Fix: Stale API Key in synced_users (Last Synced Jan 20)

## Problem

The emulator's database has **month-old credentials** for user `sustainablerealestatefl@gmail.com`:

```text
Field              Database (Jan 20)      FrostGuard (Current)
-----------------------------------------------------------------
Application ID     fg-7873654e-si         fg-7873654e-yq
API Key            ****JLCQ               ****GA0A
Last Synced        2026-01-20             Never re-synced
```

The previous fix patches the Application ID on-the-fly (since the fresh pull provides it), but the **full API key** cannot be corrected client-side because FrostGuard's live pull only returns the last 4 characters for security. The full key is only sent through the `user-sync` pipeline, which last ran on Jan 20.

## Solution: Two-Part Fix

### Part 1: Trigger a Re-Sync from FrostGuard (Immediate)

The user-sync pipeline needs to run again from FrostGuard to push the updated credentials. This can be triggered by:

- Logging into the FrostGuard app (which triggers user-sync-emitter)
- OR manually calling the sync endpoint with the updated credentials

### Part 2: Add "Stale Credentials" Detection and Warning (Code Change)

Add a visual indicator in the Webhook Settings when the API key in the database (`synced_users.ttn.api_key_last4`) doesn't match the fresh FrostGuard pull (`config.ttnConfig.api_key_last4`). This tells the user exactly what's wrong.

**File: `src/components/emulator/WebhookSettings.tsx`**

In the `loadSettings()` function, after the existing Application ID mismatch detection (around line 825):

1. Compare `config.ttnConfig.api_key_last4` (fresh from FrostGuard: `GA0A`) against `rawUserTTN.api_key_last4` (from DB: `JLCQ`)
2. If they differ, set a new state variable `staleApiKey: true` with both values
3. Show an alert in the UI: "Your API key has changed in FrostGuard (now ending in GA0A) but the emulator still has the old key (ending in JLCQ). Please re-sync from FrostGuard to update credentials."

**Additionally**, in the auto-sync block (around line 1032), extend the `synced_users.ttn` mirror patch to also update `api_key_last4` when a mismatch is detected (though this alone won't fix the full key -- it helps with diagnostics).

### Part 3: Add Manual API Key Override (Stretch Goal)

Since the user has access to the full Application API Secret in FrostGuard's UI (ending `GA0A`), add a "Paste API Key" input field that allows manually updating the key in `synced_users.ttn.api_key` directly. This provides a workaround when the sync pipeline is broken or delayed.

## Technical Details

### New State Variable
```typescript
const [staleApiKeyWarning, setStaleApiKeyWarning] = useState<{
  dbLast4: string;
  frostguardLast4: string;
} | null>(null);
```

### Detection Logic (in loadSettings, after line ~827)
```typescript
const freshApiKeyLast4 = config.ttnConfig?.api_key_last4 || null;
const mirrorApiKeyLast4 = rawUserTTN?.api_key_last4 as string | undefined;
if (freshApiKeyLast4 && mirrorApiKeyLast4 && freshApiKeyLast4 !== mirrorApiKeyLast4) {
  console.warn(`[WebhookSettings] API Key mismatch: FrostGuard=${freshApiKeyLast4}, DB=${mirrorApiKeyLast4}`);
  setStaleApiKeyWarning({ dbLast4: mirrorApiKeyLast4, frostguardLast4: freshApiKeyLast4 });
}
```

### Warning UI (in the Application API Secret section)
An amber alert that reads:
"API key has changed in FrostGuard (now ****GA0A) but the emulator still has an older key (****JLCQ). Either re-sync from FrostGuard or paste the new key below."

### Manual Key Override Input
A conditional text input that appears when `staleApiKeyWarning` is set, allowing the user to paste the full API key from FrostGuard's UI. On submit, it updates `synced_users.ttn.api_key` and `synced_users.ttn.api_key_last4` directly.

## Immediate Action Required

Before the code fix, the quickest resolution is to **trigger a user re-sync from FrostGuard** for the Orlando Burgers organization. This will push the new API key (****GA0A) and Application ID (fg-7873654e-yq) to the emulator's database.

