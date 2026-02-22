

# Fix AlarmScenarioRunner Unit Loading

## Problem
The `AlarmScenarioRunner` component queries `areas` and `units` database tables that don't exist in this project (confirmed by the 404 errors in the network logs). The emulator gets its unit data from the `fetch-org-state` edge function, which proxies to FrostGuard.

## Solution
Replace the `loadUnits` function to use `fetchOrgState()` from `@/lib/frostguardOrgSync` -- the same pattern used by the rest of the emulator.

## Technical Details

### File: `src/components/admin/AlarmScenarioRunner.tsx`

1. **Update the `Unit` interface** (lines 77-82) to match `OrgStateUnit` shape instead of the non-existent areas/sites join:
   - Change to: `{ id: string; name: string; unit_type: string; site_id: string; area_id?: string; }`
   - Remove the nested `area.site` structure since org state doesn't provide that hierarchy

2. **Add import** for `fetchOrgState` from `@/lib/frostguardOrgSync`

3. **Rewrite `loadUnits`** (lines 134-167) to call `fetchOrgState(organizationId)` and map the returned `units` array into the local `Unit[]` state. The org state response includes `units` with fields like `id`, `name`, `unit_type`, `site_id`, `area_id`.

4. **Update the unit dropdown display** (line 350) to show just `unit.name (unit.unit_type)` instead of the `site > area > name` breadcrumb, since the org state doesn't include the nested area/site name joins.

5. **Remove the Supabase `areas`/`units` queries entirely** -- they reference tables that don't exist in this project's schema.

