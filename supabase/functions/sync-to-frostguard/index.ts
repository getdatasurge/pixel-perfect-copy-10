import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GatewayData {
  id: string;
  name: string;
  eui: string;
  isOnline: boolean;
}

interface SensorData {
  id: string;
  name: string;
  devEui: string;
  type: 'temperature' | 'door';
  gatewayId?: string;
}

interface SyncRequest {
  gateways?: GatewayData[];
  sensors?: SensorData[];
  orgId: string;
  siteId?: string;
  unitId?: string;
  frostguardApiUrl: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const frostguardAnonKey = Deno.env.get('FROSTGUARD_ANON_KEY');
    if (!frostguardAnonKey) {
      console.error('FROSTGUARD_ANON_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'FROSTGUARD_ANON_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: SyncRequest = await req.json();
    console.log('Sync request received:', JSON.stringify(body, null, 2));

    const { gateways, sensors, orgId, siteId, unitId, frostguardApiUrl } = body;

    if (!orgId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Organization ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!frostguardApiUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'FrostGuard API URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize the URL - extract base URL if full path was provided
    let baseUrl = frostguardApiUrl;
    if (frostguardApiUrl.includes('/functions/')) {
      const match = frostguardApiUrl.match(/^(https?:\/\/[^\/]+)/);
      if (match) {
        baseUrl = match[1];
        console.log('Normalized FrostGuard URL from', frostguardApiUrl, 'to', baseUrl);
      }
    }

    // Create Supabase client for Freshtrack Pro
    const frostguardClient = createClient(baseUrl, frostguardAnonKey);

    const results = {
      gateways: { synced: 0, failed: 0, errors: [] as string[] },
      sensors: { synced: 0, failed: 0, errors: [] as string[] },
    };

    // Sync gateways
    if (gateways && gateways.length > 0) {
      console.log(`Syncing ${gateways.length} gateways...`);
      
      for (const gateway of gateways) {
        try {
          const { error } = await frostguardClient
            .from('gateways')
            .upsert({
              id: gateway.id,
              name: gateway.name,
              eui: gateway.eui,
              org_id: orgId,
              status: gateway.isOnline ? 'online' : 'offline',
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

    // Sync sensors
    if (sensors && sensors.length > 0) {
      console.log(`Syncing ${sensors.length} sensors...`);
      
      for (const sensor of sensors) {
        try {
          const sensorData: Record<string, unknown> = {
            id: sensor.id,
            name: sensor.name,
            dev_eui: sensor.devEui,
            sensor_type: sensor.type,
            org_id: orgId,
          };

          // Add optional fields if provided
          if (sensor.gatewayId) {
            sensorData.gateway_id = sensor.gatewayId;
          }
          if (siteId) {
            sensorData.site_id = siteId;
          }
          if (unitId) {
            sensorData.unit_id = unitId;
          }

          const { error } = await frostguardClient
            .from('sensors')
            .upsert(sensorData, { onConflict: 'id' });

          if (error) {
            console.error(`Failed to sync sensor ${sensor.name}:`, error);
            results.sensors.failed++;
            results.sensors.errors.push(`${sensor.name}: ${error.message}`);
          } else {
            console.log(`Successfully synced sensor: ${sensor.name}`);
            results.sensors.synced++;
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`Exception syncing sensor ${sensor.name}:`, err);
          results.sensors.failed++;
          results.sensors.errors.push(`${sensor.name}: ${errorMessage}`);
        }
      }
    }

    const totalSynced = results.gateways.synced + results.sensors.synced;
    const totalFailed = results.gateways.failed + results.sensors.failed;

    console.log(`Sync complete: ${totalSynced} synced, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({
        success: totalFailed === 0,
        results,
        summary: `Synced ${results.gateways.synced} gateways and ${results.sensors.synced} sensors`,
      }),
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
