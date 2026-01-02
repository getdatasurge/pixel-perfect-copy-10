// create-unit: Proxies unit creation to FrostGuard
// Uses same API key auth pattern as fetch-org-state (no JWT)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CreateUnitRequest {
  org_id: string;
  site_id: string;
  name: string;
  description?: string;
  location?: string;
}

interface CreateUnitResponse {
  ok: boolean;
  unit?: {
    id: string;
    name: string;
    site_id: string;
    description?: string;
    location?: string;
    created_at: string;
  };
  error?: string;
  error_code?: string;
  request_id?: string;
  hint?: string;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (msg: string, data?: unknown) => {
    console.log(`[${requestId}] ${msg}`, data ? JSON.stringify(data) : '');
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: CreateUnitRequest = await req.json();
    log('Create unit request received', { 
      org_id: body.org_id, 
      site_id: body.site_id,
      name: body.name,
    });

    // Validate required fields
    if (!body.org_id) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'org_id is required',
        error_code: 'MISSING_ORG_ID',
        request_id: requestId,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.site_id) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'site_id is required',
        error_code: 'MISSING_SITE_ID',
        request_id: requestId,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.name?.trim()) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'name is required',
        error_code: 'MISSING_NAME',
        request_id: requestId,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get FrostGuard configuration from environment
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const syncApiKey = Deno.env.get('PROJECT2_SYNC_API_KEY');

    if (!frostguardUrl || !syncApiKey) {
      log('Configuration missing', { 
        hasFrostguardUrl: !!frostguardUrl, 
        hasSyncApiKey: !!syncApiKey 
      });
      return new Response(JSON.stringify({
        ok: false,
        error: 'FrostGuard configuration not set',
        error_code: 'CONFIG_MISSING',
        request_id: requestId,
        hint: 'FROSTGUARD_SUPABASE_URL or PROJECT2_SYNC_API_KEY is not configured in project secrets',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call FrostGuard create-unit endpoint
    const frostguardEndpoint = `${frostguardUrl}/functions/v1/create-unit`;
    log('Calling FrostGuard create-unit endpoint', { endpoint: frostguardEndpoint });

    const frostguardResponse = await fetch(frostguardEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncApiKey}`,
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        org_id: body.org_id,
        site_id: body.site_id,
        name: body.name.trim(),
        description: body.description?.trim(),
        location: body.location?.trim(),
      }),
    });

    const frostguardData = await frostguardResponse.json();
    log('FrostGuard response', { 
      status: frostguardResponse.status, 
      ok: frostguardData.ok,
    });

    if (!frostguardResponse.ok || !frostguardData.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: frostguardData.error || 'FrostGuard create-unit failed',
        error_code: frostguardData.error_code || 'UPSTREAM_FAILURE',
        request_id: frostguardData.request_id || requestId,
        hint: frostguardData.hint || getErrorHint(frostguardResponse.status),
      }), {
        status: frostguardResponse.status >= 400 ? frostguardResponse.status : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('Unit created successfully', { unit_id: frostguardData.unit?.id });

    return new Response(JSON.stringify({
      ok: true,
      unit: frostguardData.unit,
      request_id: requestId,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    log('Unexpected error', { error: err instanceof Error ? err.message : String(err) });
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
      error_code: 'INTERNAL_ERROR',
      request_id: requestId,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function getErrorHint(status: number): string {
  if (status === 401) return 'API key is invalid or missing';
  if (status === 403) return 'API key lacks permission for this organization';
  if (status === 404) return 'create-unit endpoint not found in FrostGuard';
  if (status === 409) return 'A unit with this name already exists';
  if (status >= 500) return 'FrostGuard internal error - try again';
  return 'Check FrostGuard logs for details';
}
