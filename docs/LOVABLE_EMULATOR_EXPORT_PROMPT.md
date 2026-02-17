# Sensor Emulator Export — Full Integration Prompt for Lovable

> **Purpose:** This document is a self-contained prompt you give to Lovable so it can build an "Export to FreshTrack Pro" feature inside the sensor emulator (Project 2). The emulator must export data in the exact format that FreshTrack Pro (Project 1) consumes. Everything Lovable needs — every schema, every enum, every field alias, every validation rule — is included below.
>
> **Verified against FrostGuard codebase:** Every schema, enum, alias list, battery curve, and validation constraint in this document has been cross-referenced with the actual FrostGuard source code.

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

**Max payload:** 1 MB (1,048,576 bytes)

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
  app_eui?: string | null;  // Max 32 chars (8-byte hex)
  app_key?: string | null;  // Max 64 chars (32-byte hex)

  // TTN registration info
  ttn_device_id?: string | null;       // Max 100 chars
  ttn_application_id?: string | null;  // Max 100 chars

  // Payload-based inference fields
  decoded_payload?: Record<string, unknown> | null;
  unit_name?: string | null;  // Max 200 chars
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

**Partial success (HTTP 207):** Same format but `errors` array is non-empty.

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
  temperature: number;            // REQUIRED — valid range: -100 to 300
  temperature_unit?: "C" | "F";   // Default: "C" — system converts to °F for storage
  device_serial?: string;         // Max 50 chars — links to a device for battery tracking
  device_model?: string;          // Max 100 chars — used for native temp unit inference
  humidity?: number;              // Integer, 0-100 (percentage)
  battery_level?: number;         // Integer, 0-100 (percentage)
  battery_voltage?: number;       // Float, 0-10 volts
  signal_strength?: number;       // Integer, -150 to 0 (dBm)
  door_open?: boolean;            // true = open, false = closed
  source: "ttn" | "ble" | "simulator" | "manual_sensor" | "api";  // REQUIRED
  source_metadata?: Record<string, unknown>;
  recorded_at?: string;           // ISO 8601 datetime
}
```

**Temperature Unit Handling:**
- Default is `"C"`. System converts to °F for storage: `F = (C × 9/5) + 32`
- Priority: explicit `temperature_unit` > `device_model` inference > default (°C)
- All known sensor models report in °C

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

### 4.5 What Happens Server-Side

When readings are ingested, FreshTrack Pro automatically:
1. **Converts temperature** from sensor unit to storage unit (°F)
2. **Updates the unit** with `last_temp_reading`, `last_reading_at`, `last_checkin_at`
3. **Tracks sensor reliability** — reliable after 2 consecutive check-ins within 12.5 min (5 min × 2.5 buffer)
4. **Creates door events** if door state changed or is the first reading
5. **Updates device battery** and signal info if `device_serial` provided
6. **Sets unit status** to "ok" when valid readings arrive

---

## 5. Endpoint 3: `org-state-api` (GET) — Pull State

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
| Dirty check | `?org_id=X&check_only=true` | Yes | Check if state changed |
| Full state pull | `?org_id=X` | Yes | Get complete org state |
| Debug mode | Add header `X-Debug: 1` | Yes | Includes timing metadata |

### 5.3 Full State Response (HTTP 200)

```typescript
{
  success: true;
  request_id: string;
  organization_id: string;
  sync_version: number;
  updated_at: string;
  sites: Array<{
    id: string; name: string; address: string | null;
    city: string | null; state: string | null;
    timezone: string; is_active: boolean;
  }>;
  areas: Array<{
    id: string; name: string; description: string | null;
    site_id: string; sort_order: number; is_active: boolean;
  }>;
  units: Array<{
    id: string; name: string; unit_type: string;
    area_id: string; site_id: string;
    temp_limit_high: number; temp_limit_low: number | null;
    status: string; is_active: boolean; created_at: string;
  }>;
  sensors: Array<{
    id: string; name: string; dev_eui: string;
    app_eui: string | null; sensor_type: string; status: string;
    site_id: string | null; unit_id: string | null;
    ttn_device_id: string | null; ttn_application_id: string | null;
    manufacturer: string | null; model: string | null;
    is_primary: boolean; last_seen_at: string | null;
  }>;
  gateways: Array<{
    id: string; name: string; gateway_eui: string;
    status: string; site_id: string | null;
    description: string | null; last_seen_at: string | null;
  }>;
  ttn: {
    enabled: boolean; provisioning_status: string;
    cluster: string | null; application_id: string | null;
    webhook_id: string | null; webhook_url: string | null;
    api_key_last4: string | null; updated_at: string | null;
  };
}
```

---

## 6. Sensor Type Enum

All 11 valid values:

| Value | Description | Key Payload Fields |
|-------|-------------|-------------------|
| `"temperature"` | Temperature-only | `temperature` |
| `"temperature_humidity"` | Temp + humidity | `temperature`, `humidity` |
| `"door"` | Door/contact sensor | `door_open`, `door_status`, `DOOR_OPEN_STATUS` |
| `"combo"` | Combined temp + door | `temperature`, `door_open` |
| `"contact"` | Generic contact | `contact`, `contactStatus` |
| `"motion"` | Motion/occupancy | `motion`, `occupancy`, `pir` |
| `"leak"` | Water leak detection | `water_leak`, `leak`, `flood` |
| `"metering"` | Pulse counter / meter | `pulse_count`, `total_count`, `counter` |
| `"gps"` | GPS / location tracker | `latitude`, `longitude`, `gps` |
| `"air_quality"` | Air quality (CO2, VOC, PM) | `co2`, `tvoc`, `pm25`, `pm10` |
| `"multi_sensor"` | Multi-function | Multiple field types |

---

## 7. Sensor Status Enum & Priority

| Value | Priority | Description |
|-------|----------|-------------|
| `"fault"` | 0 (lowest) | Hardware failure |
| `"pending"` | 1 | Not yet commissioned |
| `"joining"` | 2 | Attempting LoRaWAN join |
| `"offline"` | 3 | Was active, now not reporting |
| `"active"` | 4 (highest) | Working normally |

**IMPORTANT:** FreshTrack Pro will **never downgrade** status. Only send higher-priority statuses or the same status.

## 8. Gateway Status Enum

`"pending"` | `"online"` | `"offline"` | `"maintenance"`

## 9. Device Status Enum

`"active"` | `"inactive"` | `"fault"`

---

## 10. Device Model Registry

### 10.1 Full Registry — 35 Models with Sensor Type Inference

| Model | Manufacturer | Category | Sensor Type | Temp Unit |
|-------|-------------|----------|-------------|-----------|
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
| `LDS02` | Dragino | door | door | °C |
| `R311A` | Netvox | door | door | °C |
| `DS3604` | — | door | door | °C |
| `WS101` | Milesight | door | door | °C |
| `WS156` | Milesight | door | door | °C |
| `TBMS100` | Milesight | motion | motion | °C |
| `LDDS75` | Dragino | leak | leak | °C |
| `R718WA2` | Netvox | leak | leak | — |
| `EM500-SWL-L050` | Milesight | leak | leak | °C |
| `KONA Pulse Counter` | — | metering | metering | — |
| `EM500-PP-L050` | Milesight | metering | metering | — |
| `LT-22222-L` | Dragino | gps | gps | °C |
| `TBS220` | — | gps | gps | °C |
| `AM319` | Milesight | air_quality | air_quality | °C |
| `ERS CO2` | Elsys | air_quality | air_quality | °C |
| `AM103L` | Milesight | air_quality | air_quality | °C |
| `AM104L` | Milesight | air_quality | air_quality | °C |
| `AM107L` | Milesight | air_quality | air_quality | °C |
| `EM300-MCS` | Milesight | multi_sensor | multi_sensor | °C |
| `EM300-MCS-L050` | Milesight | multi_sensor | multi_sensor | °C |
| `EM310-UDL` | Milesight | multi_sensor | multi_sensor | °C |

### 10.2 Native Unit Only — No Sensor Type Inference

These models are recognized for temperature unit detection only. **You MUST send explicit `sensor_type`.**

| Model | Manufacturer | Temp Unit |
|-------|-------------|-----------|
| `LHT65` | Dragino | °C |
| `LHT65N` | Dragino | °C |
| `LHT52` | Dragino | °C |
| `LSN50v2` | Dragino | °C |
| `LSN50v2-D23` | Dragino | °C |

### 10.3 Model Matching

Three-tier: exact → case-insensitive → partial/prefix (`"EM300-TH-868"` matches `"EM300-TH"`).

---

## 11. Payload Field Normalization — All Recognized Aliases

### 11.1 Door Status Aliases (priority order — first match wins)

| Alias | Value Type |
|-------|------------|
| `door_open` | boolean |
| `DOOR_OPEN_STATUS` | number (1=open, 0=closed) |
| `door_status` | string ("open"/"closed") or boolean |
| `open_state_abs` | number |
| `doorStatus` | boolean |
| `door` | boolean or number |
| `open_close` | number (1=open, 0=closed) |
| `contactStatus` | boolean |

**Conversion:** boolean direct; number `1`=open `0`=closed; string `"open"`/`"true"`/`"1"`=open, `"close"`/`"closed"`/`"false"`/`"0"`=closed.

### 11.2 Door Open Count Aliases

`open_count` | `DOOR_OPEN_TIMES` | `open_times` | `door_open_times`

### 11.3 Door Open Duration Aliases

| Alias | Unit |
|-------|------|
| `open_duration_s` | Seconds (canonical) |
| `LAST_DOOR_OPEN_DURATION` | Minutes → ×60 |
| `open_duration` | Minutes → ×60 |
| `last_open_duration` | Minutes → ×60 |
| `last_door_open_duration` | Minutes → ×60 |

Rule: Fields ending with `_s` are seconds; all others are minutes (multiplied by 60).

### 11.4 Temperature Aliases

`temperature` (canonical) | `TempC_SHT` | `TempC_DS` | `temperature_c` | `temp_c` | `temp`

### 11.5 Humidity Aliases

`humidity` (canonical) | `Hum_SHT` | `humidity_pct` | `relative_humidity`

### 11.6 Battery Voltage Aliases

`BatV` | `BAT_V` | `bat_v` | `battery_v` | `battery_volt_abs` | `batteryVoltage` | `vbat`

**Note:** When a voltage alias is found, the `battery` percentage is ALWAYS derived from voltage using chemistry curves — overriding any existing `battery` value (some decoders set it to a 0-3 enum, not a percentage).

### 11.7 Payload-Based Sensor Type Inference (priority order)

| Fields | Inferred Type |
|--------|--------------|
| `door_status`, `door_open`, `DOOR_OPEN_STATUS`, `door_open_status`, `door`, `open_close`, `contact`, `contactStatus`, `open_state_abs` | `door` |
| `water_leak`, `leak`, `flood`, `water_detected` | `leak` |
| `motion`, `occupancy`, `pir`, `movement` | `motion` |
| `co2`, `tvoc`, `pm25`, `pm10`, `voc` | `air_quality` |
| `gps`, `latitude`, `longitude`, `location` | `gps` |
| `pulse_count`, `total_count`, `counter`, `pulses` | `metering` |
| `humidity`, `relative_humidity`, `rh` | `temperature_humidity` |
| `temperature`, `temp` | `temperature` |

---

## 12. Sensor Type Inference Chain

```
1. Explicit sensor_type           ← highest priority
      ↓
