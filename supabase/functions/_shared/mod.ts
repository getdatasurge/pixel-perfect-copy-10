/**
 * Shared utilities for edge functions
 *
 * Import from this module for convenience:
 * import { corsHeaders, getSupabaseClient, normalizeDevEui } from "../_shared/mod.ts";
 */

// CORS utilities
export { corsHeaders, handleCorsPreflightRequest } from "./cors.ts";

// Supabase client
export { getSupabaseClient, createSupabaseClient } from "./supabase.ts";

// TTN utilities
export {
  normalizeDevEui,
  generateTTNDeviceId,
  isValidTTNDeviceId,
  isValidCluster,
  getTTNApiBaseUrl,
  parseClusterFromUrl,
  convertLegacyDeviceId,
  VALID_CLUSTERS,
  type TTNCluster,
} from "./ttn-utils.ts";

// Response utilities
export {
  successResponse,
  errorResponse,
  ttnErrorResponse,
  generateRequestId,
  type EdgeFunctionResponse,
  type TTNResponse,
} from "./response.ts";

// Settings utilities
export {
  loadUserSettings,
  loadOrgSettings,
  loadTTNSettings,
  type TTNSettings,
} from "./settings.ts";
