

# Deploy Four Edge Functions

Deploy the following functions to ensure all recent fixes are live:

1. **ttn-provision-abp** -- New ABP provisioning function with eu1 Identity Server routing
2. **ttn-simulate** -- Payload structure fixes (dbNow variable rename, etc.)
3. **ttn-preflight** -- AS endpoint and cluster fix
4. **ttn-webhook** -- Shared webhook processor changes

All four are already configured in `supabase/config.toml` with `verify_jwt = false`. No code or config changes needed -- just deployment.

