import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Maximum number of results to return
const MAX_RESULTS = 20;

interface SearchRequest {
  searchTerm?: string;
  limit?: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Parse request body
    let searchTerm = '';
    let limit = MAX_RESULTS;

    if (req.method === 'POST') {
      const body: SearchRequest = await req.json();
      searchTerm = body.searchTerm?.trim() || '';
      limit = Math.min(body.limit || MAX_RESULTS, MAX_RESULTS);
    } else if (req.method === 'GET') {
      const url = new URL(req.url);
      searchTerm = url.searchParams.get('q')?.trim() || '';
      const limitParam = url.searchParams.get('limit');
      if (limitParam) {
        limit = Math.min(parseInt(limitParam, 10) || MAX_RESULTS, MAX_RESULTS);
      }
    }

    console.log(`Searching users_cache for: "${searchTerm}" (limit: ${limit})`);

    // Build query against local users_cache table
    let query = supabase
      .from('users_cache')
      .select('user_id, email, full_name, organization_id, site_id, unit_id')
      .limit(limit);

    // Apply search filter if provided
    if (searchTerm) {
      // Use ilike for case-insensitive partial matching on email and full_name
      query = query.or(`email.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`);
    }

    // Order by most recently updated
    query = query.order('updated_at', { ascending: false });

    const { data: users, error } = await query;

    if (error) {
      console.error('Error searching users:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to search users', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map results to expected format (using 'id' instead of 'user_id' for frontend compatibility)
    const mappedUsers = (users || []).map(user => ({
      id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      organization_id: user.organization_id,
      site_id: user.site_id,
      unit_id: user.unit_id,
    }));

    console.log(`Found ${mappedUsers.length} users`);

    return new Response(
      JSON.stringify({ success: true, users: mappedUsers, source: 'cache' }),
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
