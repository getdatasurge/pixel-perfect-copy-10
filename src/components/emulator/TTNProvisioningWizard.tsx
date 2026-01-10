import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, WebhookConfig } from '@/lib/ttn-payload';
import StepConnectionCheck from './provisioning/StepConnectionCheck';
import StepDiscovery from './provisioning/StepDiscovery';
import StepStrategy from './provisioning/StepStrategy';
import StepExecution from './provisioning/StepExecution';
import StepResults from './provisioning/StepResults';
import StepCompletion from './provisioning/StepCompletion';

export interface ProvisionResult {
  dev_eui?: string;
  eui?: string; // For gateways
  name: string;
  ttn_device_id?: string;
  ttn_gateway_id?: string;
  status: 'created' | 'already_exists' | 'failed';
  error?: string;
  error_code?: string;
  retryable?: boolean;
  attempts?: number;
}

export interface ProvisioningSummary {
  created: number;
  already_exists: number;
  failed: number;
  total: number;
}

export type ProvisioningMode = 'devices' | 'gateways';

interface TTNProvisioningWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  webhookConfig: WebhookConfig;
  onComplete: (results?: ProvisionResult[]) => void;
  mode?: ProvisioningMode;
}

export type StepStatus = 'pending' | 'in_progress' | 'passed' | 'failed';

const STEPS = [
  { id: 1, title: 'Connection Check', description: 'Validate TTN configuration' },
  { id: 2, title: 'Discovery', description: 'Scan and check registration status' },
  { id: 3, title: 'Strategy', description: 'Review and confirm provisioning plan' },
  { id: 4, title: 'Execution', description: 'Register in TTN' },
  { id: 5, title: 'Results', description: 'Review registration results' },
  { id: 6, title: 'Complete', description: 'Provisioning finished' },
];

