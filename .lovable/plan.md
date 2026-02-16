
# Fix Build Errors: Missing DeviceCategory Keys

## Problem
The `DeviceCategory` type was expanded with 3 new values (`contact`, `multi_sensor`, `temperature_humidity`) to match the FreshTrack Pro spec, but 4 files that use `Record<DeviceCategory, ...>` were not updated. This causes TypeScript build errors and breaks the app.

## Changes

### 1. `src/components/emulator/AddSensorDropdown.tsx` (2 fixes)
Add the 3 missing categories to both `CATEGORY_ICONS` and `CATEGORY_LABELS`:
- `contact` -> DoorOpen icon, "Contact"
- `multi_sensor` -> Zap icon, "Multi-Sensor"  
- `temperature_humidity` -> Thermometer icon, "Temp + Humidity"

### 2. `src/components/emulator/DeviceManager.tsx` (1 fix)
Add missing categories to `categoryToType` map at line 349:
- `contact` -> `'door'`
- `multi_sensor` -> `'temperature'`
- `temperature_humidity` -> `'temperature'`

### 3. `src/components/emulator/UserSelectionGate.tsx` (1 fix)
Add same 3 missing categories to `categoryToType` map at line 217:
- `contact` -> `'door'`
- `multi_sensor` -> `'temperature'`
- `temperature_humidity` -> `'temperature'`

### 4. `src/lib/freshtrackExport.ts` (1 fix)
Fix type cast at line 700: change `(fetchError as Record<string, unknown>)` to `(fetchError as unknown as Record<string, unknown>)` to satisfy TypeScript's type overlap check.

### 5. `src/lib/deviceLibrary/schema.ts` (1 fix)
Add the 3 new categories to the Zod `deviceCategorySchema` enum at line 95 so library validation accepts devices with these categories.

## Result
All 5 build errors resolved. The app will compile and the Add Sensor dropdown will work again.
