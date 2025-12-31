import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExternalLink, Loader2, Check, X, AppWindow } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';
import { supabase } from '@/integrations/supabase/client';

interface StepApplicationIdProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
  isValidating: boolean;
  setIsValidating: (v: boolean) => void;
}

export default function StepApplicationId({
  config,
  updateConfig,
  markStepPassed,
  stepStatus,
  isValidating,
  setIsValidating,
}: StepApplicationIdProps) {
  const [validationResult, setValidationResult] = useState<{
    ok: boolean;
    message?: string;
    hint?: string;
  } | null>(null);

  const validateApplication = async () => {
    if (!config.applicationId || !config.apiKey) {
      // Can't validate without API key, just mark as needing API key
      markStepPassed(2, true);
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

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
        setValidationResult({ ok: false, message: error.message });
        markStepPassed(2, false, error.message);
        return;
      }

      if (data?.ok && data?.connected) {
        setValidationResult({ ok: true, message: 'Application found!' });
        markStepPassed(2, true);
      } else {
        setValidationResult({
          ok: false,
          message: data?.error || 'Application not found',
          hint: data?.hint || data?.cluster_hint,
        });
        markStepPassed(2, false, data?.error);
      }
    } catch (err: any) {
      setValidationResult({ ok: false, message: err.message });
      markStepPassed(2, false, err.message);
    } finally {
      setIsValidating(false);
    }
  };

  const handleInputChange = (value: string) => {
    updateConfig({ applicationId: value });
    setValidationResult(null);
    // Always allow proceeding with application ID entered
    if (value.trim()) {
      markStepPassed(2, true);
    }
  };

  const ttnConsoleUrl = `https://${config.cluster}.cloud.thethings.network/console/applications`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <AppWindow className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Enter Application ID</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Copy the Application ID from your TTN Console. This is the unique identifier, not the display name.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="applicationId">Application ID</Label>
          <Input
            id="applicationId"
            placeholder="my-application-id"
            value={config.applicationId}
            onChange={(e) => handleInputChange(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Found in TTN Console → Applications → Your App → Application ID
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          asChild
        >
          <a href={ttnConsoleUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open TTN Console
          </a>
        </Button>

        {config.apiKey && config.applicationId && (
          <Button
            variant="secondary"
            onClick={validateApplication}
            disabled={isValidating || !config.applicationId}
            className="w-full"
          >
            {isValidating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : validationResult?.ok ? (
              <Check className="h-4 w-4 mr-2 text-green-500" />
            ) : validationResult ? (
              <X className="h-4 w-4 mr-2 text-destructive" />
            ) : null}
            Validate Application
          </Button>
        )}

        {validationResult && (
          <Alert variant={validationResult.ok ? 'default' : 'destructive'}>
            {validationResult.ok ? (
              <Check className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
            <AlertTitle>{validationResult.ok ? 'Valid' : 'Error'}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{validationResult.message}</p>
              {validationResult.hint && (
                <p className="text-xs bg-background/50 p-2 rounded">{validationResult.hint}</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {!config.apiKey && config.applicationId && (
          <Alert>
            <AlertDescription className="text-sm">
              Enter your API Key in the next step to validate this Application ID.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
