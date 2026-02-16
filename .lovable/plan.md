

# Fix: Door Sensors Show "Temp" Badge Instead of "Door"

## Root Cause
FrostGuard's API returns `sensor_kind` (values: `'temp'`, `'door'`, `'combo'`), but the `OrgStateSensor` interface declares the field as `type`. At runtime `s.type` is always `undefined`, so every sensor defaults to `'temperature'`.

## Changes

### 1. `src/lib/frostguardOrgSync.ts` (line 22)
Rename the interface field from `type` to `sensor_kind`:
```
sensor_kind: 'temp' | 'door' | 'combo';
```

### 2. `src/components/emulator/UserSelectionGate.tsx` (line 250)
Update the fallback mapping from `s.type` to `s.sensor_kind`:
```
deviceType = s.sensor_kind === 'door' ? 'door' : 'temperature';
```

### 3. No changes needed to `categoryToType` maps
Both `UserSelectionGate.tsx` and `DeviceManager.tsx` already have all 12 category entries including `contact`, `temperature_humidity`, and `multi_sensor` (fixed in a previous round).

## Result
- Door sensors pulled from FrostGuard will correctly show a "Door" badge
- The status bar will report the correct sensor type counts
- `'temp'` and `'combo'` sensors continue to map to `'temperature'`
