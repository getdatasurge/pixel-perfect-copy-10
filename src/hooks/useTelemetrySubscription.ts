import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UnitTelemetry {
  id: string;
  unit_id: string;
  org_id: string;
  last_temp_f: number | null;
  last_humidity: number | null;
  door_state: 'open' | 'closed' | 'unknown';
  last_door_event_at: string | null;
  battery_pct: number | null;
  rssi_dbm: number | null;
  snr_db: number | null;
  last_uplink_at: string | null;
  updated_at: string;
  expected_checkin_minutes: number;
  warn_after_missed: number;
  critical_after_missed: number;
}

interface UseTelemetryOptions {
  orgId?: string;
  unitId?: string;
  enabled?: boolean;
}

export function useTelemetrySubscription({ orgId, unitId, enabled = true }: UseTelemetryOptions) {
  const [telemetry, setTelemetry] = useState<UnitTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calculate sensor online status
  const getSensorStatus = useCallback((lastUplink: string | null, expectedMinutes: number, warnAfter: number, criticalAfter: number) => {
    if (!lastUplink) return 'unknown';
    
    const lastTime = new Date(lastUplink).getTime();
    const now = Date.now();
    const missedIntervals = Math.floor((now - lastTime) / (expectedMinutes * 60 * 1000));
    
    if (missedIntervals >= criticalAfter) return 'offline';
    if (missedIntervals >= warnAfter) return 'warning';
    return 'online';
  }, []);

  // Fetch initial telemetry
  const fetchTelemetry = useCallback(async () => {
    if (!enabled || !orgId) {
      setLoading(false);
      return;
    }

    try {
      // Only query by org_id since unitId is just a string override, not the actual UUID
      let query = supabase
        .from('unit_telemetry')
        .select('*')
        .eq('org_id', orgId);

      const { data, error: fetchError } = await query.limit(1).maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      if (data) {
        setTelemetry(data as UnitTelemetry);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch telemetry');
    } finally {
      setLoading(false);
    }
  }, [orgId, enabled]);

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !orgId) return;

    fetchTelemetry();

    // Subscribe to realtime updates (filter by org_id only)
    const channel = supabase
      .channel('unit_telemetry_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'unit_telemetry',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newData = payload.new as UnitTelemetry;
            // Only update if it matches our org
            if (newData.org_id !== orgId) return;
            setTelemetry(newData);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, enabled, fetchTelemetry]);

  return {
    telemetry,
    loading,
    error,
    getSensorStatus,
    refetch: fetchTelemetry,
  };
}
