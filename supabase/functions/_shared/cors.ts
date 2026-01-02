/**
 * Shared CORS utilities for edge functions
 */

/**
 * Standard CORS headers for edge functions.
 * Includes common headers needed for Supabase client and TTN sync operations.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

/**
 * Handle CORS preflight request.
 * Returns a 204 response with CORS headers if the request is an OPTIONS request.
 */
export function handleCorsPreflightRequest(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
