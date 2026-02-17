# Sensor Emulator Export — Full Integration Prompt for Lovable

> **Purpose:** This document is a self-contained prompt you give to Lovable so it can build an "Export to FreshTrack Pro" feature inside the sensor emulator (Project 2). The emulator must export data in the exact format that FreshTrack Pro (Project 1) consumes. Everything Lovable needs — every schema, every enum, every field alias, every validation rule — is included below.

---

## 1. Project Context

The **Sensor Emulator** is a standalone web app (Project 2) that simulates LoRaWAN gateways, devices, and sensors for testing. **FreshTrack Pro** (Project 1) is the production cold-chain monitoring app that consumes real sensor data.

The emulator needs an **Export** feature that pushes its simulated state to FreshTrack Pro via three HTTP endpoints:

| # | Endpoint | Direction | Purpose |
|---|----------|-----------|---------|
| 1 | `emulator-sync` | Emulator → FreshTrack | Register/sync gateways, devices, and sensors |
| 2 | `ingest-readings` | Emulator → FreshTrack | Send live telemetry (temperature, humidity, door, battery) |
| 3 | `org-state-api` | FreshTrack → Emulator | Pull authoritative org state (sites, areas, units, sensors, gateways) |

All three are Supabase Edge Functions (Deno-based). The emulator calls them via standard `fetch()` HTTPS requests.

---

## 2. Configuration / Settings

Build a **Settings page** (or panel) where the user configures connection details. Use environment variables as defaults with UI overrides:

| Setting | Env Var Fallback | FrostGuard Server Env Var | Description |
|---------|-----------------|--------------------------|-------------|
| FreshTrack Supabase URL | `VITE_FRESHTRACK_SUPABASE_URL` | — | Base URL, e.g. `https://mfwyiifehsvwnjwqoxht.supabase.co` |
| Emulator Sync API Key | `VITE_EMULATOR_SYNC_API_KEY` | `EMULATOR_SYNC_API_KEY` | Key for `emulator-sync` endpoint |
| Device Ingest API Key | `VITE_DEVICE_INGEST_API_KEY` | `DEVICE_INGEST_API_KEY` | Key for `ingest-readings` endpoint |
| Org State Sync API Key | `VITE_ORG_STATE_SYNC_API_KEY` | `PROJECT2_SYNC_API_KEY` | Key for `org-state-api` endpoint |
| Organization ID | `VITE_FRESHTRACK_ORG_ID` | — | UUID of the org in FreshTrack Pro |

> **Important:** The emulator stores these as `VITE_`-prefixed environment variables (standard for Vite frontends). The FrostGuard server uses the names in the third column. The **values** must match — they are compared for equality on every request.

**Persist** these in localStorage. Show a "Test Connection" button that hits the `org-state-api?action=health` endpoint (no auth required) to verify the URL is correct.

---

## 3. Endpoint 1: `emulator-sync` (POST) — Registration Sync

### 3.1 URL & Authentication

```
POST {SUPABASE_URL}/functions/v1/emulator-sync
```

**Headers** (choose one auth method):
```
Content-Type: application/json
Authorization: Bearer {EMULATOR_SYNC_API_KEY}
```
or:
```
Content-Type: application/json
X-Emulator-Sync-Key: {EMULATOR_SYNC_API_KEY}
```

**Max payload:** 1 MB

### 3.2 Top-Level Payload Schema

```typescript
{
  org_id: string;          // REQUIRED — UUID of the organization
  sync_id?: string;        // Optional — max 100 chars, for tracking
  synced_at: string;       // REQUIRED — ISO 8601 datetime (e.g. "2026-02-15T10:30:00.000Z")
  gateways?: Gateway[];    // Max 50 per request, defaults to []
  devices?: Device[];      // Max 100 per request, defaults to []
  sensors?: Sensor[];      // Max 100 per request, defaults to []
}
```

### 3.3 Gateway Schema

```typescript
interface Gateway {
  gateway_eui: string;     // REQUIRED — 1-32 chars (e.g. "A84041FFFF1A2B3C")
  name: string;            // REQUIRED — 1-100 chars
  status?: "pending" | "online" | "offline" | "maintenance";  // Default: "pending"
  site_id?: string | null; // UUID — links to a FreshTrack site
  description?: string | null;  // Max 500 chars
}
```

### 3.4 Device Schema

```typescript
interface Device {
  serial_number: string;   // REQUIRED — 1-100 chars (org-scoped uniqueness)
  unit_id?: string | null; // UUID — links to a FreshTrack unit
  status?: "active" | "inactive" | "fault";  // Default: "inactive"
  mac_address?: string | null;     // Max 50 chars
  firmware_version?: string | null; // Max 50 chars

  // If dev_eui is provided, a corresponding lora_sensor is auto-created
  dev_eui?: string | null;         // Max 32 chars (e.g. "A84041B3D1C2E4F5")
  sensor_type?: SensorType;        // See Section 6 for enum values
  name?: string | null;            // Max 100 chars
  model?: string | null;           // Max 100 chars (e.g. "LDS02", "EM300-TH")
  manufacturer?: string | null;    // Max 100 chars (e.g. "Dragino", "Milesight")

  // For payload-based sensor type inference:
  decoded_payload?: Record<string, unknown> | null;  // Sample payload from this device
  unit_name?: string | null;       // Max 200 chars — used for model extraction fallback
}
```

