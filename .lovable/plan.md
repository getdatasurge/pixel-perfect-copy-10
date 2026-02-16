
# Fix: TTN Identity Server is on eu1, Not nam1

## Problem

TTN Community/Sandbox has a split architecture:
- **Identity Server** (application registry, user accounts): Always on `eu1`
- **Network Server + Application Server** (device traffic, uplinks): On `nam1` for your devices

Your application `fg-7873654e-yq` is registered on `eu1`'s Identity Server, and your devices operate on `nam1`'s Network/Application Server. This is normal TTN behavior -- notice the devices show "Other cluster" when viewed from `eu1`.

The connection test calls `GET /api/v3/applications/{id}` which only works on the Identity Server (`eu1`). When the emulator sends this to `nam1`, it gets a 404 because `nam1` doesn't host the Identity Server for your account.

## Solution: eu1 Identity Server Fallback

When an application lookup returns 404 on the configured cluster, automatically retry on `eu1` (the centralized Identity Server). If found on `eu1`, report success and note the split-cluster setup.

### Change 1: Connection Test fallback (`manage-ttn-settings`)

**File: `supabase/functions/manage-ttn-settings/index.ts`**

In `handleTest()` (line 518), when `status === 404` and `cluster !== 'eu1'`:
- Retry the same `GET /api/v3/applications/{id}` call against `eu1.cloud.thethings.network`
- If `eu1` returns 200, report "Connected Successfully" with a note that the Identity Server is on `eu1` while devices operate on the configured cluster

### Change 2: Preflight application check fallback (`ttn-preflight`)

**File: `supabase/functions/ttn-preflight/index.ts`**

In `checkApplicationExists()` (line 164), when `status === 404` and `cluster !== 'eu1'`:
- Retry on `eu1`
- If found, mark `exists: true` so preflight passes

### Change 3: Device checks stay on the configured cluster

Device lookups (`GET /api/v3/applications/{id}/devices/{device_id}`) DO work on `nam1` because the Application Server is there. No change needed for device checks -- only the application-level lookup needs the Identity Server fallback.

## Technical Details

### handleTest fallback (manage-ttn-settings)

```typescript
if (status === 404 && cluster !== 'eu1') {
  // TTN Identity Server may be on eu1 for Community accounts
  console.log(`[${requestId}] App not found on ${cluster}, trying eu1 Identity Server`);
  const eu1Url = `https://eu1.cloud.thethings.network/api/v3/applications/${application_id}`;
  
  const eu1Response = await fetch(eu1Url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${api_key}`, 'Accept': 'application/json' },
  });
  
  if (eu1Response.status === 200) {
    return buildResponse({
      ok: true,
      connected: true,
      baseUrl: getBaseUrl(cluster),    // Keep operational cluster
      application_id,
      cluster,                          // Keep nam1 as the operational cluster
      identity_server: 'eu1',           // Note where IS lives
      message: 'Connected to The Things Network',
      required_permissions: REQUIRED_PERMISSIONS,
    }, 200, requestId);
  }
}
```

### checkApplicationExists fallback (ttn-preflight)

```typescript
if (response.status === 404 && cluster !== 'eu1') {
  console.log(`[preflight] App not found on ${cluster}, trying eu1 Identity Server`);
  const eu1Response = await fetch(
    `https://eu1.cloud.thethings.network/api/v3/applications/${applicationId}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } }
  );
  if (eu1Response.ok) {
    return { exists: true };
  }
}
```

## Files to Change

1. `supabase/functions/manage-ttn-settings/index.ts` -- Add eu1 fallback in `handleTest()` (around line 642)
2. `supabase/functions/ttn-preflight/index.ts` -- Add eu1 fallback in `checkApplicationExists()` (around line 180)

## Expected Result

- Connection test with cluster=`nam1` will succeed (finds app on eu1 Identity Server)
- Preflight check will pass
- Emulation will start successfully
- Device operations (simulate uplink, etc.) continue to use `nam1` as before