export default function TTNProvisioningWizard({
  open,
  onOpenChange,
  devices,
  gateways,
  webhookConfig,
  onComplete,
  mode = 'devices',
}: TTNProvisioningWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [stepStatus, setStepStatus] = useState<Record<number, StepStatus>>({
    1: 'pending',
    2: 'pending',
    3: 'pending',
    4: 'pending',
    5: 'pending',
    6: 'pending',
  });

  // Discovery state
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, 'registered' | 'not_registered' | 'checking' | 'error'>>({});
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [reprovisionMode, setReprovisionMode] = useState(false);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [provisionResults, setProvisionResults] = useState<ProvisionResult[]>([]);
  const [provisionSummary, setProvisionSummary] = useState<ProvisioningSummary>({
    created: 0,
    already_exists: 0,
    failed: 0,
    total: 0,
  });

  // Get TTN config and user context
  const ttnConfig = webhookConfig.ttnConfig;
  const orgId = webhookConfig.testOrgId;
  const selectedUserId = webhookConfig.selectedUserId;

  const isGatewayMode = mode === 'gateways';

  // Reset state when wizard opens
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setStepStatus({
        1: 'in_progress',
        2: 'pending',
        3: 'pending',
        4: 'pending',
        5: 'pending',
        6: 'pending',
      });
      setDeviceStatuses({});
      setSelectedDevices([]);
      setIsExecuting(false);
      setExecutionProgress(0);
      setProvisionResults([]);
      setProvisionSummary({ created: 0, already_exists: 0, failed: 0, total: 0 });
      setReprovisionMode(false);
    }
  }, [open]);

  const markStepPassed = (step: number) => {
    setStepStatus(prev => ({ ...prev, [step]: 'passed' }));
  };

  const markStepFailed = (step: number) => {
    setStepStatus(prev => ({ ...prev, [step]: 'failed' }));
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
    setStepStatus(prev => ({ ...prev, [step]: 'in_progress' }));
  };

  const goNext = () => {
    if (currentStep < 6) {
      markStepPassed(currentStep);
      goToStep(currentStep + 1);
    }
  };

  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return stepStatus[1] === 'passed';
      case 2:
        return selectedDevices.length > 0;
      case 3:
        return stepStatus[3] === 'passed';
      case 4:
        return !isExecuting && provisionResults.length > 0;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const handleClose = () => {
    if (isExecuting) {
      return; // Don't allow closing during execution
    }
    onOpenChange(false);
  };

  const handleComplete = () => {
    onComplete(provisionResults);
    onOpenChange(false);
  };

  const handleRetryFailed = (filter: 'all' | 'retryable' = 'all') => {
    const failedItems = provisionResults.filter(r => 
      r.status === 'failed' && (filter === 'all' || r.retryable)
    );
    
    if (isGatewayMode) {
      const failedEuis = failedItems.map(r => r.eui);
      const failedGatewayIds = gateways
        .filter(g => failedEuis.includes(g.eui))
        .map(g => g.id);
      setSelectedDevices(failedGatewayIds);
    } else {
      const failedDevEuis = failedItems.map(r => r.dev_eui);
      const failedDeviceIds = devices
        .filter(d => failedDevEuis.includes(d.devEui))
        .map(d => d.id);
      setSelectedDevices(failedDeviceIds);
    }
    
    // Keep successful results, only clear the ones we're retrying
    const retainedResults = provisionResults.filter(r => 
      r.status !== 'failed' || (filter === 'retryable' && !r.retryable)
    );
    setProvisionResults(retainedResults);
    
    // Update summary to reflect remaining
    const newSummary = {
      created: retainedResults.filter(r => r.status === 'created').length,
      already_exists: retainedResults.filter(r => r.status === 'already_exists').length,
      failed: retainedResults.filter(r => r.status === 'failed').length,
      total: isGatewayMode ? gateways.length : devices.length,
    };
    setProvisionSummary(newSummary);
    
    goToStep(4);
  };

  const progressPercent = ((currentStep - 1) / (STEPS.length - 1)) * 100;
  const entityLabel = isGatewayMode ? 'Gateways' : 'Devices';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Provision {entityLabel} to TTN</span>
            <span className="text-sm font-normal text-muted-foreground">
              Step {currentStep} of {STEPS.length}
            </span>
          </DialogTitle>
          <DialogDescription>
            {STEPS[currentStep - 1].description}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="space-y-2">
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            {STEPS.map((step) => (
              <span
                key={step.id}
                className={`${
                  step.id === currentStep
                    ? 'text-primary font-medium'
                    : stepStatus[step.id] === 'passed'
                    ? 'text-green-600'
                    : stepStatus[step.id] === 'failed'
                    ? 'text-destructive'
                    : ''
                }`}
              >
                {step.id}
              </span>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto py-4 min-h-[300px]">
          {currentStep === 1 && (
            <StepConnectionCheck
              ttnConfig={ttnConfig}
              orgId={orgId}
              selectedUserId={selectedUserId}
              mode={mode}
              onValidationComplete={(success) => {
                if (success) {
                  markStepPassed(1);
                } else {
                  markStepFailed(1);
                }
              }}
            />
          )}

          {currentStep === 2 && (
            <StepDiscovery
              devices={devices}
              gateways={gateways}
              ttnConfig={ttnConfig}
              deviceStatuses={deviceStatuses}
              setDeviceStatuses={setDeviceStatuses}
              selectedDevices={selectedDevices}
              setSelectedDevices={setSelectedDevices}
              mode={mode}
              reprovisionMode={reprovisionMode}
              setReprovisionMode={setReprovisionMode}
            />
          )}

          {currentStep === 3 && (
            <StepStrategy
              selectedDevices={devices.filter(d => selectedDevices.includes(d.id))}
              selectedGateways={gateways.filter(g => selectedDevices.includes(g.id))}
              ttnConfig={ttnConfig}
              onConfirm={() => markStepPassed(3)}
              stepStatus={stepStatus[3]}
              mode={mode}
              reprovisionMode={reprovisionMode}
              deviceStatuses={deviceStatuses}
            />
          )}

          {currentStep === 4 && (
            <StepExecution
              devices={devices.filter(d => selectedDevices.includes(d.id))}
              gateways={gateways.filter(g => selectedDevices.includes(g.id))}
              ttnConfig={ttnConfig}
              orgId={orgId}
              selectedUserId={selectedUserId}
              isExecuting={isExecuting}
              setIsExecuting={setIsExecuting}
              progress={executionProgress}
              setProgress={setExecutionProgress}
              results={provisionResults}
              setResults={setProvisionResults}
              setSummary={setProvisionSummary}
              mode={mode}
            />
          )}

          {currentStep === 5 && (
            <StepResults
              results={provisionResults}
              summary={provisionSummary}
              onRetryFailed={handleRetryFailed}
              mode={mode}
            />
          )}

          {currentStep === 6 && (
            <StepCompletion
              summary={provisionSummary}
              ttnConfig={ttnConfig}
              onComplete={handleComplete}
              mode={mode}
            />
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={currentStep === 1 || isExecuting}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <div className="flex gap-2">
            {currentStep < 6 ? (
              <Button
                onClick={goNext}
                disabled={!canProceed() || isExecuting}
              >
                {currentStep === 4 ? 'View Results' : 'Next'}
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleComplete}>
                Complete Setup
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
