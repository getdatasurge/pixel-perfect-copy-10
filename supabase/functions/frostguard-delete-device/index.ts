import { corsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

interface DeleteDeviceRequest {
  device_id?: string;
  dev_eui?: string;
  org_id: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: DeleteDeviceRequest = await req.json();
    const { device_id, dev_eui, org_id } = body;

    console.log('[frostguard-delete-device] Request:', { device_id, dev_eui, org_id });

    if (!org_id) {
      return new Response(JSON.stringify({ error: 'org_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!device_id && !dev_eui) {
      return new Response(JSON.stringify({ error: 'device_id or dev_eui is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get FrostGuard credentials
    const frostguardUrl = Deno.env.get('FROSTGUARD_SUPABASE_URL');
    const frostguardServiceKey = Deno.env.get('FROSTGUARD_SERVICE_ROLE_KEY');

    if (!frostguardUrl || !frostguardServiceKey) {
      console.error('[frostguard-delete-device] Missing FrostGuard credentials');
      return new Response(JSON.stringify({ error: 'FrostGuard connection not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create FrostGuard Supabase client with service role key
    const frostguardClient = createClient(frostguardUrl, frostguardServiceKey, {
      auth: { persistSession: false },
    });

    // Delete from FrostGuard's lora_sensors table
    let deleteQuery = frostguardClient
      .from('lora_sensors')
      .delete()
      .eq('org_id', org_id);

    if (device_id) {
      deleteQuery = deleteQuery.eq('id', device_id);
    } else if (dev_eui) {
      deleteQuery = deleteQuery.eq('dev_eui', dev_eui);
    }

    const { error: deleteError, count } = await deleteQuery;

    if (deleteError) {
      console.error('[frostguard-delete-device] FrostGuard delete error:', deleteError);
      return new Response(JSON.stringify({ 
        error: 'Failed to delete from FrostGuard',
        details: deleteError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[frostguard-delete-device] Successfully deleted from FrostGuard:', { device_id, dev_eui, count });

    // Also delete from local lora_sensors table (for consistency)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const localClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    let localDeleteQuery = localClient
      .from('lora_sensors')
      .delete()
      .eq('org_id', org_id);

    if (device_id) {
      localDeleteQuery = localDeleteQuery.eq('id', device_id);
    } else if (dev_eui) {
      localDeleteQuery = localDeleteQuery.eq('dev_eui', dev_eui);
    }

    const { error: localDeleteError } = await localDeleteQuery;
    if (localDeleteError) {
      console.warn('[frostguard-delete-device] Local delete warning:', localDeleteError.message);
      // Don't fail - FrostGuard delete succeeded which is what matters
    }

    return new Response(JSON.stringify({ 
      success: true,
      deleted_from_frostguard: true,
      device_id,
      dev_eui,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[frostguard-delete-device] Error:', err);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
