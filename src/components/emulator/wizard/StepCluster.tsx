import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Globe, Info } from 'lucide-react';
import { WizardConfig, StepStatus } from '../TTNSetupWizard';

interface StepClusterProps {
  config: WizardConfig;
  updateConfig: (updates: Partial<WizardConfig>) => void;
  markStepPassed: (step: number, passed: boolean, error?: string) => void;
  stepStatus?: StepStatus;
}

const CLUSTERS = [
  {
    value: 'nam1',
    label: 'North America (nam1)',
    description: 'United States, Canada, Mexico',
    baseUrl: 'https://nam1.cloud.thethings.network',
  },
  {
    value: 'eu1',
    label: 'Europe (eu1)',
    description: 'European Union countries',
    baseUrl: 'https://eu1.cloud.thethings.network',
  },
];

export default function StepCluster({
  config,
  updateConfig,
  markStepPassed,
}: StepClusterProps) {
  const selectedCluster = CLUSTERS.find(c => c.value === config.cluster);

  const handleSelect = (value: string) => {
    updateConfig({ cluster: value });
    markStepPassed(1, true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">Choose TTN Cluster</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Select the region where your TTN application exists. This must match exactly.
        </p>
      </div>

      <RadioGroup
        value={config.cluster}
        onValueChange={handleSelect}
        className="grid gap-4"
      >
        {CLUSTERS.map((cluster) => (
          <div key={cluster.value} className="relative">
            <RadioGroupItem
              value={cluster.value}
              id={cluster.value}
              className="peer sr-only"
            />
            <Label
              htmlFor={cluster.value}
              className="flex flex-col p-4 border rounded-lg cursor-pointer hover:bg-accent peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
            >
              <span className="font-medium">{cluster.label}</span>
              <span className="text-sm text-muted-foreground">{cluster.description}</span>
              <code className="text-xs text-muted-foreground mt-1">{cluster.baseUrl}</code>
            </Label>
          </div>
        ))}
      </RadioGroup>

      {selectedCluster && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            API calls will use: <code className="bg-muted px-1 rounded">{selectedCluster.baseUrl}</code>
          </AlertDescription>
        </Alert>
      )}

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-700">
          <strong>Important:</strong> If your application is in a different region than selected,
          all API calls will fail with "Application not found".
        </p>
      </div>
    </div>
  );
}
