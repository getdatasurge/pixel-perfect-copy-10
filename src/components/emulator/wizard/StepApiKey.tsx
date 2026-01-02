import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, Check, X, Key, ShieldCheck, Eye, ListChecks, Settings, Radio } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';
import { supabase } from '@/integrations/supabase/client';

interface StepApiKeyProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
  isValidating: boolean;
  setIsValidating: (v: boolean) => void;
}

// Map TTN right keys to user-friendly labels and icons
const PERMISSION_CONFIG: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; critical?: boolean }[] = [
  { key: 'RIGHT_APPLICATION_INFO', label: 'Read application info', icon: Eye },
  { key: 'RIGHT_APPLICATION_DEVICES_READ', label: 'Read devices', icon: ListChecks },
  { key: 'RIGHT_APPLICATION_DEVICES_WRITE', label: 'Write devices', icon: Settings },
  { key: 'RIGHT_APPLICATION_TRAFFIC_DOWN_WRITE', label: 'Simulate uplinks', icon: Radio, critical: true },
];

interface PermissionStatus {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  granted: boolean;
}

interface TestResult {
  ok: boolean;
  message?: string;
  hint?: string;
  code?: string;
  permissions?: PermissionStatus[];
  can_simulate?: boolean;
}

export default function StepApiKey({
  config,
  updateConfig,
  markStepPassed,
  stepStatus,
  isValidating,
  setIsValidating,
}: StepApiKeyProps) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const testConnection = async () => {
    if (!config.apiKey || !config.applicationId) return;

    setIsValidating(true);
    setTestResult(null);

    try {
      // Step 1: Basic connectivity test
      const { data: connData, error: connError } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test',
          cluster: config.cluster,
          application_id: config.applicationId,
          api_key: config.apiKey,
        },
      });

      if (connError) {
        setTestResult({ ok: false, message: connError.message });
        markStepPassed(3, false, connError.message);
        return;
      }

      if (!connData?.ok || !connData?.connected) {
        setTestResult({
          ok: false,
          message: connData?.error || 'Connection failed',
          hint: connData?.hint,
          code: connData?.code,
        });
        markStepPassed(3, false, connData?.error);
        return;
      }

      // Step 2: Permission check
      const { data: permData, error: permError } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_app_permissions',
          cluster: config.cluster,
          application_id: config.applicationId,
          api_key: config.apiKey,
        },
      });

      if (permError) {
        // Connection worked but permission check failed - still show success with warning
        setTestResult({ 
          ok: true, 
          message: 'Connected to TTN (could not verify permissions)',
          hint: 'Permission check failed, but connection is valid.',
        });
        markStepPassed(3, true);
        return;
      }

      if (permData?.ok && permData?.permissions) {
        setTestResult({
          ok: true,
          message: 'API key valid with all required permissions!',
          permissions: permData.permissions,
          can_simulate: permData.can_simulate,
        });
        markStepPassed(3, true);
      } else {
        // Connected but missing permissions
        setTestResult({
          ok: false,
          message: 'API key connected but missing permissions',
          hint: permData?.hint,
          permissions: permData?.permissions,
          can_simulate: permData?.can_simulate,
        });
        // Still mark as failed if missing critical permissions
        markStepPassed(3, false, 'Missing required permissions');
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
      markStepPassed(3, false, err.message);
    } finally {
      setIsValidating(false);
    }
  };

  const handleInputChange = (value: string) => {
    updateConfig({ apiKey: value });
    setTestResult(null);
    markStepPassed(3, false);
  };

  const ttnApiKeysUrl = `https://${config.cluster}.cloud.thethings.network/console/applications/${config.applicationId}/api-keys`;

  // Get icon component for a permission
  const getPermissionIcon = (key: string) => {
    const found = PERMISSION_CONFIG.find(p => p.key === key);
    return found?.icon || ShieldCheck;
  };

  const isCriticalPermission = (key: string) => {
    return PERMISSION_CONFIG.find(p => p.key === key)?.critical || false;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Configure API Key</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Create an API key in TTN Console with the required permissions.
        </p>
      </div>

      {/* Required Permissions Checklist - before testing */}
      {!testResult?.permissions && (
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <Label className="text-sm font-medium">Required Permissions</Label>
          <div className="grid gap-2">
            {PERMISSION_CONFIG.map((perm) => {
              const Icon = perm.icon;
              return (
                <div key={perm.key} className="flex items-center gap-2 text-sm">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">{perm.label}</span>
                  {perm.critical && (
                    <Badge variant="secondary" className="text-xs">Required for simulation</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Permission Status - after testing */}
      {testResult?.permissions && (
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <Label className="text-sm font-medium">Permission Status</Label>
          <div className="grid gap-2">
            {testResult.permissions.map((perm) => {
              const Icon = getPermissionIcon(perm.key);
              const isCritical = isCriticalPermission(perm.key);
              return (
                <div key={perm.key} className="flex items-center gap-2 text-sm">
                  {perm.granted ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-destructive" />
                  )}
                  <Icon className={`h-4 w-4 ${perm.granted ? 'text-muted-foreground' : 'text-destructive'}`} />
                  <span className={perm.granted ? 'text-muted-foreground' : 'text-destructive font-medium'}>
                    {perm.label}
                  </span>
                  {!perm.granted && (
                    <Badge variant="destructive" className="text-xs">Missing</Badge>
                  )}
                  {perm.granted && isCritical && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-200">Ready</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="apiKey">API Key</Label>
          <Input
            id="apiKey"
            type="password"
            placeholder="NNSXS.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..."
            value={config.apiKey}
            onChange={(e) => handleInputChange(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Create this in TTN Console → Application → API Keys
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a href={ttnApiKeysUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open API Keys Page
            </a>
          </Button>
        </div>

        <Button
          onClick={testConnection}
          disabled={isValidating || !config.apiKey || !config.applicationId}
          className="w-full"
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : testResult?.ok ? (
            <Check className="h-4 w-4 mr-2" />
          ) : null}
          {testResult?.permissions ? 'Re-check Permissions' : 'Test Connection & Permissions'}
        </Button>

        {testResult && (
          <Alert variant={testResult.ok ? 'default' : 'destructive'}>
            {testResult.ok ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
            <AlertTitle>
              {testResult.ok 
                ? (testResult.can_simulate ? 'Ready for Simulation!' : 'Connected!') 
                : 'Connection Failed'}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{testResult.message}</p>
              {testResult.code && (
                <Badge variant="outline" className="text-xs">{testResult.code}</Badge>
              )}
              {testResult.hint && (
                <p className="text-xs bg-background/50 p-2 rounded mt-2">{testResult.hint}</p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
