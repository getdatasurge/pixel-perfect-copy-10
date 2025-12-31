import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { LoRaWANDevice } from '@/lib/ttn-payload';
import StepCluster from './wizard/StepCluster';
import StepApplicationId from './wizard/StepApplicationId';
import StepApiKey from './wizard/StepApiKey';
import StepDeviceRegistration from './wizard/StepDeviceRegistration';
import StepWebhook from './wizard/StepWebhook';
import StepVerification from './wizard/StepVerification';

export interface WizardConfig {
  cluster: string;
  applicationId: string;
  apiKey: string;
  webhookSecret?: string;
}

export interface StepStatus {
  passed: boolean;
  error?: string;
}

interface TTNSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId?: string;
  devices: LoRaWANDevice[];
  onComplete: (config: WizardConfig) => void;
  initialConfig?: Partial<WizardConfig>;
}

const STEPS = [
  { id: 1, label: 'Cluster', description: 'Select TTN region' },
  { id: 2, label: 'Application', description: 'Enter Application ID' },
  { id: 3, label: 'API Key', description: 'Configure access' },
  { id: 4, label: 'Devices', description: 'Check registration' },
  { id: 5, label: 'Webhook', description: 'Configure URL' },
  { id: 6, label: 'Verify', description: 'Test connection' },
];

export default function TTNSetupWizard({
  open,
  onOpenChange,
  orgId,
  devices,
  onComplete,
  initialConfig,
}: TTNSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [config, setConfig] = useState<WizardConfig>({
    cluster: initialConfig?.cluster || 'nam1',
    applicationId: initialConfig?.applicationId || '',
    apiKey: initialConfig?.apiKey || '',
    webhookSecret: initialConfig?.webhookSecret,
  });
  
  const [stepStatuses, setStepStatuses] = useState<Record<number, StepStatus>>({});
  const [isValidating, setIsValidating] = useState(false);

  // Reset wizard when opened
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setStepStatuses({});
      if (initialConfig) {
        setConfig({
          cluster: initialConfig.cluster || 'nam1',
          applicationId: initialConfig.applicationId || '',
          apiKey: initialConfig.apiKey || '',
          webhookSecret: initialConfig.webhookSecret,
        });
      }
    }
  }, [open, initialConfig]);

  const updateConfig = (updates: Partial<WizardConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const markStepPassed = (step: number, passed: boolean, error?: string) => {
    setStepStatuses(prev => ({
      ...prev,
      [step]: { passed, error },
    }));
  };

  const canProceed = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!config.cluster;
      case 2:
        return !!config.applicationId;
      case 3:
        return !!config.apiKey && (stepStatuses[3]?.passed ?? false);
      case 4:
        return true; // Can skip device registration
      case 5:
        return stepStatuses[5]?.passed ?? false;
      case 6:
        return stepStatuses[6]?.passed ?? false;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    onComplete(config);
    onOpenChange(false);
  };

  const progress = (currentStep / 6) * 100;

  const renderStep = () => {
    const commonProps = {
      config,
      updateConfig,
      markStepPassed,
      stepStatus: stepStatuses[currentStep],
      isValidating,
      setIsValidating,
      orgId,
    };

    switch (currentStep) {
      case 1:
        return <StepCluster {...commonProps} />;
      case 2:
        return <StepApplicationId {...commonProps} />;
      case 3:
        return <StepApiKey {...commonProps} />;
      case 4:
        return <StepDeviceRegistration {...commonProps} devices={devices} />;
      case 5:
        return <StepWebhook {...commonProps} />;
      case 6:
        return <StepVerification {...commonProps} devices={devices} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            TTN Setup Wizard
            <Badge variant="outline" className="ml-2">
              Step {currentStep} of 6
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Configure The Things Network integration step by step
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between">
            {STEPS.map((step) => (
              <div
                key={step.id}
                className={`flex flex-col items-center text-center ${
                  step.id === currentStep
                    ? 'text-primary'
                    : step.id < currentStep || stepStatuses[step.id]?.passed
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/50'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium mb-1 ${
                    stepStatuses[step.id]?.passed
                      ? 'bg-green-500 text-white'
                      : stepStatuses[step.id]?.error
                      ? 'bg-destructive text-destructive-foreground'
                      : step.id === currentStep
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {stepStatuses[step.id]?.passed ? (
                    <Check className="h-3 w-3" />
                  ) : stepStatuses[step.id]?.error ? (
                    <X className="h-3 w-3" />
                  ) : (
                    step.id
                  )}
                </div>
                <span className="text-[10px] hidden sm:block">{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-[300px] py-4">
          {renderStep()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || isValidating}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isValidating}
            >
              Cancel
            </Button>

            {currentStep < 6 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed(currentStep) || isValidating}
              >
                {isValidating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : null}
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={!stepStatuses[6]?.passed || isValidating}
                className="bg-green-600 hover:bg-green-700"
              >
                <Check className="h-4 w-4 mr-1" />
                Complete Setup
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
