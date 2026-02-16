
# Fix: Default Device Library Validation Errors (3 errors)

## Root Cause

The default device library has 2 devices with `manufacturer: ''` (empty string):
- `generic-tbs220` (TBS220 GPS Tracker)
- `generic-ds3604` (DS3604 Door Sensor)

The Zod schema requires `manufacturer: z.string().min(1)`, so empty strings fail validation. This produces 3 errors:
1. `generic-tbs220.manufacturer` fails min(1)
2. `generic-ds3604.manufacturer` fails min(1)
3. The metadata refinement fails because `''` is not in `metadata.manufacturers`

This is why the console shows `[DeviceLibraryStore] Default library invalid: Array(3)` and the Add Sensor dropdown is stuck on "Loading library..."

## Fix

**File: `src/lib/deviceLibrary/defaultLibrary.ts`**

1. Change `generic-tbs220` manufacturer from `''` to `'Generic'` (line 198)
2. Change `generic-ds3604` manufacturer from `''` to `'Generic'` (line 355)
3. Add `'Generic'` to `metadata.manufacturers` array (line 23)

This satisfies both the field-level min(1) check and the metadata refinement that requires all device manufacturers to be listed in the metadata.
