# TTN Integration Setup Guide

This document explains how to set up TTN integration between FrostGuard (FreshTrack Pro) and the Emulator project.

## Architecture

```
FrostGuard (Project 1)              Emulator (Project 2)
┌──────────────────────┐            ┌─────────────────────┐
│ ttn_connections      │            │ synced_users        │
│ - org-level TTN data │            │ - user + TTN data   │
│ - encrypted API keys │            │ - full API keys     │
└──────────────────────┘            └─────────────────────┘
           │                                  ▲
           │ user-sync-emitter                │
           │ (decrypts & sends)                │
           └────────────POST──────────────────┘
                   /v1/user-sync
```

## Setup Steps

### 1. Set SYNC_API_KEY in Emulator

In your Supabase dashboard for the Emulator project:

1. Go to **Project Settings** → **Edge Functions** → **Secrets**
2. Add a new secret:
   - Name: `SYNC_API_KEY` (or `PROJECT2_SYNC_API_KEY`)
   - Value: Generate a strong random key (e.g., `openssl rand -hex 32`)

```bash
# Generate a secure API key
openssl rand -hex 32

# Example output: a1b2c3d4e5f6...
```

### 2. Configure FrostGuard to Send Sync Payloads

In FrostGuard's `user-sync-emitter` function, configure the emulator endpoint:

```typescript
const EMULATOR_SYNC_URL = Deno.env.get('EMULATOR_SYNC_URL');
const EMULATOR_API_KEY = Deno.env.get('EMULATOR_API_KEY');

// Send payload
await fetch(`${EMULATOR_SYNC_URL}/functions/v1/user-sync`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${EMULATOR_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    users: [{
      user_id: "...",
      email: "...",
      organization_id: "...",
      ttn: {
        enabled: true,
        cluster: "eu1",
        application_id: "ft-your-org",
        api_key: "NNSXS.FULL_DECRYPTED_KEY...",  // ← FULL key
        api_key_last4: "ZRWQ"
      }
    }]
  })
});
```

### 3. Run Database Migration

```bash
# Apply the migration to add TTN columns
supabase db push
```

Or in Lovable, the migration will auto-deploy.

### 4. Test the Sync

```bash
# Test payload from FrostGuard
curl -X POST https://your-emulator.supabase.co/functions/v1/user-sync \
  -H "Authorization: Bearer YOUR_SYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "users": [{
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "peter@sustainablefinishes.com",
      "full_name": "Peter Smith",
      "organization_id": "org-123",
      "site_id": "site-456",
      "unit_id": null,
      "default_site_id": "site-456",
      "user_sites": [
        { "site_id": "site-456", "site_name": "Main Kitchen" }
      ],
      "updated_at": "2025-12-31T21:30:00.000Z",
      "ttn": {
        "enabled": true,
        "cluster": "eu1",
        "application_id": "ft-sustainablefinishes",
        "api_key": "NNSXS.BMG4N2AJ43HN4YVPZ6DLQAPHVHUZBVPTOB37JFQ.FHBMPAB26Q2XM4QVBE4GBQ772NBIYP5MGOKCBBOM5NTCCMCJZRWQ",
        "api_key_last4": "ZRWQ"
      }
    }]
  }'

# Expected response:
# {
#   "success": true,
#   "synced": 1,
#   "failed": 0,
#   "results": [...]
# }
```

### 5. Test TTN Simulation

Once users are synced with TTN credentials:

```bash
# Simulate uplink
curl -X POST https://your-emulator.supabase.co/functions/v1/ttn-simulate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type": application/json" \
  -d '{
    "selected_user_id": "550e8400-e29b-41d4-a716-446655440000",
    "org_id": "org-123",
    "deviceId": "sensor-0004a30b001a2b3c",
    "cluster": "eu1",
    "applicationId": "ft-sustainablefinishes",
    "decodedPayload": {
      "temperature": 5.5,
      "humidity": 45,
      "battery": 95
    },
    "fPort": 1
  }'
```

### 6. Verify in TTN Console

1. Go to https://eu1.cloud.thethings.network (or your cluster)
2. Navigate to your application
3. Check **Live Data** tab
4. You should see the simulated uplink appear

## Security

✅ **RLS Enabled**: Only service role can access `synced_users.ttn`
✅ **API Key Auth**: user-sync endpoint requires Bearer token
✅ **HTTPS Only**: All communication encrypted in transit
✅ **No Client Access**: Frontend never sees full API keys
✅ **User-Level Only**: TTN simulation uses ONLY user-specific credentials (no org fallback)

## Troubleshooting

### 403 Errors when simulating uplinks

**Cause**: API key lacks required TTN permissions, or using wrong credentials

**Fix**:
1. Verify user is synced with full API key: `SELECT email, ttn FROM synced_users WHERE source_user_id = '...'`
2. Check that `ttn.api_key` is the full key (starts with `NNSXS.`), not just last 4 chars
3. Ensure API key has "Write downlink application traffic" permission in TTN Console
4. Note: TTN simulation now uses ONLY user-specific credentials (no org fallback)

### User sync fails with "Unauthorized"

**Cause**: SYNC_API_KEY mismatch

**Fix**:
1. Verify `SYNC_API_KEY` is set in Supabase Edge Functions secrets
2. Ensure FrostGuard is sending the same key in `Authorization` header

### TTN simulation returns "No user selected"

**Cause**: No user was selected in the user selector before attempting simulation

**Fix**:
1. Use the user selector dropdown at the top of the emulator page
2. Select a user that has been synced from FrostGuard
3. The selected user must have TTN credentials

### TTN simulation returns "No TTN settings found" or "Incomplete TTN settings"

**Cause**: User not synced or TTN data missing/incomplete

**Fix**:
1. Run user sync from FrostGuard to populate `synced_users` table
2. Verify user exists and has TTN data: `SELECT email, ttn FROM synced_users WHERE source_user_id = 'USER_ID_HERE'`
3. Ensure `ttn.enabled = true`, `ttn.api_key` is not null, and `ttn.application_id` is not null
4. Check that `ttn.api_key` is the full key (starts with `NNSXS.`), not just last 4 characters

## Flow Diagram

```
┌─────────────┐
│ FrostGuard  │
│  (Project 1) │
└──────┬──────┘
       │ Trigger: User login/update
       │
       ├─ Load org's TTN from ttn_connections
       ├─ Decrypt api_key
       ├─ Build sync payload
       │
       ▼
┌──────────────────────┐
│ POST /v1/user-sync   │
│ Bearer: SYNC_API_KEY │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│ Emulator             │
│ - Validate API key   │
│ - Upsert to          │
│   synced_users       │
│ - Store full api_key │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│ Emulator UI          │
│ - User selects user  │
│ - Starts simulation  │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│ ttn-simulate         │
│ - Load from          │
│   synced_users.ttn   │
│ - Use full api_key   │
│ - POST to TTN API    │
└──────────────────────┘
```

## Next Steps

After setup:
1. ✅ Run user sync from FrostGuard
2. ✅ Verify users appear in emulator with TTN data
3. ✅ Test TTN simulation in emulator UI
4. ✅ Check TTN Console for simulated uplinks