### 3.5 Sensor Schema

```typescript
interface Sensor {
  dev_eui: string;         // REQUIRED — 1-32 chars (e.g. "A84041B3D1C2E4F5")
  name: string;            // REQUIRED — 1-100 chars
  sensor_type?: SensorType; // See Section 6. Inferred if not provided
  status?: "pending" | "joining" | "active" | "offline" | "fault"; // Default: "pending"
  unit_id?: string | null; // UUID — links to a FreshTrack unit
  site_id?: string | null; // UUID — links to a FreshTrack site
  manufacturer?: string | null; // Max 100 chars
  model?: string | null;   // Max 100 chars

  // OTAA credentials for TTN provisioning
  app_eui?: string | null;  // Max 32 chars (8-byte hex, e.g. "0000000000000000")
  app_key?: string | null;  // Max 64 chars (32-byte hex, e.g. "2B7E151628AED2A6ABF7158809CF4F3C")

  // TTN registration info
  ttn_device_id?: string | null;       // Max 100 chars (e.g. "eui-a84041b3d1c2e4f5")
  ttn_application_id?: string | null;  // Max 100 chars (e.g. "freshtrack-pro-prod")

  // Payload-based inference fields
  decoded_payload?: Record<string, unknown> | null;  // Sample payload for type inference
  unit_name?: string | null;  // Max 200 chars — model extraction fallback
}
```

### 3.6 Response Format

**Success (HTTP 200):**
```json
{
  "success": true,
  "sync_run_id": "uuid",
  "counts": {
    "gateways": { "created": 1, "updated": 0, "skipped": 0 },
    "devices": { "created": 3, "updated": 1, "skipped": 0 },
    "sensors": { "created": 3, "updated": 1, "skipped": 0 }
  },
  "warnings": [],
  "errors": [],
  "processed_at": "2026-02-15T10:30:01.234Z"
}
```

**Partial success (HTTP 207):**
Same format but `errors` array is non-empty.

**Validation error (HTTP 400):**
```json
{
  "error": "Validation error",
  "details": [{ "path": "sensors.0.dev_eui", "message": "Device EUI required" }]
}
```

---

## 4. Endpoint 2: `ingest-readings` (POST) — Live Telemetry

### 4.1 URL & Authentication

```
POST {SUPABASE_URL}/functions/v1/ingest-readings
```

**Headers** (choose one auth method):
```
Content-Type: application/json
X-Device-API-Key: {DEVICE_INGEST_API_KEY}
```
or:
```
Content-Type: application/json
Authorization: Bearer {DEVICE_INGEST_API_KEY}
```

### 4.2 Request Payload

```typescript
{
  readings: Reading[];  // REQUIRED — 1 to 100 readings per request
}
```

### 4.3 Reading Schema

```typescript
interface Reading {
  unit_id: string;                // REQUIRED — UUID of the FreshTrack unit
  temperature: number;            // REQUIRED — value in the unit specified by temperature_unit
                                  // Valid range: -100 to 300 (any unit)
  temperature_unit?: "C" | "F";   // Default: "C" — the system converts to °F for storage
  device_serial?: string;         // Max 50 chars — links to a device for battery tracking
  device_model?: string;          // Max 100 chars — used for native temp unit inference
  humidity?: number;              // Integer, 0-100 (percentage)
  battery_level?: number;         // Integer, 0-100 (percentage)
  battery_voltage?: number;       // Float, 0-10 volts (raw pack voltage)
  signal_strength?: number;       // Integer, -150 to 0 (dBm, e.g. -85)
  door_open?: boolean;            // true = open, false = closed
  source: "ttn" | "ble" | "simulator" | "manual_sensor" | "api";  // REQUIRED
  source_metadata?: Record<string, unknown>;  // Vendor-specific debug data
  recorded_at?: string;           // ISO 8601 datetime — when sensor recorded this
}
```

**IMPORTANT: Temperature Unit Handling**
- Most LoRaWAN sensors report in Celsius. Default `temperature_unit` is `"C"`.
- The `ingest-readings` function automatically converts to Fahrenheit (°F) for storage.
- If your emulator generates temperature in Fahrenheit, set `temperature_unit: "F"` to skip conversion.
- If you provide `device_model`, the system can auto-detect the native unit.

### 4.4 Response Format

**Success (HTTP 200):**
```json
{
  "success": true,
  "ingested": 5,
  "failed": 0,
  "results": [
    { "unit_id": "uuid-1", "success": true },
    { "unit_id": "uuid-2", "success": true }
  ]
}
```

**Partial failure:**
```json
{
  "success": true,
  "ingested": 3,
  "failed": 2,
  "results": [
    { "unit_id": "uuid-1", "success": true },
    { "unit_id": "uuid-bad", "success": false, "error": "Unit not found" }
  ]
}
```

### 4.5 What Happens Server-Side

When readings are ingested, FreshTrack Pro automatically:
1. **Converts temperature** from sensor unit to storage unit (°F)
2. **Updates the unit** with `last_temp_reading`, `last_reading_at`, `last_checkin_at`
3. **Tracks sensor reliability** via `consecutive_checkins` (reliable after 2 consecutive check-ins within 12.5 min)
4. **Creates door events** if door state changed (or is the first reading)
5. **Updates device battery** and signal info if `device_serial` is provided
6. **Sets unit status** to "ok" when valid readings arrive

