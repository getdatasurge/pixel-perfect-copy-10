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
    if (!enabled || (!orgId && !unitId)) {
      setLoading(false);
      return;
    }

    try {
      let query = supabase
        .from('unit_telemetry')
        .select('*');

      if (unitId) {
        query = query.eq('unit_id', unitId);
      } else if (orgId) {
        query = query.eq('org_id', orgId);
      }

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
  }, [orgId, unitId, enabled]);

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled) return;

    fetchTelemetry();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('unit_telemetry_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'unit_telemetry',
          ...(unitId ? { filter: `unit_id=eq.${unitId}` } : {}),
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newData = payload.new as UnitTelemetry;
            // Only update if it matches our filter
            if (unitId && newData.unit_id !== unitId) return;
            if (orgId && newData.org_id !== orgId) return;
            setTelemetry(newData);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, unitId, enabled, fetchTelemetry]);

  return {
    telemetry,
    loading,
    error,
    getSensorStatus,
    refetch: fetchTelemetry,
  };
}
