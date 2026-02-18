

# Deploy ttn-provision-abp and ttn-simulate

## Issue
`ttn-provision-abp` is not listed in `supabase/config.toml`, which means it lacks the `verify_jwt = false` configuration needed for deployment. Without this entry, the function will require JWT verification by default and reject unauthenticated calls.

## Steps

1. **Add `ttn-provision-abp` to `supabase/config.toml`**:
   ```toml
   [functions.ttn-provision-abp]
   verify_jwt = false
   ```

2. **Deploy both functions**:
   - `ttn-provision-abp`
   - `ttn-simulate`