---

## 5. Endpoint 3: `org-state-api` (GET) — Pull State from FreshTrack Pro

### 5.1 URL & Authentication

```
GET {SUPABASE_URL}/functions/v1/org-state-api?org_id={ORG_ID}
```

**Headers** (choose one):
```
Authorization: Bearer {ORG_STATE_SYNC_API_KEY}
```
or:
```
X-Sync-API-Key: {ORG_STATE_SYNC_API_KEY}
```

### 5.2 Actions

| Action | URL | Auth? | Purpose |
|--------|-----|-------|---------|
| Health check | `?action=health` | No | Verify endpoint is reachable |
| Dirty check | `?org_id=X&check_only=true` | Yes | Check if org state has changed since last sync |
| Full state pull | `?org_id=X` | Yes | Get complete org state |
| Debug mode | Add header `X-Debug: 1` | Yes | Includes timing and count metadata |

### 5.3 Full State Response (HTTP 200)

```typescript
{
  success: true;
  request_id: string;
  organization_id: string;
  sync_version: number;
  updated_at: string;
  sites: Array<{
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    timezone: string;
    is_active: boolean;
  }>;
  areas: Array<{
    id: string;
    name: string;
    description: string | null;
    site_id: string;      // FK to sites
    sort_order: number;
    is_active: boolean;
  }>;
  units: Array<{
    id: string;
    name: string;
    unit_type: string;
    area_id: string;      // FK to areas
    site_id: string;      // FK to sites
    temp_limit_high: number;   // Alarm threshold (°F)
    temp_limit_low: number | null;
    status: string;
    is_active: boolean;
    created_at: string;
  }>;
  sensors: Array<{
    id: string;
    name: string;
    dev_eui: string;
    app_eui: string | null;
    sensor_type: string;
    status: string;
    site_id: string | null;
    unit_id: string | null;
    ttn_device_id: string | null;
    ttn_application_id: string | null;
    manufacturer: string | null;
    model: string | null;
    is_primary: boolean;
    last_seen_at: string | null;
  }>;
  gateways: Array<{
    id: string;
    name: string;
    gateway_eui: string;
    status: string;
    site_id: string | null;
    description: string | null;
    last_seen_at: string | null;
  }>;
  ttn: {
    enabled: boolean;
    provisioning_status: string;
    cluster: string | null;
    application_id: string | null;
    webhook_id: string | null;
    webhook_url: string | null;
    api_key_last4: string | null;
    updated_at: string | null;
  };
}
```

**Use this endpoint to:**
- Discover which `unit_id` values exist so the emulator can target readings at real units
- Check which sensors are already registered
- Display FreshTrack org structure in the emulator UI

---

## 6. Sensor Type Enum

All 11 valid values for `sensor_type`:

| Value | Description | Key Payload Fields |
|-------|-------------|-------------------|
| `"temperature"` | Temperature-only sensor | `temperature` |
| `"temperature_humidity"` | Temperature + humidity | `temperature`, `humidity` |
| `"door"` | Door/contact sensor | `door_open`, `door_status`, `DOOR_OPEN_STATUS` |
| `"combo"` | Combined temp + door | `temperature`, `door_open` |
| `"contact"` | Generic contact sensor | `contact`, `contactStatus` |
| `"motion"` | Motion/occupancy sensor | `motion`, `occupancy`, `pir` |
| `"leak"` | Water leak detection | `water_leak`, `leak`, `flood` |
| `"metering"` | Pulse counter / meter | `pulse_count`, `total_count`, `counter` |
| `"gps"` | GPS / location tracker | `latitude`, `longitude`, `gps` |
| `"air_quality"` | Air quality (CO2, VOC, PM) | `co2`, `tvoc`, `pm25`, `pm10` |
| `"multi_sensor"` | Multi-function sensor | Multiple field types |

---

## 7. Sensor Status Enum & Priority

| Value | Priority | Description |
|-------|----------|-------------|
| `"fault"` | 0 (lowest) | Hardware failure |
| `"pending"` | 1 | Not yet commissioned |
| `"joining"` | 2 | Attempting LoRaWAN join |
| `"offline"` | 3 | Was active, now not reporting |
| `"active"` | 4 (highest) | Working normally |

**IMPORTANT:** FreshTrack Pro will **never downgrade** status. If the sensor is already `"active"` and the emulator sends `"pending"`, FreshTrack keeps `"active"`. Only send higher-priority statuses or the same status.

---

## 8. Gateway Status Enum

| Value | Description |
|-------|-------------|
| `"pending"` | Not yet configured |
| `"online"` | Operational |
| `"offline"` | Not responding |
| `"maintenance"` | Under maintenance |

---

## 9. Device Status Enum

| Value | Description |
|-------|-------------|
| `"active"` | Operational |
| `"inactive"` | Not in use |
| `"fault"` | Hardware failure |

---

## 10. Complete Device Model Registry

FreshTrack Pro recognizes 40+ device models. When the emulator provides a `model` field, FreshTrack uses it to infer `sensor_type` and native temperature unit automatically.

### 10.1 Model → Category → Sensor Type

