import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function loadWebhookSecretForApplication(
  supabase: SupabaseClient,
  applicationId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ttn_settings')
    .select('webhook_secret')
    .eq('application_id', applicationId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[ttn-webhook-auth] Failed to load webhook secret', error);
    return null;
  }

  return data?.webhook_secret ?? null;
}

export function verifyWebhookSecret(
  providedSecret: string | null,
  expectedSecret: string | null
): { ok: boolean; error?: string } {
  if (!expectedSecret) {
    return { ok: true };
  }

  if (!providedSecret) {
    return { ok: false, error: 'Missing webhook secret' };
  }

  if (providedSecret !== expectedSecret) {
    return { ok: false, error: 'Invalid webhook secret' };
  }

  return { ok: true };
}
