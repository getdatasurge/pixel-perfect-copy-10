/**
 * TTN Delete Device Edge Function
 * Deletes a device from The Things Network
 */

import { handleCorsPreflightRequest } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { 
  loadTTNSettings, 
  normalizeDevEui, 
  generateTTNDeviceId,
  getTTNApiBaseUrl,
  isValidCluster,
  successResponse,
  errorResponse,
  generateRequestId,
  type TTNCluster,
} from "../_shared/mod.ts";

interface DeleteDeviceRequest {
  dev_eui: string;
  org_id: string;
  device_id?: string;        // UUID for direct DB delete
  selected_user_id?: string;
  application_id?: string;
  cluster?: string;
  skip_ttn?: boolean;        // Skip TTN API, just clean database
}

Deno.serve(async (req: Request) => {
  const requestId = generateRequestId('ttn-del');

  // Handle CORS preflight
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return errorResponse('Method not allowed', requestId, { httpStatus: 405 });
  }

  try {
    const body: DeleteDeviceRequest = await req.json();
    const { dev_eui, org_id, device_id, selected_user_id, application_id, cluster, skip_ttn } = body;

    console.log(`[${requestId}] Delete device request:`, { 
      dev_eui: dev_eui?.slice(-4), 
      org_id, 
      device_id: device_id?.slice(-4),
      selected_user_id,
      application_id,
      cluster,
      skip_ttn,
    });

    // Validate required fields
    if (!dev_eui) {
      return errorResponse('dev_eui is required', requestId, { 
        errorCode: 'MISSING_DEV_EUI' 
      });
    }

    if (!org_id) {
      return errorResponse('org_id is required', requestId, { 
        errorCode: 'MISSING_ORG_ID' 
      });
    }

    // Normalize DevEUI
    const normalizedDevEui = normalizeDevEui(dev_eui);
    if (!normalizedDevEui) {
      return errorResponse('Invalid DevEUI format', requestId, { 
        errorCode: 'INVALID_DEV_EUI',
        hint: 'DevEUI must be 16 hex characters',
      });
    }

    // Generate device ID
    const deviceId = generateTTNDeviceId(dev_eui);
    if (!deviceId) {
      return errorResponse('Failed to generate device ID', requestId, { 
        errorCode: 'DEVICE_ID_GENERATION_FAILED' 
      });
    }

    const supabase = getSupabaseClient();

    // If skip_ttn flag is set, only do database cleanup
    if (skip_ttn) {
      console.log(`[${requestId}] Skipping TTN API - database cleanup only`);
      
      // Delete from lora_sensors table using device_id or dev_eui
      let deleteQuery = supabase.from('lora_sensors').delete().eq('org_id', org_id);
      
      if (device_id) {
        deleteQuery = deleteQuery.eq('id', device_id);
      } else {
        deleteQuery = deleteQuery.eq('dev_eui', normalizedDevEui);
      }
      
      const { error: dbError } = await deleteQuery;

      if (dbError) {
        console.warn(`[${requestId}] DB delete warning:`, dbError.message);
        // Return success anyway - device may not have been in DB
      } else {
        console.log(`[${requestId}] Removed from lora_sensors table (DB-only mode)`);
      }

      return successResponse({
        deleted: true,
        device_id: deviceId,
        dev_eui: normalizedDevEui,
        removed_from_db: !dbError,
        skip_ttn: true,
      }, requestId);
    }

    // Load TTN settings for API call
    const { settings, source } = await loadTTNSettings(selected_user_id || '', org_id);

    console.log(`[${requestId}] TTN settings loaded from: ${source}`);

    if (!settings) {
      return errorResponse('TTN settings not found', requestId, { 
        errorCode: 'TTN_NOT_CONFIGURED',
        hint: 'Configure TTN settings in the Webhook tab first',
      });
    }

    // Use provided values or fall back to settings
    const effectiveCluster = cluster || settings.cluster;
    const effectiveAppId = application_id || settings.application_id;
    const apiKey = settings.api_key;

    if (!effectiveCluster || !isValidCluster(effectiveCluster)) {
      return errorResponse('Invalid or missing TTN cluster', requestId, { 
        errorCode: 'INVALID_CLUSTER' 
      });
    }

    if (!effectiveAppId) {
      return errorResponse('TTN Application ID not configured', requestId, {
        errorCode: 'MISSING_APPLICATION_ID' 
      });
    }

    if (!apiKey) {
      return errorResponse('TTN API key not configured', requestId, { 
        errorCode: 'MISSING_API_KEY',
        hint: 'API key is required for device deletion',
      });
    }

    // Build TTN API URL
    const baseUrl = getTTNApiBaseUrl(effectiveCluster as TTNCluster);
    const deleteUrl = `${baseUrl}/applications/${effectiveAppId}/devices/${deviceId}`;

    console.log(`[${requestId}] Calling TTN API:`, { 
      url: deleteUrl.replace(apiKey, '***'),
      deviceId,
    });

    // Call TTN API to delete device
    const ttnResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!ttnResponse.ok) {
      const errorText = await ttnResponse.text();
      let errorDetail: string;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.message || errorJson.error || errorText;
      } catch {
        errorDetail = errorText;
      }

      // Handle specific error codes
      if (ttnResponse.status === 404) {
        console.log(`[${requestId}] Device not found in TTN (already deleted?)`);
        // Return success if device doesn't exist - it's already deleted
        return successResponse({
          deleted: true,
          device_id: deviceId,
          dev_eui: normalizedDevEui,
          already_deleted: true,
          message: 'Device not found in TTN (may have been already deleted)',
        }, requestId);
      }

      console.error(`[${requestId}] TTN API error:`, { 
        status: ttnResponse.status, 
        error: errorDetail 
      });

      return errorResponse(`TTN API error: ${errorDetail}`, requestId, { 
        errorCode: 'TTN_API_ERROR',
        httpStatus: 200, // Keep 200 so client can parse the response
      });
    }

    console.log(`[${requestId}] Device deleted from TTN successfully:`, deviceId);

    // Optionally remove from local lora_sensors table
    const { error: dbError } = await supabase
      .from('lora_sensors')
      .delete()
      .eq('dev_eui', normalizedDevEui)
      .eq('org_id', org_id);

    if (dbError) {
      console.warn(`[${requestId}] Failed to remove from lora_sensors:`, dbError.message);
      // Don't fail the request - TTN deletion was successful
    } else {
      console.log(`[${requestId}] Also removed from lora_sensors table`);
    }

    return successResponse({
      deleted: true,
      device_id: deviceId,
      dev_eui: normalizedDevEui,
      removed_from_db: !dbError,
    }, requestId);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${requestId}] Unexpected error:`, message);
    return errorResponse(`Internal error: ${message}`, requestId, { 
      errorCode: 'INTERNAL_ERROR' 
    });
  }
});