| Model | Manufacturer | Category | Sensor Type | Native Temp Unit |
|-------|-------------|----------|-------------|-----------------|
| **Temperature** | | | | |
| `EM300-TH` | Milesight | temperature | temperature | °C |
| `ERS` | Elsys | temperature | temperature | °C |
| `ERS-CO2` | Elsys | temperature | temperature | °C |
| `EM500-PP` | Milesight | temperature | temperature | °C |
| `EM500-PT100` | Milesight | temperature | temperature | °C |
| `EM500-SMTC` | Milesight | temperature | temperature | °C |
| `EM500-SWL` | Milesight | temperature | temperature | °C |
| `EM500-UDL` | Milesight | temperature | temperature | °C |
| `WS301` | Milesight | temperature | temperature | °C |
| `WS302` | Milesight | temperature | temperature | °C |
| `WS303` | Milesight | temperature | temperature | °C |
| `AM103` | Milesight | temperature | temperature | °C |
| `AM104` | Milesight | temperature | temperature | °C |
| `AM107` | Milesight | temperature | temperature | °C |
| `AM308` | Milesight | temperature | temperature | °C |
| **Dragino Temperature** | | | | |
| `LHT65` | Dragino | — | — | °C |
| `LHT65N` | Dragino | — | — | °C |
| `LHT52` | Dragino | — | — | °C |
| `LSN50v2` | Dragino | — | — | °C |
| `LSN50v2-D23` | Dragino | — | — | °C |
| **Door / Contact** | | | | |
| `LDS02` | Dragino | door | door | °C |
| `R311A` | Netvox | door | door | °C |
| `DS3604` | — | door | door | °C |
| `WS101` | Milesight | door | door | °C |
| `WS156` | Milesight | door | door | °C |
| **Motion** | | | | |
| `TBMS100` | Milesight | motion | motion | °C |
| **Leak Detection** | | | | |
| `LDDS75` | Dragino | leak | leak | °C |
| `R718WA2` | Netvox | leak | leak | — |
| `EM500-SWL-L050` | Milesight | leak | leak | °C |
| **Metering** | | | | |
| `KONA Pulse Counter` | — | metering | metering | — |
| `EM500-PP-L050` | Milesight | metering | metering | — |
| **GPS / Location** | | | | |
| `LT-22222-L` | Dragino | gps | gps | °C |
| `TBS220` | — | gps | gps | °C |
| **Air Quality** | | | | |
| `AM319` | Milesight | air_quality | air_quality | °C |
| `ERS CO2` | Elsys | air_quality | air_quality | °C |
| `AM103L` | Milesight | air_quality | air_quality | °C |
| `AM104L` | Milesight | air_quality | air_quality | °C |
| `AM107L` | Milesight | air_quality | air_quality | °C |
| **Multi-Sensor** | | | | |
| `EM300-MCS` | Milesight | multi_sensor | multi_sensor | °C |
| `EM300-MCS-L050` | Milesight | multi_sensor | multi_sensor | °C |
| `EM310-UDL` | Milesight | multi_sensor | multi_sensor | °C |

**Model matching is flexible:** FreshTrack does exact match, case-insensitive match, then partial/prefix match. So `"EM300-TH-868"` will match `"EM300-TH"`.

---

## 11. Payload Field Normalization — All Recognized Aliases

When FreshTrack Pro receives payloads (via `decoded_payload` or readings), it normalizes vendor-specific field names to canonical fields. Here is every alias it recognizes:

### 11.1 Door Status Aliases (priority order — first match wins)

| Alias | Vendor | Value Type |
|-------|--------|------------|
| `door_open` | Generic | boolean |
| `DOOR_OPEN_STATUS` | Dragino LDS02 (TTN) | number (1=open, 0=closed) |
| `door_status` | Generic | string ("open"/"closed") or boolean |
| `open_state_abs` | — | number |
| `doorStatus` | camelCase variant | boolean |
| `door` | Simplified | boolean or number |
| `open_close` | DS3604 | number (1=open, 0=closed) |
| `contactStatus` | Contact sensor | boolean |

**Value conversion rules:**
- `boolean` → used directly
- `number` → `1` = open (true), `0` = closed (false)
- `string` → `"open"`, `"true"`, `"1"` = open; `"close"`, `"closed"`, `"false"`, `"0"` = closed

### 11.2 Door Open Count Aliases

| Alias | Vendor |
|-------|--------|
| `open_count` | Generic |
| `DOOR_OPEN_TIMES` | Dragino LDS02 (TTN) |
| `open_times` | — |
| `door_open_times` | — |

### 11.3 Door Open Duration Aliases

| Alias | Vendor | Unit |
|-------|--------|------|
| `open_duration_s` | Generic | Seconds (already canonical) |
| `LAST_DOOR_OPEN_DURATION` | Dragino LDS02 (TTN) | Minutes (converted to seconds) |
| `open_duration` | — | Minutes → seconds |
| `last_open_duration` | — | Minutes → seconds |
| `last_door_open_duration` | — | Minutes → seconds |

### 11.4 Temperature Aliases

| Alias | Vendor |
|-------|--------|
| `temperature` | Canonical — always checked first |
| `TempC_SHT` | Dragino LHT65N (internal SHT sensor) |
| `TempC_DS` | Dragino (external DS18B20 probe) |
| `temperature_c` | Catalog decoders |
| `temp_c` | Catalog decoders |
| `temp` | Simplified |

