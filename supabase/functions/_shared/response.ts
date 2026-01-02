/**
 * Standardized response envelope for edge functions
 */

import { corsHeaders } from "./cors.ts";

/**
 * Standard response envelope for edge functions.
 * All edge functions should return responses matching this structure.
 */
export interface EdgeFunctionResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  error_code?: string;
  hint?: string;
  request_id: string;
  status_code?: number;
}

/**
 * Extended response with TTN-specific fields
 */
export interface TTNResponse<T = unknown> extends EdgeFunctionResponse<T> {
  ttn_status?: number;
  cluster?: string;
  application_id?: string;
  device_id?: string;
  settings_source?: string;
}

/**
 * Build a success response
 */
export function successResponse<T>(
  data: T,
  requestId: string,
  extraFields: Partial<EdgeFunctionResponse<T>> = {}
): Response {
  const body: EdgeFunctionResponse<T> = {
    ok: true,
    data,
    request_id: requestId,
    status_code: 200,
    ...extraFields,
  };

  return new Response(
    JSON.stringify(body),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Build an error response
 *
 * Note: For responses that need to be parsed by supabase.functions.invoke(),
 * use HTTP status 200 with ok: false. The invoke method throws on non-2xx
 * responses and loses the body.
 */
export function errorResponse(
  error: string,
  requestId: string,
  options: {
    errorCode?: string;
    hint?: string;
    statusCode?: number;
    httpStatus?: number;
    extraFields?: Record<string, unknown>;
  } = {}
): Response {
  const {
    errorCode,
    hint,
    statusCode = 400,
    httpStatus = 200, // Default to 200 so invoke() can parse the body
    extraFields = {},
  } = options;

  const body: EdgeFunctionResponse = {
    ok: false,
    error,
    error_code: errorCode,
    hint,
    request_id: requestId,
    status_code: statusCode,
    ...extraFields,
  };

  return new Response(
    JSON.stringify(body),
    {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Build a TTN-specific error response
 */
export function ttnErrorResponse(
  error: string,
  requestId: string,
  options: {
    errorCode?: string;
    hint?: string;
    ttnStatus?: number;
    cluster?: string;
    applicationId?: string;
    deviceId?: string;
    settingsSource?: string;
    requiredRights?: string[];
    extraFields?: Record<string, unknown>;
  } = {}
): Response {
  const {
    errorCode,
    hint,
    ttnStatus,
    cluster,
    applicationId,
    deviceId,
    settingsSource,
    requiredRights,
    extraFields = {},
  } = options;

  const body: TTNResponse = {
    ok: false,
    error,
    error_code: errorCode,
    hint,
    request_id: requestId,
    ttn_status: ttnStatus,
    cluster,
    application_id: applicationId,
    device_id: deviceId,
    settings_source: settingsSource,
    ...extraFields,
    ...(requiredRights && { required_rights: requiredRights }),
  };

  return new Response(
    JSON.stringify(body),
    {
      status: 200, // Always 200 for TTN errors so invoke() can parse
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Generate a unique request ID for traceability
 */
export function generateRequestId(prefix: string = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}-${uuid.slice(0, 8)}` : uuid;
}
