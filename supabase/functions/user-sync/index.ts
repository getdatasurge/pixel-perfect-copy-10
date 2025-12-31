import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

interface UserPayload {
  user_id: string;
  email: string;
  full_name: string;
  organization_id: string | null;
  site_id: string | null;
  unit_id: string | null;
  updated_at: string;
}

interface SyncRequest {
  users: UserPayload[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate request using shared secret
    const syncSecret = Deno.env.get('USER_SYNC_SECRET')?.trim();
    if (!syncSecret) {
      console.error('USER_SYNC_SECRET not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Sync endpoint not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestSecret = req.headers.get('x-sync-secret');
    if (!requestSecret || requestSecret !== syncSecret) {
      console.error('Invalid or missing sync secret');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: SyncRequest = await req.json();

    if (!body.users || !Array.isArray(body.users)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid payload: users array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.users.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, skipped: 0, message: 'No users to sync' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for database access
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase configuration missing');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process each user with idempotent upsert logic
    for (const user of body.users) {
      try {
        // Validate required fields
        if (!user.user_id) {
          errors.push(`Missing user_id for user`);
          skipped++;
          continue;
        }

        if (!user.updated_at) {
          errors.push(`Missing updated_at for user ${user.user_id}`);
          skipped++;
          continue;
        }

        const incomingUpdatedAt = new Date(user.updated_at);

        // Check if user exists and compare updated_at
        const { data: existingUser, error: fetchError } = await supabase
          .from('users_cache')
          .select('updated_at')
          .eq('user_id', user.user_id)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          // PGRST116 = no rows returned (user doesn't exist)
          console.error(`Error fetching user ${user.user_id}:`, fetchError);
          errors.push(`Failed to check user ${user.user_id}`);
          skipped++;
          continue;
        }

        // Skip if existing record is newer or same
        if (existingUser) {
          const existingUpdatedAt = new Date(existingUser.updated_at);
          if (existingUpdatedAt >= incomingUpdatedAt) {
            skipped++;
            continue;
          }
        }

        // Upsert the user record
        const { error: upsertError } = await supabase
          .from('users_cache')
          .upsert({
            user_id: user.user_id,
            email: user.email || null,
            full_name: user.full_name || null,
            organization_id: user.organization_id || null,
            site_id: user.site_id || null,
            unit_id: user.unit_id || null,
            updated_at: user.updated_at,
            synced_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id',
          });

        if (upsertError) {
          console.error(`Error upserting user ${user.user_id}:`, upsertError);
          errors.push(`Failed to sync user ${user.user_id}: ${upsertError.message}`);
          skipped++;
          continue;
        }

        synced++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error processing user:`, err);
        errors.push(`Error processing user: ${message}`);
        skipped++;
      }
    }

    console.log(`Sync complete: ${synced} synced, ${skipped} skipped, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        synced,
        skipped,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit error details
        message: `Synced ${synced} users, skipped ${skipped}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
