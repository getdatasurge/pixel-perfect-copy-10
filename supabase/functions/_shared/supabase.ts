/**
 * Shared Supabase client factory for edge functions
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let _supabaseClient: SupabaseClient | null = null;

/**
 * Get or create a Supabase client with service role access.
 * Uses singleton pattern for efficiency.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabaseClient) {
    return _supabaseClient;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  }

  _supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
  return _supabaseClient;
}

/**
 * Create a fresh Supabase client (non-singleton).
 * Use when you need isolated client instances.
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}
