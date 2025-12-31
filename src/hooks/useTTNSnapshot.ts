import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface TTNSnapshot {
  // TTN Configuration
  cluster: string;
  application_id: string;
  api_key_name?: string;
  api_key_last4: string;
  api_key_id?: string;
  ttn_enabled: boolean;
  
  // Webhook Configuration
  webhook_id?: string;
  webhook_enabled: boolean;
  webhook_base_url?: string;
  webhook_path?: string;
  webhook_headers?: Record<string, string>;
  
  // Metadata
  updated_at: string;
  last_test_at?: string;
  last_test_success?: boolean;
  last_test_message?: string;
  
  // Source tracking
  source: 'frostguard';
  fetched_at: string;
}

interface UseTTNSnapshotReturn {
  snapshot: TTNSnapshot | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  fetchSnapshot: (userId: string, orgId?: string, siteId?: string) => Promise<TTNSnapshot | null>;
  clearSnapshot: () => void;
}

export function useTTNSnapshot(): UseTTNSnapshotReturn {
  const [snapshot, setSnapshot] = useState<TTNSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (
    userId: string,
    orgId?: string,
    siteId?: string
  ): Promise<TTNSnapshot | null> => {
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      console.log('[useTTNSnapshot] Fetching snapshot for user:', userId);

      const { data, error: invokeError } = await supabase.functions.invoke('proxy-frostguard-ttn-snapshot', {
        body: {
          selected_user_id: userId,
          org_id: orgId,
          site_id: siteId,
        },
      });

      if (invokeError) {
        throw invokeError;
      }

      if (data.ok && data.snapshot) {
        const enrichedSnapshot: TTNSnapshot = {
          ...data.snapshot,
          source: 'frostguard',
          fetched_at: new Date().toISOString(),
        };
        setSnapshot(enrichedSnapshot);
        console.log('[useTTNSnapshot] Snapshot loaded:', enrichedSnapshot.application_id);
        return enrichedSnapshot;
      } else {
        const errMsg = data.error || 'Failed to fetch TTN snapshot';
        const errCode = data.code || 'UNKNOWN';
        setError(errMsg);
        setErrorCode(errCode);
        
        // Show appropriate toast based on error code
        handleSnapshotError(errCode, errMsg);
        return null;
      }
    } catch (err: any) {
      const message = err.message || 'Failed to fetch TTN snapshot';
      setError(message);
      setErrorCode('NETWORK_ERROR');
      toast({
        title: 'Connection Failed',
        description: 'Could not reach FrostGuard. Check your internet connection.',
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
    'UNAUTHORIZED': {
      title: 'Access Denied',
      description: 'Integration snapshot access denied. Check shared secret configuration.',
      variant: 'destructive',
    },
    'NOT_FOUND': {
      title: 'No Integration Found',
      description: 'No TTN integration saved for this user. Provision in FrostGuard first.',
      variant: 'default',
    },
    'UPSTREAM_ERROR': {
      title: 'FrostGuard Error',
      description: 'FrostGuard snapshot service error. Try again later.',
      variant: 'destructive',
    },
    'NETWORK_ERROR': {
      title: 'Connection Failed',
      description: 'Could not reach FrostGuard. Check your internet connection.',
      variant: 'destructive',
    },
    'CONFIG_ERROR': {
      title: 'Configuration Error',
      description: 'FrostGuard sync not configured properly.',
      variant: 'destructive',
    },
  };

  const error = errorMessages[code] || { title: 'Error', description: message, variant: 'destructive' as const };
  toast({ title: error.title, description: error.description, variant: error.variant || 'destructive' });
}