2. Infer from decoded_payload     ← check field keys (§11.7)
      ↓
3. Infer model from payload       ← match against 15 known sample payloads
      ↓
4. Extract model from unit_name   ← parse prefix (e.g. "LDS02 Kitchen" → "LDS02")
      ↓
5. Infer type from model          ← §10.1 registry ONLY (35 models, NOT §10.2)
      ↓
6. Default to "temperature"       ← last resort
```

> **Always include `sensor_type` explicitly.** This guarantees correct classification.

---

## 13. Sample Payloads (from FrostGuard's internal DB)

**LDS02:** `{ "door_status": "closed", "battery_level": 90 }`
**R311A:** `{ "door": true, "battery_voltage": 3.0 }`
**DS3604:** `{ "open_close": 0, "battery_level": 95 }`
**EM300-TH:** `{ "temperature": 22.1, "humidity": 45.3, "battery_level": 95 }`
**ERS:** `{ "temperature": 21.5, "humidity": 50.0, "battery_level": 100 }`
**EM500-PT100:** `{ "temperature": 25.0 }`
**TBMS100:** `{ "motion": true, "battery_level": 85 }`
**LDDS75:** `{ "water_leak": true, "battery_level": 80 }`
**R718WA2:** `{ "leak": true, "battery_voltage": 3.2 }`
**AM319:** `{ "temperature": 23.5, "humidity": 50, "co2": 450, "tvoc": 120 }`
**ERS-CO2:** `{ "temperature": 22.0, "humidity": 45, "co2": 500 }`
**AM103:** `{ "temperature": 24.0, "humidity": 55, "co2": 420 }`
**LT-22222-L:** `{ "latitude": 40.7128, "longitude": -74.006, "battery_level": 75 }`
**TBS220:** `{ "gps": { "lat": 40.7128, "lon": -74.006 }, "battery_level": 80 }`
**KONA Pulse Counter:** `{ "pulse_count": 1234, "total_count": 5678 }`
**EM500-PP:** `{ "counter": 100, "battery_level": 90 }`
**EM300-MCS:** `{ "temperature": 22.0, "humidity": 50, "door_status": "closed", "battery_level": 85 }`

---

## 14. Battery Chemistry & Voltage-to-Percentage

**Default chemistry:** LiFeS2_AA (most common).

| Chemistry | Aliases | Voltage Range |
|-----------|---------|---------------|
| `CR17450` | `li-mno2` | 2.50–3.00V |
| `LiFeS2_AA` | `lifes2`, `lithium`, `li`, `li-fes2` | 1.80–3.60V |
| `Alkaline_AA` | `alkaline` | 1.60–3.20V |
| `CR2032` | — | 2.20–3.00V |

**CR17450:** 3.00V=100%, 2.95V=80%, 2.85V=50%, 2.75V=20%, 2.60V=5%, 2.50V=0%
**LiFeS2_AA (default):** 3.60V=100%, 3.20V=80%, 2.80V=50%, 2.40V=20%, 2.00V=5%, 1.80V=0%
**Alkaline_AA:** 3.20V=100%, 2.80V=70%, 2.40V=40%, 2.00V=15%, 1.80V=5%, 1.60V=0%
**CR2032:** 3.00V=100%, 2.90V=80%, 2.70V=50%, 2.50V=20%, 2.30V=5%, 2.20V=0%

Between points: **linear interpolation**.

**Legacy fallback (deprecated):** `percent = ((voltage - 3.0) / 0.6) × 100` clamped 0-100.

**Recommendation:** Send `battery_level` (0-100) directly, or `battery_voltage` and let FreshTrack compute it.

---

## 15. Downlink Command System

All commands use **fport 2**, **unconfirmed**, **REPLACE** queue.

| Command | Hex Template | Parameters |
|---------|-------------|------------|
| `uplink_interval` | `01` + 3-byte seconds | `seconds`: 1–16,777,215 |
| `ext_mode` | `A201` or `A209` | `mode`: `e3_ext1` or `e3_ext9` |
| `time_sync` | `2801`/`2800` | `enable`: boolean |
| `time_sync_days` | `29` + 1-byte | `days`: 0–255 |
| `set_time` | `30` + 4-byte unix + `00` | `unix_ts` |
| `alarm` | `AA` + WMOD(1B) + CITEMP(2B) + TEMPlow(2B) + TEMPhigh(2B) | See below |
| `clear_datalog` | `A301` | None |
| `pnackmd` | `3401`/`3400` | `enable`: boolean |
| `raw` | User hex | `hex`, optional `fport` |

**Alarm encoding:** `AA` + WMOD(`01`/`00`) + check_minutes(2B BE) + low_°C×100(signed int16) + high_°C×100(signed int16). High must be > low.

**Pending change flow:** `queued → sent → applied` (or `failed` → `timeout` after 24h)

---

## 16. Validation Constraints

| Field | Type | Required | Min | Max |
|-------|------|----------|-----|-----|
| `org_id` | UUID | Yes | — | — |
| `sync_id` | string | No | — | 100 |
| `gateway_eui` | string | Yes | 1 | 32 |
| `gateway.name` | string | Yes | 1 | 100 |
| `gateway.description` | string | No | — | 500 |
| `serial_number` | string | Yes | 1 | 100 |
| `dev_eui` | string | Sensor: Yes, Device: No | 1 | 32 |
| `sensor.name` | string | Yes | 1 | 100 |
| `model` | string | No | — | 100 |
| `manufacturer` | string | No | — | 100 |
| `app_eui` | string | No | — | 32 |
| `app_key` | string | No | — | 64 |
| `unit_name` | string | No | — | 200 |
| `temperature` | number | Yes | -100 | 300 |
| `humidity` | integer | No | 0 | 100 |
| `battery_level` | integer | No | 0 | 100 |
| `battery_voltage` | number | No | 0 | 10 |
| `signal_strength` | integer | No | -150 | 0 |
| `device_serial` | string | No | — | 50 |
| `device_model` | string | No | — | 100 |

---

## 17. Export UX Guidance

1. **Sync Devices button** → calls `emulator-sync`
2. **Send Readings button** → calls `ingest-readings`
3. **Pull State button** → calls `org-state-api`
4. **Auto-sync toggle** → sends readings at configurable interval (default 300s)
5. **Status indicator** → last sync time, counts, errors

**Success:** Show counts per entity type (created/updated/skipped) and sync_run_id.
**Error:** Show field path + message for validation errors. Show "Check API Key" for auth errors.
**Live feed:** Show unit name, temperature, battery, signal, door state per reading sent.

---

## 18. Complete Working Examples

### 18.1 emulator-sync

```json
{
  "org_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_id": "emulator-session-2026-02-15",
  "synced_at": "2026-02-15T10:30:00.000Z",
  "gateways": [{
    "gateway_eui": "A84041FFFF1A2B3C",
    "name": "Warehouse Gateway 1",
    "status": "online",
    "site_id": "660e8400-e29b-41d4-a716-446655440001",
    "description": "Main warehouse LoRaWAN gateway"
  }],
  "devices": [
    {
      "serial_number": "EMU-DEV-001", "status": "active",
      "dev_eui": "A84041B3D1C2E001", "sensor_type": "temperature",
      "name": "EM300-TH Freezer", "model": "EM300-TH", "manufacturer": "Milesight",
      "decoded_payload": { "temperature": -18.5, "humidity": 40, "battery_level": 95 }
    },
    {
      "serial_number": "EMU-DEV-002", "status": "active",
      "dev_eui": "A84041B3D1C2E002", "sensor_type": "door",
      "name": "LDS02 Freezer Door", "model": "LDS02", "manufacturer": "Dragino",
      "decoded_payload": { "door_status": "closed", "battery_level": 88 }
    }
  ],
  "sensors": []
}
```

### 18.2 ingest-readings

```json
{
  "readings": [
    {
      "unit_id": "770e8400-e29b-41d4-a716-446655440001",
      "temperature": -18.5, "temperature_unit": "C",
      "humidity": 40, "battery_level": 95, "signal_strength": -85,
      "source": "simulator", "device_serial": "EMU-DEV-001", "device_model": "EM300-TH",
      "recorded_at": "2026-02-15T10:30:00.000Z",
      "source_metadata": { "emulator_version": "1.0.0" }
    },
    {
      "unit_id": "770e8400-e29b-41d4-a716-446655440001",
      "temperature": -17.8, "temperature_unit": "C",
      "door_open": true, "battery_level": 88, "signal_strength": -72,
      "source": "simulator", "device_serial": "EMU-DEV-002", "device_model": "LDS02",
      "recorded_at": "2026-02-15T10:30:00.000Z"
    }
  ]
}
```

### 18.3 Health Check

```
GET /functions/v1/org-state-api?action=health
→ { "ok": true, "version": "1.1.0", "timestamp": "...", "request_id": "...", "env_configured": { "supabase_url": true, "sync_api_key": true } }
```

---

## 19. Implementation Checklist

- [ ] **Settings page** with Supabase URL, 3 API keys, org ID (localStorage, env fallbacks)
- [ ] **Test Connection** hits `org-state-api?action=health`
- [ ] **Pull State** fetches org structure via `org-state-api?org_id=X`
- [ ] **Sync Devices** builds `emulator-sync` payload — always sends explicit `sensor_type`
- [ ] **Send Readings** builds `ingest-readings` payload with `source: "simulator"`, `temperature_unit: "C"`, `device_serial`, `device_model`
- [ ] **Auto-sync loop** at configurable interval (default 300s)
- [ ] **Status display** with last sync time, counts, errors
- [ ] **Error handling** for auth, validation, and network failures
- [ ] **Export log** with history of sync operations
