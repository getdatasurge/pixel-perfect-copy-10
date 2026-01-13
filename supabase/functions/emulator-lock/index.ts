import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action, org_id, user_id, session_id, device_info, force } = body;

    console.log(`[emulator-lock] action=${action} org_id=${org_id} session_id=${session_id?.slice(0, 8)}`);

    if (!org_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'org_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'acquire': {
        if (!user_id || !session_id) {
          return new Response(
            JSON.stringify({ ok: false, error: 'user_id and session_id required for acquire' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check for existing lock
        const { data: existingLock } = await supabase
          .from('emulator_locks')
          .select('*')
          .eq('org_id', org_id)
          .single();

        if (existingLock) {
          const lastHeartbeat = new Date(existingLock.last_heartbeat_at).getTime();
          const now = Date.now();
          const isStale = (now - lastHeartbeat) > HEARTBEAT_TIMEOUT_MS;

          // If same session, just update heartbeat
          if (existingLock.session_id === session_id) {
            await supabase
              .from('emulator_locks')
              .update({ last_heartbeat_at: new Date().toISOString() })
              .eq('org_id', org_id);

            return new Response(
              JSON.stringify({ ok: true, message: 'Lock refreshed' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // If lock is stale or force takeover, delete and proceed
          if (isStale || force) {
            console.log(`[emulator-lock] Taking over stale/forced lock for org ${org_id}`);
            await supabase.from('emulator_locks').delete().eq('org_id', org_id);
          } else {
            // Lock is held by another active session
            return new Response(
              JSON.stringify({
                ok: false,
                error: 'Lock held by another session',
                lock_info: {
                  user_id: existingLock.user_id,
                  session_id: existingLock.session_id,
                  started_at: existingLock.started_at,
                  last_heartbeat_at: existingLock.last_heartbeat_at,
                  device_info: existingLock.device_info,
                },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        // Create new lock
        const { error: insertError } = await supabase
          .from('emulator_locks')
          .insert({
            org_id,
            user_id,
            session_id,
            device_info: device_info || navigator?.userAgent || 'Unknown',
            started_at: new Date().toISOString(),
            last_heartbeat_at: new Date().toISOString(),
          });

        if (insertError) {
          // Race condition - another session got the lock first
          if (insertError.code === '23505') { // unique violation
            return new Response(
              JSON.stringify({ ok: false, error: 'Lock acquired by another session' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw insertError;
        }

        console.log(`[emulator-lock] Lock acquired for org ${org_id} by session ${session_id.slice(0, 8)}`);
        return new Response(
          JSON.stringify({ ok: true, message: 'Lock acquired' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'release': {
        if (!session_id) {
          return new Response(
            JSON.stringify({ ok: false, error: 'session_id required for release' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabase
          .from('emulator_locks')
          .delete()
          .eq('org_id', org_id)
          .eq('session_id', session_id);

        if (error) throw error;

        console.log(`[emulator-lock] Lock released for org ${org_id} by session ${session_id.slice(0, 8)}`);
        return new Response(
          JSON.stringify({ ok: true, message: 'Lock released' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'heartbeat': {
        if (!session_id) {
          return new Response(
            JSON.stringify({ ok: false, error: 'session_id required for heartbeat' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('emulator_locks')
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq('org_id', org_id)
          .eq('session_id', session_id)
          .select()
          .single();

        if (error || !data) {
          // Lock no longer exists or was taken over
          return new Response(
            JSON.stringify({ ok: false, error: 'Lock not found or taken over' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ ok: true, message: 'Heartbeat received' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check': {
        const { data: lock } = await supabase
          .from('emulator_locks')
          .select('*')
          .eq('org_id', org_id)
          .single();

        if (!lock) {
          return new Response(
            JSON.stringify({ ok: true, locked: false }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const lastHeartbeat = new Date(lock.last_heartbeat_at).getTime();
        const isStale = (Date.now() - lastHeartbeat) > HEARTBEAT_TIMEOUT_MS;

        return new Response(
          JSON.stringify({
            ok: true,
            locked: !isStale,
            stale: isStale,
            lock_info: {
              user_id: lock.user_id,
              session_id: lock.session_id,
              started_at: lock.started_at,
              last_heartbeat_at: lock.last_heartbeat_at,
              device_info: lock.device_info,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ ok: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[emulator-lock] Error:', errMsg);
    return new Response(
      JSON.stringify({ ok: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
