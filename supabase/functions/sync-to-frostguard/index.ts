import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FROSTGUARD_BASE_URL = 'https://mfwyiifehsvwnjwqoxht.supabase.co';
const PROJECT1_ENDPOINT = 'https://mfwyiifehsvwnjwqoxht.supabase.co/functions/v1/emulator-sync';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ValidationError {
  path: string;
  message: string;
  value?: string;
}

interface SyncBundle {
  metadata: {
    sync_run_id: string;
    initiated_at: string;
    source_project: string;
  };
  context: {
    org_id: string;
    site_id?: string;
    unit_id?: string;
    selected_user_id?: string;
  };
  entities: {
    gateways: Array<{
      id: string;
      name: string;
      eui: string;
      is_online: boolean;
    }>;
    devices: Array<{
      id: string;
      name: string;
      dev_eui: string;
      join_eui: string;
      app_key: string;
      type: string;
      gateway_id?: string;
    }>;
  };
}

interface SyncResponse {
  ok: boolean;
  sync_run_id: string | null;
  method?: 'endpoint' | 'direct';
  error?: string;
  errors?: ValidationError[];
  upstream_status?: number;
  upstream_body?: unknown;
  results?: {
    gateways: { created: number; updated: number; failed: number };
    devices: { created: number; updated: number; failed: number };
  };
  // Legacy fields for backward compatibility
  success?: boolean;
  summary?: string;
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

function isValidHex(value: string | undefined | null, length: number): boolean {
  if (!value) return false;
  return new RegExp(`^[A-Fa-f0-9]{${length}}$`).test(value);
}

function isValidUUID(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validateSyncBundle(body: SyncBundle): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate top-level structure
  if (!body.metadata) {
    errors.push({ path: 'metadata', message: 'Required object missing' });
  }
  if (!body.context) {
    errors.push({ path: 'context', message: 'Required object missing' });
  }
  if (!body.entities) {
    errors.push({ path: 'entities', message: 'Required object missing' });
  }

  // Early return if structure is broken
  if (errors.length > 0) return errors;

  // Validate metadata
  if (!body.metadata.sync_run_id) {
    errors.push({ path: 'metadata.sync_run_id', message: 'Required' });
  } else if (!isValidUUID(body.metadata.sync_run_id)) {
    errors.push({ path: 'metadata.sync_run_id', message: 'Must be a valid UUID' });
  }

  // Validate context
  if (!body.context.org_id) {
    errors.push({ path: 'context.org_id', message: 'Required' });
  } else if (!isValidUUID(body.context.org_id)) {
    errors.push({ path: 'context.org_id', message: 'Must be a valid UUID' });
  }

  // Validate entities structure
  if (!Array.isArray(body.entities.gateways)) {
    errors.push({ path: 'entities.gateways', message: 'Must be an array' });
  }
  if (!Array.isArray(body.entities.devices)) {
    errors.push({ path: 'entities.devices', message: 'Must be an array' });
  }

  // Validate gateways
  if (Array.isArray(body.entities.gateways)) {
    body.entities.gateways.forEach((gw, i) => {
      if (!gw.name?.trim()) {
        errors.push({ path: `entities.gateways[${i}].name`, message: 'Required' });
      }
      if (!isValidHex(gw.eui, 16)) {
        errors.push({
          path: `entities.gateways[${i}].eui`,
          message: `Must be 16 hex characters (got ${gw.eui?.length || 0})`,
          value: gw.eui ? `...${gw.eui.slice(-4)}` : undefined,
        });
      }
    });
  }

  // Validate devices
  if (Array.isArray(body.entities.devices)) {
    body.entities.devices.forEach((dev, i) => {
      if (!dev.name?.trim()) {
        errors.push({ path: `entities.devices[${i}].name`, message: 'Required' });
      }
      if (!isValidHex(dev.dev_eui, 16)) {
        errors.push({
          path: `entities.devices[${i}].dev_eui`,
          message: `Must be 16 hex characters (got ${dev.dev_eui?.length || 0})`,
        });
      }
      if (!isValidHex(dev.join_eui, 16)) {
        errors.push({
          path: `entities.devices[${i}].join_eui`,
          message: `Must be 16 hex characters (got ${dev.join_eui?.length || 0})`,
        });
      }
      if (!isValidHex(dev.app_key, 32)) {
        errors.push({
          path: `entities.devices[${i}].app_key`,
          message: `Must be 32 hex characters (got ${dev.app_key?.length || 0})`,
        });
      }
    });
  }

  return errors;
}

function safeLog(label: string, payload: unknown) {
  // Deep clone and redact sensitive fields for logging
  const redacted = JSON.parse(JSON.stringify(payload));
  if (redacted.devices && Array.isArray(redacted.devices)) {
    redacted.devices = redacted.devices.map((d: { app_key?: string }) => ({
      ...d,
      app_key: d.app_key ? `...${d.app_key.slice(-4)}` : undefined,
    }));
  }
  if (redacted.entities?.devices && Array.isArray(redacted.entities.devices)) {
    redacted.entities.devices = redacted.entities.devices.map((d: { app_key?: string }) => ({
      ...d,
      app_key: d.app_key ? `...${d.app_key.slice(-4)}` : undefined,
    }));
  }
  console.log(label, JSON.stringify(redacted, null, 2));
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  // Parse JSON body
  let body: SyncBundle;
  try {
    body = await req.json();
  } catch (e) {
    console.error('JSON parse error:', e);
    return new Response(
      JSON.stringify({
        ok: false,
        success: false,
        sync_run_id: null,
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
      } as SyncResponse),
      { status: 400, headers: responseHeaders }
    );
  }

  safeLog('Received sync bundle:', body);

  // Validate the payload
  const validationErrors = validateSyncBundle(body);
  if (validationErrors.length > 0) {
    console.log('Validation failed:', JSON.stringify(validationErrors, null, 2));
    return new Response(
      JSON.stringify({
        ok: false,
        success: false,
        sync_run_id: body.metadata?.sync_run_id || null,
        error: 'validation_failed',
        errors: validationErrors,
      } as SyncResponse),
      { status: 400, headers: responseHeaders }
    );
  }

  const { metadata, context, entities } = body;

  console.log(`Sync request validated - sync_run_id: ${metadata.sync_run_id}, org: ${context.org_id}`);
  console.log(`Entities: ${entities.gateways.length} gateways, ${entities.devices.length} devices`);

  // Check for EMULATOR_SYNC_API_KEY for Project 1 endpoint
  const syncApiKey = Deno.env.get('EMULATOR_SYNC_API_KEY');

  if (syncApiKey) {
    console.log('Attempting sync via Project 1 endpoint:', PROJECT1_ENDPOINT);

    try {
      // Transform payload to match Project 1's expected schema
      const transformedGateways = entities.gateways.map(gw => ({
        id: gw.id,
        name: gw.name,
        gateway_eui: gw.eui, // Rename eui → gateway_eui
        is_online: gw.is_online,
      }));

      const transformedDevices = entities.devices.map(device => ({
        id: device.id,
        name: device.name,
        dev_eui: device.dev_eui,
        join_eui: device.join_eui,
        app_key: device.app_key,
        type: device.type,
        gateway_id: device.gateway_id,
        serial_number: device.dev_eui, // Use dev_eui as serial_number
      }));

      const project1Payload = {
        org_id: context.org_id,
        synced_at: metadata.initiated_at || new Date().toISOString(),
        site_id: context.site_id || null,
        sync_run_id: metadata.sync_run_id,
        selected_user_id: context.selected_user_id || null,
        source_project: metadata.source_project,
        gateways: transformedGateways,
        devices: transformedDevices,
      };

      safeLog('Transformed payload for Project 1:', project1Payload);

      const response = await fetch(PROJECT1_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncApiKey}`,
        },
        body: JSON.stringify(project1Payload),
      });

      let responseData: unknown;
      const responseText = await response.text();
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      console.log(`Project 1 response: ${response.status}`, JSON.stringify(responseData));

      if (response.ok) {
        return new Response(
          JSON.stringify({
            ok: true,
            success: true,
            sync_run_id: metadata.sync_run_id,
            method: 'endpoint',
            results: responseData,
          } as SyncResponse),
          { status: 200, headers: responseHeaders }
        );
      }

      // If Project 1 returns an error (not 404), return 502 with upstream details
      if (response.status !== 404) {
        console.error(`Project 1 returned error: ${response.status}`);
        return new Response(
          JSON.stringify({
            ok: false,
            success: false,
            sync_run_id: metadata.sync_run_id,
            error: 'upstream_failed',
            upstream_status: response.status,
            upstream_body: responseData,
          } as SyncResponse),
          { status: 502, headers: responseHeaders }
        );
      }

      // 404 means endpoint not found, fall through to direct write
      console.log('Project 1 endpoint not found (404), falling back to direct write');
    } catch (error) {
      console.error('Error calling Project 1 endpoint:', error);
      // Fall through to direct write on network errors
    }
  } else {
    console.log('EMULATOR_SYNC_API_KEY not configured, using direct writes');
  }

  // ─── Fallback: Direct Database Write ─────────────────────────────────────────
  console.log('Using direct database write to FrostGuard');

  const frostguardAnonKey = Deno.env.get('FROSTGUARD_ANON_KEY');
  if (!frostguardAnonKey) {
    console.error('Missing FROSTGUARD_ANON_KEY');
    return new Response(
      JSON.stringify({
        ok: false,
        success: false,
        sync_run_id: metadata.sync_run_id,
        error: 'configuration_error',
        message: 'FROSTGUARD_ANON_KEY not configured',
      } as SyncResponse),
      { status: 500, headers: responseHeaders }
    );
  }

  const supabase = createClient(FROSTGUARD_BASE_URL, frostguardAnonKey);

  const results = {
    gateways: { created: 0, updated: 0, failed: 0 },
    devices: { created: 0, updated: 0, failed: 0 },
  };

  // Sync gateways
  for (const gateway of entities.gateways) {
    try {
      const { error } = await supabase.from('gateways').upsert(
        {
          id: gateway.id,
          name: gateway.name,
          gateway_eui: gateway.eui,
          is_online: gateway.is_online,
          organization_id: context.org_id,
          site_id: context.site_id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (error) {
        console.error(`Gateway ${gateway.id} upsert failed:`, error);
        results.gateways.failed++;
      } else {
        results.gateways.updated++;
      }
    } catch (err) {
      console.error(`Gateway ${gateway.id} exception:`, err);
      results.gateways.failed++;
    }
  }

  // Sync devices
  for (const device of entities.devices) {
    try {
      const { error } = await supabase.from('lora_sensors').upsert(
        {
          id: device.id,
          name: device.name,
          dev_eui: device.dev_eui,
          join_eui: device.join_eui,
          app_key: device.app_key,
          sensor_type: device.type,
          serial_number: device.dev_eui,
          gateway_id: device.gateway_id || null,
          organization_id: context.org_id,
          site_id: context.site_id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (error) {
        console.error(`Device ${device.id} upsert failed:`, error);
        results.devices.failed++;
      } else {
        results.devices.updated++;
      }
    } catch (err) {
      console.error(`Device ${device.id} exception:`, err);
      results.devices.failed++;
    }
  }

  console.log('Direct write results:', JSON.stringify(results));

  const allSucceeded =
    results.gateways.failed === 0 && results.devices.failed === 0;
  const summary = `Synced ${results.gateways.updated} gateways and ${results.devices.updated} devices`;

  return new Response(
    JSON.stringify({
      ok: allSucceeded,
      success: allSucceeded,
      sync_run_id: metadata.sync_run_id,
      method: 'direct',
      results,
      summary,
    } as SyncResponse),
    { status: allSucceeded ? 200 : 207, headers: responseHeaders }
  );
});