### 11.5 Humidity Aliases

| Alias | Vendor |
|-------|--------|
| `humidity` | Canonical |
| `Hum_SHT` | Dragino LHT65N |
| `humidity_pct` | Catalog decoders |
| `relative_humidity` | Catalog decoders |

### 11.6 Battery Voltage Aliases

| Alias | Vendor |
|-------|--------|
| `BatV` | Dragino (all models) |
| `BAT_V` | Uppercase variant |
| `bat_v` | Lowercase variant |
| `battery_v` | Catalog decoders |
| `battery_volt_abs` | — |
| `batteryVoltage` | camelCase |
| `vbat` | — |

### 11.7 Payload-Based Sensor Type Inference Fields

These are the fields FreshTrack checks (in priority order) to infer sensor type from payload content:

| Field | Inferred Type | Priority |
|-------|--------------|----------|
| `door_status`, `door_open`, `DOOR_OPEN_STATUS`, `door_open_status`, `door`, `open_close`, `contact`, `contactStatus`, `open_state_abs` | `door` | Highest |
| `water_leak`, `leak`, `flood`, `water_detected` | `leak` | High |
| `motion`, `occupancy`, `pir`, `movement` | `motion` | Medium-high |
| `co2`, `tvoc`, `pm25`, `pm10`, `voc` | `air_quality` | Medium |
| `gps`, `latitude`, `longitude`, `location` | `gps` | Medium-low |
| `pulse_count`, `total_count`, `counter`, `pulses` | `metering` | Low |
| `humidity`, `relative_humidity`, `rh` | `temperature_humidity` | Lower |
| `temperature`, `temp` | `temperature` | Lowest |

---

## 12. Sensor Type Inference Chain (5-Layer Priority)

When FreshTrack Pro receives a sensor via `emulator-sync`, it determines the sensor type using this priority chain:

```
1. Explicit sensor_type         ← If emulator sends sensor_type, use it (highest priority)
      ↓ (if not provided)
2. Infer from decoded_payload   ← Check payload field keys against Section 11.7
      ↓ (if no match)
3. Infer model from payload     ← Match payload structure against known sample DB
      ↓ (if no model inferred)
4. Extract model from unit_name ← Parse model prefix from name (e.g. "LDS02 Kitchen" → "LDS02")
      ↓ (if no model found)
5. Infer type from model        ← Look up model in Section 10.1 registry
      ↓ (if still unknown)
6. Default to "temperature"     ← Last resort fallback
```

**Recommendation for the emulator:** Always include `sensor_type` explicitly when exporting. This guarantees correct classification without relying on inference.

---

## 13. Decoded Payload Examples (Sample Payloads by Sensor Type)

Include these as `decoded_payload` in the sensor or device to help FreshTrack auto-classify:

### Door Sensor (LDS02)
```json
{
  "door_status": "closed",
  "battery_level": 90
}
```

### Door Sensor (R311A)
```json
{
  "door": true,
  "battery_voltage": 3.0
}
```

### Door Sensor (DS3604)
```json
{
  "open_close": 0,
  "battery_level": 95
}
```

### Temperature + Humidity (EM300-TH)
```json
{
  "temperature": 22.1,
  "humidity": 45.3,
  "battery_level": 95
}
```

### Temperature (ERS)
```json
{
  "temperature": 21.5,
  "humidity": 50.0,
  "battery_level": 100
}
```

### Temperature (EM500-PT100)
```json
{
  "temperature": 25.0
}
```

### Motion (TBMS100)
```json
{
  "motion": true,
  "battery_level": 85
}
```

### Leak Detection (LDDS75)
```json
{
  "water_leak": true,
  "battery_level": 80
}
```

### Leak Detection (R718WA2)
```json
{
  "leak": true,
  "battery_voltage": 3.2
}
```

### Air Quality (AM319)
```json
{
  "temperature": 23.5,
  "humidity": 50,
  "co2": 450,
  "tvoc": 120
}
```

### Air Quality (ERS-CO2)
```json
{
  "temperature": 22.0,
  "humidity": 45,
  "co2": 500
}
```

