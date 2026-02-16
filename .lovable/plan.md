
# Fix: Door Sensors Show "Temp" Badge Despite Name Saying "Door"

## Root Cause

The issue is NOT stale cache or a field name mismatch. Both are already fixed. The real problem:

1. FrostGuard's database has `sensor_kind = 'temp'` for the sensor named "Door Sensor 1" (a data quality issue on the FrostGuard side)
2. The emulator tries `findDeviceByName("Door Sensor 1")` to get the correct type from the Device Library, but "Door Sensor 1" is a generic name -- not a known model name like "LDDS75" or "WS301" -- so it returns `null`
3. With no library match, the code falls back to `sensor_kind` from FrostGuard, which is `'temp'`, so the device gets classified as `'temperature'`

The "Type Mismatch" badge visible in the screenshots actually confirms this: it detected that the name implies "door" but the assigned type is "temperature". However, it only warns -- it does not correct the type.

## Fix

Add a **name-based heuristic fallback** in `UserSelectionGate.tsx`. When both the library match AND the `sensor_kind` fail to identify the correct type, check if the sensor name contains keywords like "door", "contact", "leak", or "motion" and override accordingly.

### File: `src/components/emulator/UserSelectionGate.tsx`

After the existing library match block (around line 271), add a name-based fallback:

```typescript
// Fallback: if no library match, infer type from sensor name
// This handles generic names like "Door Sensor 1" where FrostGuard
// may have an incorrect sensor_kind value
if (!libraryDevice) {
  const lowerName = s.name.toLowerCase();
  if (lowerName.includes('door') || lowerName.includes('contact')) {
    deviceType = 'door';
  } else if (lowerName.includes('leak') || lowerName.includes('motion')) {
    deviceType = 'door';
  }
}
```

This reuses the same logic that the "Type Mismatch" badge already uses to detect the problem -- but now it actually fixes the type instead of just warning about it.

### Also: Bump cache version

Change `CONTEXT_VERSION` from `2` to `3` to force a re-pull with the new name-based heuristic, ensuring any cached devices get reclassified.

### Summary of changes

- **`src/components/emulator/UserSelectionGate.tsx`**: Add name-based type inference fallback after the library match block; bump `CONTEXT_VERSION` to `3`
- No other files need changes

### Expected result

After this fix, "Door Sensor 1" will:
- Show a **Door** badge (not Temp)
- Show **"1 door sensor selected"** in the status bar
- The "Type Mismatch" warning will disappear since the name and type now agree
