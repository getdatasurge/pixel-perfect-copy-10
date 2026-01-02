import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processTTNUplink, TTNUplinkPayload } from "../_shared/ttnWebhookProcessor.ts";
import { loadWebhookSecretForApplication, verifyWebhookSecret } from "../_shared/ttnWebhookAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ttn-webhook-secret',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID().slice(0, 8);
  const log = (level: string, msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ correlationId, level, msg, ...data }));
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: TTNUplinkPayload = await req.json();
    const applicationId = payload.end_device_ids?.application_ids?.application_id;
    const providedSecret = req.headers.get('x-ttn-webhook-secret');
    const expectedSecret = applicationId
      ? await loadWebhookSecretForApplication(supabase, applicationId)
      : null;

    const secretCheck = verifyWebhookSecret(providedSecret, expectedSecret);
    if (!secretCheck.ok) {
      log('warn', 'Webhook secret validation failed', { applicationId });
      return new Response(
        JSON.stringify({ ok: false, error: secretCheck.error, errorType: 'auth_error' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await processTTNUplink(payload, supabase, log);

    return new Response(
      JSON.stringify(result.body),
      { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log('error', 'Unexpected error', { error: errorMessage });
    
    // Never return raw 500 - always return structured error
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal processing error', hint: 'Check server logs for details' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