### GPS / Location (LT-22222-L)
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "battery_level": 75
}
```

### GPS / Location (TBS220)
```json
{
  "gps": { "lat": 40.7128, "lon": -74.0060 },
  "battery_level": 80
}
```

### Metering / Pulse Counter
```json
{
  "pulse_count": 1234,
  "total_count": 5678
}
```

### Multi-Sensor (EM300-MCS)
```json
{
  "temperature": 22.0,
  "humidity": 50,
  "door_status": "closed",
  "battery_level": 85
}
```

---

## 14. Battery Chemistry & Voltage-to-Percentage Conversion

FreshTrack Pro converts raw battery voltage to percentage using chemistry-specific discharge curves. When the emulator provides `battery_voltage`, the app uses these curves:

### 14.1 Supported Chemistries

| Chemistry ID | Aliases | Cell Config | Voltage Range | Typical Sensors |
|-------------|---------|-------------|---------------|-----------------|
| `CR17450` | `li-mno2` | Single 3.0V cell | 2.50–3.00V | — |
| `LiFeS2_AA` | `lifes2`, `lithium`, `li`, `li-fes2` | 2× AA series | 1.80–3.60V | Dragino LDS02, LHT65N |
| `Alkaline_AA` | `alkaline` | 2× AA series | 1.60–3.20V | — |
| `CR2032` | — | Single coin cell | 2.20–3.00V | Small sensors |

### 14.2 Voltage-to-Percentage Curves

**CR17450 (flat discharge):**
| Voltage | % |
|---------|---|
| 3.00V | 100% |
| 2.95V | 80% |
| 2.85V | 50% |
| 2.75V | 20% |
| 2.60V | 5% |
| 2.50V | 0% |

**LiFeS2 AA (2-cell pack — most common, DEFAULT):**
| Voltage | % |
|---------|---|
| 3.60V | 100% |
| 3.20V | 80% |
| 2.80V | 50% |
| 2.40V | 20% |
| 2.00V | 5% |
| 1.80V | 0% |

**Alkaline AA (2-cell pack):**
| Voltage | % |
|---------|---|
| 3.20V | 100% |
| 2.80V | 70% |
| 2.40V | 40% |
| 2.00V | 15% |
| 1.80V | 5% |
| 1.60V | 0% |

**CR2032 (coin cell):**
| Voltage | % |
|---------|---|
| 3.00V | 100% |
| 2.90V | 80% |
| 2.70V | 50% |
| 2.50V | 20% |
| 2.30V | 5% |
| 2.20V | 0% |

Between curve points, FreshTrack uses **linear interpolation**.

**Legacy fallback (deprecated):** `percent = ((voltage - 3.0) / 0.6) × 100` clamped 0-100.

**Recommendation for emulator:** Either send `battery_level` (integer 0-100) directly, or send `battery_voltage` (float) and let FreshTrack compute the percentage.

---

## 15. Downlink Command System

FreshTrack Pro can send configuration commands to sensors via TTN LoRaWAN downlinks. The emulator should understand these commands to simulate device responses.

### 15.1 Command Types & Hex Templates

All commands use **fport 2** by default. All downlinks are **unconfirmed** and use the **REPLACE** queue operation (wipes existing queue, sends one command).

| Command Type | Hex Template | Parameters | Example |
|-------------|-------------|------------|---------|
| `uplink_interval` | `01` + 3-byte seconds (big-endian) | `seconds`: 1–16,777,215 | `01000258` = 600s (10 min) |
| `ext_mode` | Fixed 2-byte code | `mode`: `"e3_ext1"` or `"e3_ext9"` | `A201` = E3 mode 1, `A209` = E3 mode 9 (with timestamp) |
| `time_sync` | `28` + `01`/`00` | `enable`: boolean | `2801` = on, `2800` = off |
| `time_sync_days` | `29` + 1-byte days | `days`: 0–255 | `291E` = 30 days |
| `set_time` | `30` + 4-byte unix timestamp + `00` | `unix_ts`: 0–4,294,967,295 | `306587C65F00` |
| `alarm` | `AA` + WMOD(1B) + CITEMP(2B) + TEMPlow(2B) + TEMPhigh(2B) | See below | `AA01000A05DC09C4` |
| `clear_datalog` | `A301` | None | `A301` |
| `pnackmd` | `34` + `01`/`00` | `enable`: boolean | `3401` = on, `3400` = off |
| `raw` | User-provided hex | `hex`: string, `fport?`: number | Any valid hex |

### 15.2 Alarm Command Encoding

```
AA + WMOD + CITEMP + TEMPlow + TEMPhigh
```

- **WMOD**: `01` = enabled, `00` = disabled (1 byte)
- **CITEMP**: Check interval in minutes, 1–65,535 (2 bytes, big-endian)
- **TEMPlow**: Low threshold in °C × 100, signed int16 (2 bytes)
- **TEMPhigh**: High threshold in °C × 100, signed int16 (2 bytes)

Example: Alarm on, check every 10 min, 15°C–25°C:
- WMOD = `01`
- CITEMP = 10 = `000A`
- TEMPlow = 15.0 × 100 = 1500 = `05DC`
- TEMPhigh = 25.0 × 100 = 2500 = `09C4`
- Full hex: `AA01000A05DC09C4`

Negative temperatures use signed int16:
- -10.5°C × 100 = -1050 = `0x10000 + (-1050)` = `0xFBE6` → `FBE6`

### 15.3 Pending Change Status Flow

```
queued → sent → applied
                  ↓
                failed
                  ↓
               timeout (after 24 hours)
