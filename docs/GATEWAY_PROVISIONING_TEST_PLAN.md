# Gateway Provisioning Test Plan

This document outlines the test plan for the end-to-end gateway provisioning feature.

## Prerequisites

1. Valid TTN account with Personal or Organization API key that has:
   - `gateways:read` permission
   - `gateways:write` permission
2. Supabase project with the `lora_gateways` table migration applied
3. FrostGuard emulator running with user context configured

## Test Cases

### Test 1: Gateway Appears in TTN Console After Provisioning

**Steps:**
1. Navigate to the Emulator → Gateways tab
2. Add a new gateway (or use an existing one)
3. Click "Provision to TTN" button
4. Complete the provisioning wizard
5. Open TTN Console → Gateways

**Expected Result:**
- Gateway appears in TTN Console with ID format: `emu-gw-{eui_lowercase}`
- Gateway name matches the name set in the emulator
- Gateway frequency plan matches the cluster configuration

**Verification Command:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://nam1.cloud.thethings.network/api/v3/users/YOUR_USERNAME/gateways/emu-gw-YOUR_EUI"
```

---

### Test 2: No Permission Warning Banner in TTN Console

**Steps:**
1. Complete Test 1 (provision a gateway)
2. Navigate to TTN Console → Gateways → Select the provisioned gateway
3. Check for any warning banners about missing permissions

**Expected Result:**
- No warning banners like "Missing gateways:read" or "Missing gateways:write"
- API key has full gateway access
- Gateway settings page loads without errors

**Pre-requisite Check:**
Before provisioning, the emulator should run permission validation:
1. Go to Webhook Settings
2. Verify Gateway Owner is configured (TTN username or org ID)
3. Run the TTN Setup Wizard → Gateway Permissions should show green checkmarks

---

### Test 3: Gateway Appears in FrostGuard UI Immediately

**Steps:**
1. Complete gateway provisioning (Test 1)
2. Observe the Gateways tab in the emulator

**Expected Result:**
- Gateway shows "Provisioned" badge immediately after wizard completes
- `ttn_gateway_id` is populated (visible in debug terminal or database)
- Gateway status changes from "pending" to "active"
- No page refresh required

**Database Verification:**
```sql
SELECT id, eui, name, ttn_gateway_id, status, provisioned_at
FROM lora_gateways
WHERE org_id = 'YOUR_ORG_ID';
```

---

### Test 4: Emulator Automatically Receives Gateway EUI/ID

**Steps:**
1. Configure user context in the emulator (select org/user)
2. Provision a gateway to TTN
3. Refresh the page or change user context and return

**Expected Result:**
- Gateway data is loaded from database on user context change
- Provisioned gateways are marked with correct status
- No manual copy/paste of gateway EUI required
- Provisioned gateways persist across browser sessions

**Verification:**
1. Open browser DevTools → Application → Local Storage
2. Check `lorawan-emulator-gateways` contains gateway with `ttnGatewayId`
3. Check `lorawan-emulator-ttn-provisioned-gateways` contains the EUI
4. Also verify in database: `lora_gateways` table has the gateway

---

### Test 5: Emulator Sends Uplinks → TTN Forwards → Webhook Ingests → Data Visible

**Steps:**
1. Complete gateway provisioning (Test 1)
2. Ensure devices are also provisioned to TTN
3. Start the emulator simulation
4. Wait for uplinks to be sent (check Debug Terminal)

**Expected Result:**
- Uplinks appear in TTN Console → Applications → Live Data
- Webhook receives data from TTN
- Data appears in `sensor_uplinks` table in Supabase
- Telemetry Monitor shows received data

**Verification Flow:**
```
Emulator → TTN (simulated uplink)
   ↓
TTN → Webhook endpoint (HTTP POST)
   ↓
Webhook → Supabase (ingest-readings)
   ↓
Supabase → sensor_uplinks table
   ↓
UI → Telemetry Monitor (realtime subscription)
```

---

## Error Handling Tests

### Test 6: Missing Gateway Permissions Error

**Steps:**
1. Configure TTN with an Application API key (not Personal/Organization)
2. Try to provision a gateway

**Expected Result:**
- Pre-flight check fails with clear error message
- Error states: "API key lacks gateways:write permission"
- Hint suggests: "Create a Personal or Organization API key"
- Provisioning is blocked until permissions are fixed

---

### Test 7: Gateway Owner Not Configured Error

**Steps:**
1. Clear the Gateway Owner ID in Webhook Settings
2. Try to provision a gateway

**Expected Result:**
- Error states: "Gateway owner not configured"
- Hint explains: "Set your TTN username or organization ID"
- Wizard step shows clear guidance to configure

---

### Test 8: Network Error During Provisioning (Retry)

**Steps:**
1. Disconnect network during provisioning
2. Observe retry behavior

**Expected Result:**
- Edge function retries up to 3 times with exponential backoff
- Error is marked as retryable
- User can manually retry from the results screen
- Database records gateway with `status='pending'` and `provision_error` set

---

## Database Schema Verification

After running the migration, verify:

```sql
-- Check table exists
SELECT * FROM information_schema.tables
WHERE table_name = 'lora_gateways';

-- Check enum exists
SELECT * FROM pg_type WHERE typname = 'gateway_status';

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename = 'lora_gateways';

-- Check policies exist
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'lora_gateways';
```

---

## TTN API Endpoints Used

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List Gateways | `/api/v3/{users\|organizations}/{id}/gateways` | GET |
| Create Gateway | `/api/v3/{users\|organizations}/{id}/gateways` | POST |
| Check Gateway | `/api/v3/gateways/{gateway_id}` | GET |
| Permission Test | `/api/v3/{users\|organizations}/{id}/gateways?limit=1` | GET |

---

## TTN Rights Required

For gateway operations, the API key must have:

| Right | Purpose |
|-------|---------|
| `gateways:read` | List and view gateways |
| `gateways:write` | Create and modify gateways |

**Important:** These rights are ONLY available on:
- Personal API keys (scoped to your TTN user account)
- Organization API keys (scoped to a TTN organization)

Application API keys CANNOT have gateway rights.

---

## Rollback Procedure

If issues occur:

1. **Revert migration:**
   ```sql
   DROP TABLE IF EXISTS public.lora_gateways;
   DROP TYPE IF EXISTS public.gateway_status;
   ```

2. **Revert edge function:**
   - Restore previous version from git

3. **Clear browser storage:**
   - Delete `lorawan-emulator-gateways` from localStorage
   - Delete `lorawan-emulator-ttn-provisioned-gateways` from localStorage
