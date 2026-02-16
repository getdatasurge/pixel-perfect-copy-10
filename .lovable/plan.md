

# Fix: Gateway Owner Auto-Discovery Fails (404) and eu1 Fallback

## Root Cause

Two bugs identified from the screenshots and edge function logs:

### Bug 1: Identity Server calls use wrong cluster (Critical)
The `discoverGatewayOwnerInternal` function in `manage-ttn-settings` calls TTN's Identity Server endpoints (`/api/v3/organizations`, `/api/v3/auth_info`) using the regional cluster URL (e.g., `nam1.cloud.thethings.network`). However, TTN's Identity Server only runs on `eu1.cloud.thethings.network`. Both calls return **404**, so the auto-discovery never resolves the FrostGuard placeholder ID `fg-org-7873654e-ir9` to the real TTN owner.

Edge function logs confirm this:
```
Discovery: Checking organizations at https://nam1.cloud.thethings.network/api/v3/organizations?limit=10
Discovery: Organizations check returned 404
Discovery: Checking auth info at https://nam1.cloud.thethings.network/api/v3/auth_info
Discovery: Auth info returned 404
```

### Bug 2: WebhookSettings eu1 fallback (Minor)
Line 667 of `WebhookSettings.tsx` still uses `'eu1'` as the default cluster fallback instead of `'nam1'`, which caused the initial cluster mismatch visible in the first screenshot (UI showed eu1 but emulation tried nam1).

## Fix

### File 1: `supabase/functions/manage-ttn-settings/index.ts`

Modify `discoverGatewayOwnerInternal` (around line 975) to always use `eu1` for Identity Server calls, since TTN routes all identity/auth endpoints through `eu1` regardless of the user's regional cluster.

```typescript
// Identity Server endpoints are ALWAYS on eu1, regardless of regional cluster
const identityBaseUrl = 'https://eu1.cloud.thethings.network';
```

Use `identityBaseUrl` instead of `baseUrl` for the `/api/v3/organizations` and `/api/v3/auth_info` calls. Keep the existing `baseUrl` (regional cluster) for the gateway read/write permission checks in `handleCheckGatewayPermissions`, since those are Application/Network Server endpoints.

### File 2: `src/components/emulator/WebhookSettings.tsx`

Change line 667 from:
```typescript
setTtnCluster(config.ttnConfig.cluster || 'eu1');
```
To:
```typescript
setTtnCluster(config.ttnConfig.cluster || 'nam1');
```

### Expected Result
- Auto-discovery will successfully resolve `fg-org-7873654e-ir9` to the real TTN username/organization
- The "Gateway Owner ID not found" error will be replaced with a successful permission check
- No more eu1/nam1 cluster mismatch on initial load
