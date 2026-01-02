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
  mode?: 'devices' | 'gateways';
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
  mode = 'devices',
}: StepConnectionCheckProps) {
  const isGatewayMode = mode === 'gateways';
  
  const getInitialChecks = (): CheckResult[] => {
    const baseChecks: CheckResult[] = [
      { name: 'TTN Integration Enabled', status: 'pending' },
      { name: 'Cluster Configured', status: 'pending' },
      { name: 'Application ID Set', status: 'pending' },
      { name: 'API Key Saved', status: 'pending' },
      { name: 'Application Access', status: 'pending' },
    ];
    
    if (isGatewayMode) {
      baseChecks.push(
        { name: 'Gateway Read Permission', status: 'pending' },
        { name: 'Gateway Write Permission', status: 'pending' }
      );
    }
    
    return baseChecks;
  };

  const [checks, setChecks] = useState<CheckResult[]>(getInitialChecks);
  const [isValidating, setIsValidating] = useState(false);
  const [overallStatus, setOverallStatus] = useState<'pending' | 'success' | 'failed'>('pending');

  const runValidation = async () => {
    setIsValidating(true);
    setOverallStatus('pending');
    
    const newChecks: CheckResult[] = getInitialChecks();
    
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

    // Check 4 & 5: API Key and Application Access (via edge function using stored key)
    newChecks[3] = { ...newChecks[3], status: 'checking' };
    newChecks[4] = { ...newChecks[4], status: 'checking' };
    setChecks([...newChecks]);

    try {
      // Use test_stored to validate using the server-side stored API key
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test_stored',
          org_id: orgId,
        },
      });

      if (error) throw error;

      if (data?.ok && data?.connected) {
        newChecks[3] = { name: 'API Key Saved', status: 'passed', message: 'API key verified' };
        newChecks[4] = { name: 'Application Access', status: 'passed', message: 'Application accessible' };
        setChecks([...newChecks]);
        
        // If gateway mode, continue to check gateway permissions
        if (isGatewayMode) {
          await checkGatewayPermissions(newChecks);
        } else {
          setOverallStatus('success');
          onValidationComplete(true);
        }
      } else {
        const errorMsg = data?.error || 'Connection test failed';
        const errorCode = data?.code || '';
        
        // Check specific error codes
        if (errorCode === 'NO_API_KEY' || errorCode === 'NOT_CONFIGURED') {
          newChecks[3] = { name: 'API Key Saved', status: 'failed', message: 'No API key saved. Save settings first.' };
          newChecks[4] = { name: 'Application Access', status: 'pending' };
        } else if (errorCode === 'PERMISSION_DENIED' || errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('403')) {
          newChecks[3] = { name: 'API Key Saved', status: 'passed' };
          newChecks[4] = { name: 'Application Access', status: 'failed', message: errorMsg };
        } else if (errorCode === 'AUTH_INVALID') {
          newChecks[3] = { name: 'API Key Saved', status: 'failed', message: 'API key invalid or expired' };
          newChecks[4] = { name: 'Application Access', status: 'pending' };
        } else {
          newChecks[3] = { name: 'API Key Saved', status: 'failed', message: errorMsg };
          newChecks[4] = { name: 'Application Access', status: 'pending' };
        }
        setChecks([...newChecks]);
        setOverallStatus('failed');
        onValidationComplete(false);
      }
    } catch (err: any) {
      newChecks[3] = { name: 'API Key Saved', status: 'failed', message: err.message };
      newChecks[4] = { name: 'Application Access', status: 'pending' };
      setChecks([...newChecks]);
      setOverallStatus('failed');
      onValidationComplete(false);
    }

    setIsValidating(false);
  };

  const checkGatewayPermissions = async (currentChecks: CheckResult[]) => {
    const gatewayReadIdx = currentChecks.findIndex(c => c.name === 'Gateway Read Permission');
    const gatewayWriteIdx = currentChecks.findIndex(c => c.name === 'Gateway Write Permission');
    
    if (gatewayReadIdx < 0 || gatewayWriteIdx < 0) {
      setOverallStatus('success');
      onValidationComplete(true);
      setIsValidating(false);
      return;
    }

    currentChecks[gatewayReadIdx] = { ...currentChecks[gatewayReadIdx], status: 'checking' };
    currentChecks[gatewayWriteIdx] = { ...currentChecks[gatewayWriteIdx], status: 'checking' };
    setChecks([...currentChecks]);

    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_gateway_permissions',
          org_id: orgId,
        },
      });

      if (error) throw error;

      const perms = data?.permissions || {};
      const diagnostics = data?.diagnostics || {};

      currentChecks[gatewayReadIdx] = {
        name: 'Gateway Read Permission',
        status: perms.gateway_read ? 'passed' : 'failed',
        message: perms.gateway_read 
          ? 'Can list gateways' 
          : diagnostics.gateway_read_error || 'Missing gateways:read permission',
      };

      currentChecks[gatewayWriteIdx] = {
        name: 'Gateway Write Permission',
        status: perms.gateway_write ? 'passed' : 'failed',
        message: perms.gateway_write 
          ? 'Can register gateways' 
          : diagnostics.gateway_write_error || 'Missing gateways:write permission',
      };

      setChecks([...currentChecks]);

      if (perms.gateway_read && perms.gateway_write) {
        setOverallStatus('success');
        onValidationComplete(true);
      } else {
        setOverallStatus('failed');
        onValidationComplete(false);
      }
    } catch (err: any) {
      currentChecks[gatewayReadIdx] = {
        name: 'Gateway Read Permission',
        status: 'failed',
        message: err.message,
      };
      currentChecks[gatewayWriteIdx] = {
        name: 'Gateway Write Permission',
        status: 'pending',
      };
      setChecks([...currentChecks]);
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

  const entityLabel = isGatewayMode ? 'gateways' : 'devices';

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

      {overallStatus === 'failed' && isGatewayMode && checks.some(c => 
        (c.name.includes('Gateway') && c.status === 'failed')
      ) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>Your TTN API key is missing gateway permissions.</p>
              <div className="text-sm">
                <strong>How to fix:</strong>
                <ol className="list-decimal ml-4 mt-1 space-y-1">
                  <li>Open TTN Console → API Keys</li>
                  <li>Edit your API key or create a new one</li>
                  <li>Add permissions: <code className="bg-muted px-1 rounded">gateways:read</code>, <code className="bg-muted px-1 rounded">gateways:write</code></li>
                  <li>Save and update the key in Webhook Settings</li>
                </ol>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {overallStatus === 'failed' && !isGatewayMode && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Fix the issues above before provisioning {entityLabel}.</span>
            <Button variant="outline" size="sm" className="ml-4" asChild>
              <a href="#webhook">
                <Settings className="h-3 w-3 mr-2" />
                Fix in Settings
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {overallStatus === 'failed' && isGatewayMode && !checks.some(c => 
        (c.name.includes('Gateway') && c.status === 'failed')
      ) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Fix the issues above before provisioning {entityLabel}.</span>
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
            TTN connection validated. Ready to provision {entityLabel}.
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