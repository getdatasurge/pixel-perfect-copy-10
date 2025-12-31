import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface TTNSnapshot {
  cluster: string;
  application_id: string;
  api_key_last4: string;
  ttn_enabled: boolean;
  webhook_enabled: boolean;
  updated_at: string;
  last_test_at?: string;
  last_test_success?: boolean;
  // Live TTN data
  ttn_application_name?: string;
  ttn_device_count?: number;
  ttn_connected: boolean;
  ttn_error?: string;
  // Source tracking
  source: 'ttn-direct';
  fetched_at: string;
}

interface UseTTNSnapshotReturn {
  snapshot: TTNSnapshot | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  fetchSnapshot: (orgId: string) => Promise<TTNSnapshot | null>;
  clearSnapshot: () => void;
}

export function useTTNSnapshot(): UseTTNSnapshotReturn {
  const [snapshot, setSnapshot] = useState<TTNSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (orgId: string): Promise<TTNSnapshot | null> => {
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      console.log('[useTTNSnapshot] Fetching snapshot for org:', orgId);

      const { data, error: invokeError } = await supabase.functions.invoke('query-ttn-snapshot', {
        body: { org_id: orgId },
      });

      if (invokeError) {
        throw invokeError;
      }

      if (data.ok && data.snapshot) {
        const enrichedSnapshot: TTNSnapshot = {
          ...data.snapshot,
          source: 'ttn-direct',
          fetched_at: new Date().toISOString(),
        };
        setSnapshot(enrichedSnapshot);
        console.log('[useTTNSnapshot] Snapshot loaded:', enrichedSnapshot.application_id, 'connected:', enrichedSnapshot.ttn_connected);
        return enrichedSnapshot;
      } else {
        const errMsg = data.error || 'Failed to fetch TTN snapshot';
        const errCode = data.code || 'UNKNOWN';
        setError(errMsg);
        setErrorCode(errCode);
        handleSnapshotError(errCode, errMsg);
        return null;
      }
    } catch (err: any) {
      const message = err.message || 'Failed to fetch TTN snapshot';
      setError(message);
      setErrorCode('NETWORK_ERROR');
      toast({
        title: 'Connection Failed',
        description: 'Could not query TTN settings. Check your connection.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSnapshot = useCallback(() => {
    setSnapshot(null);
    setError(null);
    setErrorCode(null);
  }, []);

  return {
    snapshot,
    loading,
    error,
    errorCode,
    fetchSnapshot,
    clearSnapshot,
  };
}

function handleSnapshotError(code: string, message: string) {
  const errorMessages: Record<string, { title: string; description: string; variant?: 'default' | 'destructive' }> = {
    'NOT_FOUND': {
      title: 'No TTN Settings',
      description: 'No TTN settings found for this organization. Configure in the Webhook tab.',
      variant: 'default',
    },
    'INCOMPLETE_SETTINGS': {
      title: 'Settings Incomplete',
      description: 'TTN settings are incomplete. Please configure application ID and API key.',
      variant: 'default',
    },
    'NETWORK_ERROR': {
      title: 'Connection Failed',
      description: 'Could not query TTN settings.',
      variant: 'destructive',
    },
  };

  const error = errorMessages[code] || { title: 'Error', description: message, variant: 'destructive' as const };
  toast({ title: error.title, description: error.description, variant: error.variant || 'destructive' });
}
