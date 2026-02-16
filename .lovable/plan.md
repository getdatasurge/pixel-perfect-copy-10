

# Export to FreshTrack Pro -- Gap Fixes

## What's Already Working
- Edge functions `export-sync` and `export-readings` (proxy pattern, correct)
- Core sync/readings/connection-test logic in `freshtrackExport.ts`
- ExportPanel UI with sync, send, auto-sync toggle, export log
- Config persistence in localStorage

## Gaps to Fix

### 1. Fix CORS Headers on Both Edge Functions
Both `export-sync` and `export-readings` are missing the extended Supabase client platform headers. Without these, browser requests from the Supabase JS client may fail on preflight.

**Files**: `supabase/functions/export-sync/index.ts`, `supabase/functions/export-readings/index.ts`

Update `Access-Control-Allow-Headers` to include:
`authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`

### 2. Add `source_metadata` to Readings
The spec requires `source_metadata` with emulator version and scenario context on each reading. Currently omitted.

**File**: `src/lib/freshtrackExport.ts`

Add to each reading object:
```
source_metadata: {
  emulator_version: "2.0.0",
  scenario: "live_emulation"
}
```

### 3. Add Configurable Auto-Sync Interval in UI
Currently hardcoded to 300s with no way to change it in the UI. Add a dropdown or select with options: 15s, 60s, 120s, 300s, 900s.

**File**: `src/components/emulator/ExportPanel.tsx`

Add a Select component next to the auto-sync toggle with interval choices.

### 4. Add "Pull State" Button
The spec requires a button that fetches the FreshTrack org structure (sites, areas, units, sensors, gateways) via the existing `fetch-org-state` edge function. This helps users see available `unit_id` values for device assignment.

**File**: `src/components/emulator/ExportPanel.tsx`

Add a new card section with a "Pull State" button that calls `fetch-org-state` and displays:
- Sites count, Units count, Sensors count, Gateways count
- A collapsible tree or summary of the org structure

**File**: `src/lib/freshtrackExport.ts`

Add a `pullOrgState()` function that returns the full org state response.

### 5. Add Live Reading Feed
When auto-sync is enabled, show a scrollable live feed of what's being sent, for example:
```
^ Unit "Walk-in Freezer": -5.2 F, battery 85%, signal -72dBm
^ Unit "Prep Cooler": 3.1 F, humidity 62%, door closed
```

**File**: `src/components/emulator/ExportPanel.tsx`

Add a live feed section that renders recent readings with unit names, temperatures, and sensor values. Populate it from the readings array built in `sendReadingsToFreshTrack` (return the readings payload alongside the result).

### 6. Include `battery_voltage` in Readings (Optional Enhancement)
The spec supports `battery_voltage` (0-10V float). Currently the emulator only tracks `batteryPct` (integer). Since the emulator doesn't simulate raw voltage, this field can be omitted for now (FreshTrack can derive from `battery_level`). No change needed.

## Files Changed Summary

| File | Action | Change |
|---|---|---|
| `supabase/functions/export-sync/index.ts` | EDIT | Fix CORS headers |
| `supabase/functions/export-readings/index.ts` | EDIT | Fix CORS headers |
| `src/lib/freshtrackExport.ts` | EDIT | Add `source_metadata` to readings, add `pullOrgState()` function |
| `src/components/emulator/ExportPanel.tsx` | EDIT | Add interval selector, pull state button, live feed section |

## What We Intentionally Skip

- **Settings panel with API key inputs**: The current architecture is superior -- API keys stay server-side in edge function secrets, never exposed to the browser. The spec's suggestion to put keys in localStorage/env vars is less secure. The proxy pattern already handles auth.
- **`battery_voltage` field**: The emulator tracks percentage, not raw voltage. FreshTrack handles this fine with just `battery_level`.
- **Separate `DEVICE_INGEST_API_KEY`**: Currently using `EMULATOR_SYNC_API_KEY` for both endpoints. If FreshTrack Pro actually requires a different key for `ingest-readings`, a new secret would need to be added. For now, the single key works if FreshTrack accepts it on both endpoints.