```

### 15.4 Pending Change Data Structure

```typescript
interface SensorPendingChange {
  id: string;                    // UUID
  sensor_id: string;             // FK to lora_sensors
  change_type: "uplink_interval" | "ext_mode" | "time_sync" | "set_time" |
               "alarm" | "clear_datalog" | "pnackmd" | "raw";
  status: "queued" | "sent" | "applied" | "failed" | "timeout";
  requested_payload_hex: string; // e.g. "01000258"
  requested_fport: number;       // Default 2
  command_params: Record<string, unknown> | null;
  expected_result: string | null; // Human-readable
  sent_at: string | null;
  applied_at: string | null;
  requested_by_email: string | null;
}
```

### 15.5 Sensor Configuration State

After a downlink is confirmed, FreshTrack persists these values:

```typescript
interface SensorConfiguration {
  uplink_interval_s: number | null;        // Seconds
  ext_mode: "e3_ext1" | "e3_ext9" | null;
  time_sync_enabled: boolean;
  time_sync_days: number | null;
  alarm_enabled: boolean;
  alarm_low: number | null;                // °C
  alarm_high: number | null;               // °C
  alarm_check_minutes: number | null;
  default_fport: number;                   // Default 2
  pending_change_id: string | null;        // Current pending change
  last_applied_at: string | null;
}
```

---

## 16. Validation Constraints Reference

| Field | Type | Required | Min | Max | Notes |
|-------|------|----------|-----|-----|-------|
| `org_id` | UUID string | Yes | — | — | Must exist in FreshTrack |
| `sync_id` | string | No | — | 100 chars | — |
| `synced_at` | ISO 8601 | Yes | — | — | Must be valid datetime |
| **Gateway** | | | | | |
| `gateway_eui` | string | Yes | 1 | 32 | — |
| `name` | string | Yes | 1 | 100 | — |
| `description` | string | No | — | 500 | — |
| **Device** | | | | | |
| `serial_number` | string | Yes | 1 | 100 | Org-scoped unique |
| `mac_address` | string | No | — | 50 | — |
| `firmware_version` | string | No | — | 50 | — |
| `dev_eui` | string | No | — | 32 | Triggers auto-sensor |
| `name` | string | No | — | 100 | — |
| `model` | string | No | — | 100 | — |
| `manufacturer` | string | No | — | 100 | — |
| `unit_name` | string | No | — | 200 | — |
| **Sensor** | | | | | |
| `dev_eui` | string | Yes | 1 | 32 | — |
| `name` | string | Yes | 1 | 100 | — |
| `manufacturer` | string | No | — | 100 | — |
| `model` | string | No | — | 100 | — |
| `app_eui` | string | No | — | 32 | 8-byte hex |
| `app_key` | string | No | — | 64 | 32-byte hex |
| `ttn_device_id` | string | No | — | 100 | — |
| `ttn_application_id` | string | No | — | 100 | — |
| `unit_name` | string | No | — | 200 | — |
| **Reading** | | | | | |
| `unit_id` | UUID | Yes | — | — | Must exist |
| `temperature` | number | Yes | -100 | 300 | Any unit |
| `device_serial` | string | No | — | 50 | — |
| `device_model` | string | No | — | 100 | — |
| `humidity` | integer | No | 0 | 100 | Percentage |
| `battery_level` | integer | No | 0 | 100 | Percentage |
| `battery_voltage` | number | No | 0 | 10 | Volts |
| `signal_strength` | integer | No | -150 | 0 | dBm |
| `source` | enum | Yes | — | — | See Section 4.3 |

---

## 17. Export Button UX Guidance

### 17.1 UI Components

Build an **"Export to FreshTrack Pro"** section in the emulator with:

1. **Sync Devices button** — Calls `emulator-sync` to register all gateways, devices, and sensors
2. **Send Readings button** — Calls `ingest-readings` to push current telemetry values
3. **Pull State button** — Calls `org-state-api` to fetch org structure and populate emulator
4. **Auto-sync toggle** — Periodically sends readings at the emulated sensor's uplink interval
5. **Status indicator** — Shows last sync time, success/failure, counts

### 17.2 Success Display

After a successful sync, show:
```
✓ Sync complete
  Gateways: 1 created, 0 updated
  Devices: 5 created, 2 updated
  Sensors: 5 created, 2 updated
  Sync Run: abc123-uuid
```

### 17.3 Error Display

On validation error, show the specific field path and message:
```
✗ Validation error
  sensors.0.dev_eui: Device EUI required
  sensors.2.name: Sensor name required
```

On auth error:
```
✗ Authentication failed
  Check your Emulator Sync API Key in Settings
