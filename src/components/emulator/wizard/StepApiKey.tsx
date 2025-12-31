import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, Check, X, Key, ShieldCheck } from 'lucide-react';
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

const REQUIRED_PERMISSIONS = [
  { key: 'applications:read', label: 'Read application settings' },
  { key: 'devices:read', label: 'Read device information' },
  { key: 'devices:write', label: 'Write device settings' },
  { key: 'Write downlink traffic', label: 'Simulate uplinks' },
];

export default function StepApiKey({
  config,
  updateConfig,
  markStepPassed,
  stepStatus,
  isValidating,
  setIsValidating,
}: StepApiKeyProps) {
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message?: string;
    hint?: string;
    code?: string;
  } | null>(null);

  const testConnection = async () => {
    if (!config.apiKey || !config.applicationId) return;

    setIsValidating(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'test',
          cluster: config.cluster,
          application_id: config.applicationId,
          api_key: config.apiKey,
        },
      });

      if (error) {
        setTestResult({ ok: false, message: error.message });
        markStepPassed(3, false, error.message);
        return;
      }

      if (data?.ok && data?.connected) {
        setTestResult({ ok: true, message: 'API key valid! Connected to TTN.' });
        markStepPassed(3, true);
      } else {
        setTestResult({
          ok: false,
          message: data?.error || 'Connection failed',
          hint: data?.hint,
          code: data?.code,
        });
        markStepPassed(3, false, data?.error);
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

      {/* Required Permissions Checklist */}
      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <Label className="text-sm font-medium">Required Permissions</Label>
        <div className="grid gap-2">
          {REQUIRED_PERMISSIONS.map((perm) => (
            <div key={perm.key} className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <code className="bg-background px-1 rounded text-xs">{perm.key}</code>
              <span className="text-muted-foreground">— {perm.label}</span>
            </div>
          ))}
        </div>
      </div>

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
          Test Connection
        </Button>

        {testResult && (
          <Alert variant={testResult.ok ? 'default' : 'destructive'}>
            {testResult.ok ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
            <AlertTitle>{testResult.ok ? 'Connected!' : 'Connection Failed'}</AlertTitle>
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
