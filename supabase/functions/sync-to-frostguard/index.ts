import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sync bundle structure matching frontend SyncBundle interface
interface SyncBundle {
  metadata: {
    sync_run_id: string;
    initiated_at: string;
    source_project: string;
  };
  context: {
    org_id: string;
    site_id: string;
    unit_id_override?: string;
    selected_user_id?: string;
  };
  entities: {
    gateways: Array<{
      id: string;
      name: string;
      eui: string;
      is_online: boolean;
    }>;
    devices: Array<{
      id: string;
      name: string;
      dev_eui: string;
      join_eui: string;
      app_key: string;
      type: 'temperature' | 'door';
      gateway_id: string;
    }>;
  };
  // Legacy fallback fields (for direct DB writes)
  frostguardApiUrl?: string;
}

interface SyncResponse {
  success: boolean;
  sync_run_id: string;
  method: 'endpoint' | 'direct';
  results?: {
    gateways: { synced: number; failed: number; errors: string[] };
    devices: { synced: number; failed: number; errors: string[] };
  };
  summary?: string;
  error?: string;
}

const PROJECT1_ENDPOINT = 'https://mfwyiifehsvwnjwqoxht.supabase.co/functions/v1/emulator-sync';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SyncBundle = await req.json();
    console.log('Sync request received:', JSON.stringify(body, null, 2));

    const { metadata, context, entities, frostguardApiUrl } = body;

    // Validate required fields
    if (!metadata?.sync_run_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'sync_run_id is required in metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!context?.org_id) {
      return new Response(
        JSON.stringify({ success: false, sync_run_id: metadata.sync_run_id, error: 'org_id is required in context' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!context?.site_id) {
      return new Response(
        JSON.stringify({ success: false, sync_run_id: metadata.sync_run_id, error: 'site_id is required in context' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try Project 1 endpoint first
    const emulatorSyncApiKey = Deno.env.get('EMULATOR_SYNC_API_KEY');
    
    if (emulatorSyncApiKey) {
      console.log(`Attempting sync to Project 1 endpoint: ${PROJECT1_ENDPOINT}`);
      
      try {
        const response = await fetch(PROJECT1_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${emulatorSyncApiKey}`,
          },
          body: JSON.stringify(body),
        });

        console.log(`Project 1 response status: ${response.status}`);

        // If endpoint exists and responds (even with error), use that response
        if (response.status !== 404) {
          const responseData = await response.json();
          console.log('Project 1 response:', JSON.stringify(responseData, null, 2));
          
          return new Response(
            JSON.stringify({
              ...responseData,
              sync_run_id: metadata.sync_run_id,
              method: 'endpoint',
            }),
            { 
              status: response.ok ? 200 : response.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        console.log('Project 1 endpoint returned 404, falling back to direct writes');
      } catch (fetchError) {
        console.error('Failed to reach Project 1 endpoint:', fetchError);
        console.log('Falling back to direct database writes');
      }
    } else {
      console.log('EMULATOR_SYNC_API_KEY not configured, using direct writes');
    }

    // Fallback: Direct database writes to FrostGuard
    if (!frostguardApiUrl) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          sync_run_id: metadata.sync_run_id,
          error: 'Project 1 endpoint unavailable and no frostguardApiUrl provided for fallback' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const frostguardAnonKey = Deno.env.get('FROSTGUARD_ANON_KEY');
    if (!frostguardAnonKey) {
      console.error('FROSTGUARD_ANON_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, sync_run_id: metadata.sync_run_id, error: 'FROSTGUARD_ANON_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize the URL
    let baseUrl = frostguardApiUrl;
    if (frostguardApiUrl.includes('/functions/')) {
      const match = frostguardApiUrl.match(/^(https?:\/\/[^\/]+)/);
      if (match) {
        baseUrl = match[1];
        console.log('Normalized FrostGuard URL from', frostguardApiUrl, 'to', baseUrl);
      }
    }

    const frostguardClient = createClient(baseUrl, frostguardAnonKey);

    const results = {
      gateways: { synced: 0, failed: 0, errors: [] as string[] },
      devices: { synced: 0, failed: 0, errors: [] as string[] },
    };

    // Sync gateways
    if (entities.gateways && entities.gateways.length > 0) {
      console.log(`Syncing ${entities.gateways.length} gateways via direct writes...`);
      
      for (const gateway of entities.gateways) {
        try {
          const { error } = await frostguardClient
            .from('gateways')
            .upsert({
              id: gateway.id,
              name: gateway.name,
              status: gateway.is_online ? 'online' : 'offline',
            }, { onConflict: 'id' });

          if (error) {
            console.error(`Failed to sync gateway ${gateway.name}:`, error);
            results.gateways.failed++;
            results.gateways.errors.push(`${gateway.name}: ${error.message}`);
          } else {
            console.log(`Successfully synced gateway: ${gateway.name}`);
            results.gateways.synced++;
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`Exception syncing gateway ${gateway.name}:`, err);
          results.gateways.failed++;
          results.gateways.errors.push(`${gateway.name}: ${errorMessage}`);
        }
      }
    }

    // Sync devices (sensors)
    if (entities.devices && entities.devices.length > 0) {
      console.log(`Syncing ${entities.devices.length} devices via direct writes...`);
      
      for (const device of entities.devices) {
        try {
          const sensorData: Record<string, unknown> = {
            id: device.id,
            name: device.name,
            dev_eui: device.dev_eui,
            join_eui: device.join_eui,
            app_key: device.app_key,
            sensor_type: device.type,
            gateway_id: device.gateway_id,
          };

          // Add context fields
          if (context.site_id) {
            sensorData.site_id = context.site_id;
          }
          if (context.unit_id_override) {
            sensorData.unit_id = context.unit_id_override;
          }

          const { error } = await frostguardClient
            .from('lora_sensors')
            .upsert(sensorData, { onConflict: 'id' });

          if (error) {
            console.error(`Failed to sync device ${device.name}:`, error);
            results.devices.failed++;
            results.devices.errors.push(`${device.name}: ${error.message}`);
          } else {
            console.log(`Successfully synced device: ${device.name}`);
            results.devices.synced++;
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`Exception syncing device ${device.name}:`, err);
          results.devices.failed++;
          results.devices.errors.push(`${device.name}: ${errorMessage}`);
        }
      }
    }

    const totalSynced = results.gateways.synced + results.devices.synced;
    const totalFailed = results.gateways.failed + results.devices.failed;
    const summary = `Synced ${results.gateways.synced} gateways and ${results.devices.synced} devices`;

    console.log(`Direct sync complete: ${totalSynced} synced, ${totalFailed} failed`);

    const response: SyncResponse = {
      success: totalFailed === 0,
      sync_run_id: metadata.sync_run_id,
      method: 'direct',
      results,
      summary,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error in sync-to-frostguard:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