```

### 17.4 Reading Stream UI

When auto-sync is enabled, show a live feed:
```
↑ Unit "Walk-in Freezer": -5.2°C, battery 85%, signal -72dBm
↑ Unit "Prep Cooler": 3.1°C, humidity 62%, door closed
↑ Unit "Dry Storage": 21.5°C, humidity 45%
```

---

## 18. Complete Working Examples

### 18.1 Full emulator-sync Payload

```json
{
  "org_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_id": "emulator-session-2026-02-15",
  "synced_at": "2026-02-15T10:30:00.000Z",
  "gateways": [
    {
      "gateway_eui": "A84041FFFF1A2B3C",
      "name": "Warehouse Gateway 1",
      "status": "online",
      "site_id": "660e8400-e29b-41d4-a716-446655440001",
      "description": "Main warehouse LoRaWAN gateway"
    }
  ],
  "devices": [
    {
      "serial_number": "EMU-DEV-001",
      "status": "active",
      "dev_eui": "A84041B3D1C2E001",
      "sensor_type": "temperature",
      "name": "EM300-TH Freezer",
      "model": "EM300-TH",
      "manufacturer": "Milesight",
      "decoded_payload": {
        "temperature": -18.5,
        "humidity": 40,
        "battery_level": 95
      }
    },
    {
      "serial_number": "EMU-DEV-002",
      "status": "active",
      "dev_eui": "A84041B3D1C2E002",
      "sensor_type": "door",
      "name": "LDS02 Freezer Door",
      "model": "LDS02",
      "manufacturer": "Dragino",
      "decoded_payload": {
        "door_status": "closed",
        "battery_level": 88
      }
    },
    {
      "serial_number": "EMU-DEV-003",
      "status": "active",
      "dev_eui": "A84041B3D1C2E003",
      "sensor_type": "air_quality",
      "name": "AM319 Office",
      "model": "AM319",
      "manufacturer": "Milesight",
      "decoded_payload": {
        "temperature": 22.0,
        "humidity": 48,
        "co2": 520,
        "tvoc": 85
      }
    }
  ],
  "sensors": []
}
```

### 18.2 Full ingest-readings Payload

```json
{
  "readings": [
    {
      "unit_id": "770e8400-e29b-41d4-a716-446655440001",
      "temperature": -18.5,
      "temperature_unit": "C",
      "humidity": 40,
      "battery_level": 95,
      "signal_strength": -85,
      "source": "simulator",
      "device_serial": "EMU-DEV-001",
      "device_model": "EM300-TH",
      "recorded_at": "2026-02-15T10:30:00.000Z",
      "source_metadata": {
        "emulator_version": "1.0.0",
        "scenario": "normal_operation"
      }
    },
    {
      "unit_id": "770e8400-e29b-41d4-a716-446655440001",
      "temperature": -17.8,
      "temperature_unit": "C",
      "door_open": true,
      "battery_level": 88,
      "signal_strength": -72,
      "source": "simulator",
      "device_serial": "EMU-DEV-002",
      "device_model": "LDS02",
      "recorded_at": "2026-02-15T10:30:00.000Z"
    },
    {
      "unit_id": "770e8400-e29b-41d4-a716-446655440002",
      "temperature": 3.1,
      "temperature_unit": "C",
      "humidity": 62,
      "battery_level": 78,
      "battery_voltage": 3.15,
      "signal_strength": -90,
      "source": "simulator",
      "recorded_at": "2026-02-15T10:30:00.000Z"
    }
  ]
}
```

### 18.3 org-state-api Health Check

```bash
curl -X GET "https://your-project.supabase.co/functions/v1/org-state-api?action=health"
```

Response:
```json
{
  "ok": true,
  "version": "1.1.0",
  "timestamp": "2026-02-15T10:30:00.000Z",
  "request_id": "uuid",
  "env_configured": {
    "supabase_url": true,
    "sync_api_key": true
  }
}
```

### 18.4 org-state-api Full Pull

```bash
curl -X GET "https://your-project.supabase.co/functions/v1/org-state-api?org_id=550e8400-e29b-41d4-a716-446655440000" \
  -H "X-Sync-API-Key: your-api-key"
```

---

## 19. Critical Implementation Notes

1. **Sensor status is never downgraded** by FreshTrack. If a sensor is already `"active"`, sending `"pending"` won't change it. Only send equal or higher priority statuses (`fault=0 < pending=1 < joining=2 < offline=3 < active=4`).

2. **Temperature is stored in °F** by FreshTrack. All LoRaWAN sensors report in °C. Always send `temperature_unit: "C"` and let the server convert.

3. **Battery voltage overrides battery_level** on the server side. If you send `battery_voltage`, FreshTrack will compute the percentage from chemistry curves and ignore any `battery_level` value. Send one or the other, not both (unless you want the voltage curve to take precedence).

4. **`dev_eui` on a device auto-creates a sensor.** If you include `dev_eui` in the device payload, FreshTrack automatically creates a corresponding `lora_sensor` record. You don't need to send the same sensor in both `devices[]` and `sensors[]`.

5. **Always include `sensor_type` explicitly.** This guarantees correct classification without relying on the 5-layer inference chain.

6. **Max payload sizes:** `emulator-sync` allows max 50 gateways, 100 devices, 100 sensors per request. `ingest-readings` allows max 100 readings per request.

7. **Use canonical field names** in readings (`temperature`, `humidity`, `door_open`, `battery_level`). The alias system in Section 11 is for incoming real-world sensor payloads — the emulator should use the canonical names directly.

---

## 20. Implementation Checklist

- [ ] **Settings page** with Supabase URL, 3 API keys, and org ID inputs (localStorage persistence, env var fallbacks)
- [ ] **Test Connection button** that hits `org-state-api?action=health`
- [ ] **Pull State button** that fetches org structure via `org-state-api?org_id=X`
- [ ] **Sync Devices function** that builds the `emulator-sync` payload from the emulator's current state
  - Includes all gateways with `gateway_eui` and `name`
  - Includes all devices with `serial_number`, `dev_eui`, `model`, `manufacturer`, `sensor_type`, `decoded_payload`
  - Always sends explicit `sensor_type`
  - Handles the response: parse `counts`, display `warnings` and `errors`
- [ ] **Send Readings function** that builds the `ingest-readings` payload
  - Maps emulated sensor values to `unit_id` (from pulled state)
  - Sends `temperature_unit: "C"`
  - Includes `source: "simulator"`
  - Includes `device_serial` and `device_model` for proper battery tracking
  - Batches up to 100 readings per request
- [ ] **Auto-sync loop** that sends readings at configurable intervals (default: 300 seconds / 5 minutes)
- [ ] **Status display** showing last sync time, next sync, success/failure counts
- [ ] **Error handling** with user-friendly messages for auth failures, validation errors, network errors
- [ ] **Export log** showing history of sync operations with timestamps and results
