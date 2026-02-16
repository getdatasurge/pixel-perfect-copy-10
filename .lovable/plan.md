

# Fix: Door Sensors Show "Temp" Badge Instead of "Door"

## Investigation Summary

I thoroughly traced the code and confirmed that the three requested changes are **already present** in the source files:

1. `src/lib/frostguardOrgSync.ts` line 22: `sensor_kind: 'temp' | 'door' | 'combo'` (correct)
2. `src/components/emulator/UserSelectionGate.tsx` line 244: `s.sensor_kind === 'door' ? 'door' : 'temperature'` (correct)
3. Both `categoryToType` maps contain all 12 entries including `contact`, `temperature_humidity`, and `multi_sensor` (correct)

However, the bug persists in the preview. The most likely cause: **stale session cache**. Devices pulled before the fix were stored in `sessionStorage` with `type: 'temperature'` (because `s.type` was `undefined` at that time). On page reload within 15 minutes, the cached data is restored without re-running the classification logic.

## Plan

### Step 1: Force cache invalidation
Add a **cache version stamp** to the stored user context. When the stored version doesn't match the current code version, discard the cache and force a fresh pull. This prevents stale data from surviving code fixes.

In `UserSelectionGate.tsx`:
- Add a constant `const CONTEXT_VERSION = 2;` near the storage key
- Store the version when saving context: `storedContext.version = CONTEXT_VERSION`
- On restore, check `if (context.version !== CONTEXT_VERSION)` and discard stale cache

### Step 2: Add diagnostic logging
Add a temporary `console.log` during the pull that prints each sensor's raw `sensor_kind` value and the resulting `deviceType`. This will confirm the mapping works correctly on the next fresh pull.

### Step 3: Verify end-to-end
After the cache invalidation is deployed, the next page load will force a fresh pull from FrostGuard. "Door Sensor 1" should then display a "Door" badge.

## Technical Details

```text
Session restore flow (current):
  Page load -> sessionStorage.get -> if < 15 min old -> restore cached devices
                                                         (may have wrong type!)

Session restore flow (after fix):
  Page load -> sessionStorage.get -> if version != 2 -> DISCARD, force re-pull
                                  -> if < 15 min old -> restore cached devices
                                                         (type is correct)
```

### Files to modify
- `src/components/emulator/UserSelectionGate.tsx`: Add `CONTEXT_VERSION` constant and version check in the session restore `useEffect`

