

# Export to FreshTrack Pro — Implementation Plan

## Summary

Add an "Export" tab to the emulator that enables pushing simulated device state and live telemetry to FreshTrack Pro via three HTTP endpoints: `emulator-sync`, `ingest-readings`, and `org-state-api`. This builds on the existing `fetch-org-state` infrastructure and secret management.

## What Already Exists

- **`fetch-org-state` edge function** already proxies to FreshTrack's `org-state-api` using `FROSTGUARD_SUPABASE_URL` and `PROJECT2_SYNC_API_KEY` secrets
- **`sync-to-frostguard` edge function** (deprecated) already sends gateways/devices to FreshTrack's `emulator-sync` endpoint
- **`ingest-readings` edge function** exists locally (inserts into local DB), but does NOT forward to FreshTrack
- **Secrets** `FROSTGUARD_SUPABASE_URL`, `PROJECT2_SYNC_API_KEY`, `EMULATOR_SYNC_API_KEY`, and `FROSTGUARD_SYNC_SHARED_SECRET` are already configured
- **Org state** is already pulled and available in `webhookConfig` (sites, units, sensors, gateways, ttn settings)

## Architecture

The emulator already talks to FreshTrack Pro via its own edge functions (to avoid CORS). The export feature will follow the same pattern:

```text
Emulator UI
    |
    |-- POST /functions/v1/export-sync       --> FreshTrack emulator-sync
    |-- POST /functions/v1/export-readings   --> FreshTrack ingest-readings
    |-- (existing) fetch-org-state           --> FreshTrack org-state-api
```

Two new edge functions act as authenticated proxies to FreshTrack Pro. This avoids CORS issues and keeps API keys server-side.

---

## Implementation Steps

### Step 1: Create `export-sync` Edge Function

**File**: `supabase/functions/export-sync/index.ts`

This edge function proxies emulator device/gateway/sensor registration to FreshTrack Pro's `emulator-sync` endpoint.

- Accepts POST with `org_id`, `gateways[]`, `devices[]`, `sensors[]`
- Uses `FROSTGUARD_SUPABASE_URL` and `EMULATOR_SYNC_API_KEY` secrets to forward
- Returns FreshTrack's response (counts, warnings, errors)
- Adds CORS headers for browser access

**Config**: Add to `supabase/config.toml`:
```toml
[functions.export-sync]
verify_jwt = false
```

### Step 2: Create `export-readings` Edge Function

**File**: `supabase/functions/export-readings/index.ts`

This edge function proxies telemetry readings to FreshTrack Pro's `ingest-readings` endpoint.

- Accepts POST with `readings[]` array matching the FreshTrack Reading schema
- Uses `FROSTGUARD_SUPABASE_URL` and `EMULATOR_SYNC_API_KEY` (or a dedicated ingest key) to forward
- Returns ingestion results (ingested count, failures)
- Adds CORS headers

**Config**: Add to `supabase/config.toml`:
```toml
[functions.export-readings]
verify_jwt = false
```

### Step 3: Create Export Settings Store

**File**: `src/lib/exportConfigStore.ts`

Manages export configuration in localStorage with sensible defaults:

- `freshtrackUrl`: defaults to `FROSTGUARD_SUPABASE_URL` (already known from edge functions)
- `orgId`: derived from `webhookConfig.testOrgId` (already selected by user)
- `autoSyncEnabled`: boolean
- `autoSyncIntervalSec`: default 300 (5 minutes)
- `lastSyncAt`, `lastSyncStatus`, `lastSyncCounts`
- `lastReadingsSentAt`, `lastReadingsStatus`

Since the secrets are already configured server-side, users do NOT need to enter API keys. The export just works via the proxy edge functions.

### Step 4: Create Export Service Module

**File**: `src/lib/freshtrackExport.ts`

Contains all export business logic:

**`syncDevicesToFreshTrack()`**:
- Builds the `emulator-sync` payload from current emulator state (devices, gateways, sensor states)
- Maps emulator `LoRaWANDevice` to FreshTrack `Device` schema (serial_number = devEui, model/manufacturer from device library)
- Maps emulator `GatewayConfig` to FreshTrack `Gateway` schema
- Maps to FreshTrack `Sensor` schema with sensor_type, dev_eui, model, manufacturer, OTAA keys
- Calls `export-sync` edge function via Supabase client
- Returns structured result with counts and errors

**`sendReadingsToFreshTrack()`**:
- Builds `ingest-readings` payload from current sensor states
- Maps each selected sensor to a FreshTrack `Reading`:
  - `unit_id` from device's assigned unit
  - `temperature` in Fahrenheit with `temperature_unit: "F"` (emulator stores in F)
  - `humidity`, `battery_level`, `signal_strength` from sensor state
  - `door_open` for door sensors
  - `source: "simulator"`
  - `device_serial` = devEui
  - `device_model` from device library assignment
