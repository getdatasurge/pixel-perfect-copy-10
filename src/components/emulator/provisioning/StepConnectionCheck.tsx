import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Settings } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { TTNConfig } from '@/lib/ttn-payload';

interface StepConnectionCheckProps {
  ttnConfig?: TTNConfig;
  orgId?: string;
  onValidationComplete: (success: boolean) => void;
}

interface CheckResult {
  name: string;
  status: 'pending' | 'checking' | 'passed' | 'failed';
  message?: string;
}

export default function StepConnectionCheck({
  ttnConfig,
  orgId,
  onValidationComplete,
}: StepConnectionCheckProps) {
  const [checks, setChecks] = useState<CheckResult[]>([
    { name: 'TTN Integration Enabled', status: 'pending' },
    { name: 'Cluster Configured', status: 'pending' },
    { name: 'Application ID Set', status: 'pending' },
    { name: 'API Key Valid', status: 'pending' },
    { name: 'Required Permissions', status: 'pending' },
  ]);
  const [isValidating, setIsValidating] = useState(false);
  const [overallStatus, setOverallStatus] = useState<'pending' | 'success' | 'failed'>('pending');

  const runValidation = async () => {
    setIsValidating(true);
    setOverallStatus('pending');
    
    const newChecks: CheckResult[] = [...checks];
    
    // Check 1: TTN Integration Enabled
    newChecks[0] = {
      name: 'TTN Integration Enabled',
      status: ttnConfig?.enabled ? 'passed' : 'failed',
      message: ttnConfig?.enabled ? undefined : 'Enable TTN integration in Webhook settings',
    };
    setChecks([...newChecks]);

    if (!ttnConfig?.enabled) {
      setIsValidating(false);
      setOverallStatus('failed');
      onValidationComplete(false);
      return;
    }

    // Check 2: Cluster Configured
    newChecks[1] = {
      name: 'Cluster Configured',
      status: ttnConfig?.cluster ? 'passed' : 'failed',
      message: ttnConfig?.cluster ? `Using ${ttnConfig.cluster}` : 'Select a TTN cluster',
    };
    setChecks([...newChecks]);

    if (!ttnConfig?.cluster) {
      setIsValidating(false);
      setOverallStatus('failed');
      onValidationComplete(false);
      return;
    }

    // Check 3: Application ID Set
    newChecks[2] = {
      name: 'Application ID Set',
      status: ttnConfig?.applicationId ? 'passed' : 'failed',
      message: ttnConfig?.applicationId ? ttnConfig.applicationId : 'Enter your TTN Application ID',
    };
    setChecks([...newChecks]);

    if (!ttnConfig?.applicationId) {
      setIsValidating(false);
      setOverallStatus('failed');
      onValidationComplete(false);
      return;
    }

    // Check 4 & 5: API Key and Permissions (via edge function)
    newChecks[3] = { ...newChecks[3], status: 'checking' };
    newChecks[4] = { ...newChecks[4], status: 'checking' };
    setChecks([...newChecks]);

    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test',
          org_id: orgId,
          cluster: ttnConfig.cluster,
          application_id: ttnConfig.applicationId,
        },
      });

      if (error) throw error;

      if (data?.ok) {
        newChecks[3] = { name: 'API Key Valid', status: 'passed', message: 'API key verified' };
        newChecks[4] = { name: 'Required Permissions', status: 'passed', message: 'All permissions available' };
        setChecks([...newChecks]);
        setOverallStatus('success');
        onValidationComplete(true);
      } else {
        const errorMsg = data?.error || 'Connection test failed';
        const isPermissionError = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('403');
        
        if (isPermissionError) {
          newChecks[3] = { name: 'API Key Valid', status: 'passed' };
          newChecks[4] = { name: 'Required Permissions', status: 'failed', message: errorMsg };
        } else {
          newChecks[3] = { name: 'API Key Valid', status: 'failed', message: errorMsg };
          newChecks[4] = { name: 'Required Permissions', status: 'pending' };
        }
        setChecks([...newChecks]);
        setOverallStatus('failed');
        onValidationComplete(false);
      }
    } catch (err: any) {
      newChecks[3] = { name: 'API Key Valid', status: 'failed', message: err.message };
      newChecks[4] = { name: 'Required Permissions', status: 'pending' };
      setChecks([...newChecks]);
      setOverallStatus('failed');
      onValidationComplete(false);
    }

    setIsValidating(false);
  };

  useEffect(() => {
    runValidation();
  }, []);

  const getStatusIcon = (status: CheckResult['status']) => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'passed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {checks.map((check, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 rounded-lg border bg-card"
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(check.status)}
              <div>
                <p className="text-sm font-medium">{check.name}</p>
                {check.message && (
                  <p className="text-xs text-muted-foreground">{check.message}</p>
                )}
              </div>
            </div>
            {check.status === 'passed' && (
              <Badge variant="outline" className="text-green-600 border-green-600/30">
                OK
              </Badge>
            )}
            {check.status === 'failed' && (
              <Badge variant="destructive">Failed</Badge>
            )}
          </div>
        ))}
      </div>

      {overallStatus === 'failed' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Fix the issues above before provisioning devices.</span>
            <Button variant="outline" size="sm" className="ml-4" asChild>
              <a href="#webhook">
                <Settings className="h-3 w-3 mr-2" />
                Fix in Settings
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {overallStatus === 'success' && (
        <Alert className="border-green-600/30 bg-green-50 dark:bg-green-950/20">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-400">
            TTN connection validated. Ready to provision devices.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={runValidation}
          disabled={isValidating}
        >
          {isValidating && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
          Re-check Connection
        </Button>
      </div>
    </div>
  );
}