- Calls `export-readings` edge function
- Returns ingestion results

**`testFreshTrackConnection()`**:
- Calls existing `fetch-org-state` with org_id to verify connectivity
- Returns success/failure with diagnostic details

### Step 5: Create Export Panel UI Component

**File**: `src/components/emulator/ExportPanel.tsx`

A self-contained panel rendered in a new "Export" tab:

**Sections**:

1. **Connection Status** - Shows whether FreshTrack is reachable (uses existing `fetch-org-state`). Displays org name and last sync version.

2. **Sync Devices** - Button that calls `syncDevicesToFreshTrack()`. Shows results: gateways created/updated, devices created/updated, sensors created/updated. Displays warnings and errors.

3. **Send Readings** - Button that calls `sendReadingsToFreshTrack()`. Shows per-unit results. Live feed when auto-sync is enabled.

4. **Auto-Sync Toggle** - When enabled, periodically sends readings at configured interval (default 5 min). Shows next sync countdown and last sync time.

5. **Export Log** - Scrollable list of recent export operations with timestamps, status, and counts.

**Props**: Receives `devices`, `gateways`, `sensorStates`, `webhookConfig` from parent.

### Step 6: Add Export Tab to Emulator

**File**: `src/components/LoRaWANEmulator.tsx`

- Add "Export" tab to the TabsList (changing grid-cols-7 to grid-cols-8)
- Import and render `ExportPanel` in the new TabsContent
- Pass required state: devices, gateways, sensorStates, webhookConfig

---

## Technical Details

### Payload Mapping: Emulator to FreshTrack

| Emulator Field | FreshTrack Field | Notes |
|---|---|---|
| `device.devEui` | `serial_number`, `dev_eui` | Used as both device serial and sensor EUI |
| `device.type` | `sensor_type` | "temperature" or "door" |
| `device.name` | `name` | Direct map |
| `device.joinEui` | `app_eui` | OTAA JoinEUI |
| `device.appKey` | `app_key` | OTAA AppKey |
| `gateway.eui` | `gateway_eui` | Direct map |
| `gateway.name` | `name` | Direct map |
| `gateway.isOnline` | `status` | true -> "online", false -> "offline" |
| `sensorState.tempF` | `temperature` + `temperature_unit: "F"` | Emulator stores Fahrenheit |
| `sensorState.humidity` | `humidity` | Integer 0-100 |
| `sensorState.batteryPct` | `battery_level` | Integer 0-100 |
| `sensorState.signalStrength` | `signal_strength` | dBm, -150 to 0 |
| `sensorState.doorOpen` | `door_open` | Boolean |

### Device Model Inference

The emulator has a device library system (`src/lib/deviceLibrary/`). When a sensor has `libraryDeviceId` set, we can look up manufacturer and model from the device definition. Default mappings:
- Temperature sensors: manufacturer="Milesight", model="EM300-TH"
- Door sensors: manufacturer="Dragino", model="LDS02"

### Error Handling

- Auth failures (401/403): Show "Check API key configuration in project secrets"
- Validation errors (400): Parse `details[]` array and show field-level errors
- Partial success (207): Show counts with warnings
- Network errors: Show retry guidance

### Auto-Sync Implementation

- Uses `useRef` with `setInterval` for the auto-sync loop
- Clears on component unmount or toggle off
- Shows countdown to next sync
- Pauses if last sync failed (prevents hammering on errors)

---

## Files Changed Summary

| File | Action | Purpose |
|---|---|---|
| `supabase/functions/export-sync/index.ts` | CREATE | Proxy to FreshTrack emulator-sync |
| `supabase/functions/export-readings/index.ts` | CREATE | Proxy to FreshTrack ingest-readings |
| `supabase/config.toml` | MODIFY | Add verify_jwt=false for new functions |
| `src/lib/freshtrackExport.ts` | CREATE | Export business logic |
| `src/lib/exportConfigStore.ts` | CREATE | Export settings persistence |
| `src/components/emulator/ExportPanel.tsx` | CREATE | Export UI component |
| `src/components/LoRaWANEmulator.tsx` | MODIFY | Add Export tab |

## What This Does NOT Change

- Existing TTN simulation flow (unchanged)
- Existing webhook delivery (unchanged)
- Existing `fetch-org-state` / `sync-to-frostguard` functions (unchanged)
- No new database tables required
- No new secrets required (all already configured)

