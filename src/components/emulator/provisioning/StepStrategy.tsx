import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Info, Radio } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId } from '@/lib/ttn-payload';
import { StepStatus, ProvisioningMode } from '../TTNProvisioningWizard';

interface StepStrategyProps {
  selectedDevices: LoRaWANDevice[];
  selectedGateways?: GatewayConfig[];
  ttnConfig?: TTNConfig;
  onConfirm: () => void;
  stepStatus: StepStatus;
  mode?: ProvisioningMode;
}

export default function StepStrategy({
  selectedDevices,
  selectedGateways = [],
  ttnConfig,
  onConfirm,
  stepStatus,
  mode = 'devices',
}: StepStrategyProps) {
  const [confirmed, setConfirmed] = useState(false);
  const isGatewayMode = mode === 'gateways';
  const items = isGatewayMode ? selectedGateways : selectedDevices;
  const entityLabel = isGatewayMode ? 'gateway' : 'device';
  const entityLabelPlural = isGatewayMode ? 'gateways' : 'devices';

  const getFrequencyPlan = () => {
    switch (ttnConfig?.cluster) {
      case 'nam1':
        return 'US_902_928_FSB_2';
      case 'au1':
        return 'AU_915_928_FSB_2';
      default:
        return 'EU_863_870_TTN';
    }
  };

  const handleConfirmChange = (checked: boolean) => {
    setConfirmed(checked);
    if (checked) {
      onConfirm();
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Provisioning Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{isGatewayMode ? 'Gateways' : 'Devices'} to Register</p>
              <p className="font-medium text-lg">{items.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{isGatewayMode ? 'Target Cluster' : 'Target Application'}</p>
              <p className="font-medium">{isGatewayMode ? ttnConfig?.cluster : ttnConfig?.applicationId}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Cluster</p>
              <p className="font-medium">{ttnConfig?.cluster}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Frequency Plan</p>
              <p className="font-medium text-xs">{getFrequencyPlan()}</p>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">{isGatewayMode ? 'Gateway' : 'Device'} ID Format</p>
            <div className="space-y-1">
              {isGatewayMode ? (
                // Gateway IDs
                selectedGateways.slice(0, 3).map(gateway => {
                  let ttnGatewayId: string;
                  try {
                    ttnGatewayId = generateTTNGatewayId(gateway.eui);
                  } catch {
                    ttnGatewayId = 'Invalid EUI';
                  }
                  return (
                    <div key={gateway.id} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{gateway.name}:</span>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                        {ttnGatewayId}
                      </code>
                    </div>
                  );
                })
              ) : (
                // Device IDs
                selectedDevices.slice(0, 3).map(device => {
                  let ttnDeviceId: string;
                  try {
                    ttnDeviceId = generateTTNDeviceId(device.devEui);
                  } catch {
                    ttnDeviceId = 'Invalid DevEUI';
                  }
                  return (
                    <div key={device.id} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{device.name}:</span>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                        {ttnDeviceId}
                      </code>
                    </div>
                  );
                })
              )}
              {items.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  ...and {items.length - 3} more {entityLabelPlural}
                </p>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Registration Details</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {isGatewayMode ? (
                <>
                  <li>• Gateway Server: {ttnConfig?.cluster}.cloud.thethings.network</li>
                  <li>• Frequency Plan: {getFrequencyPlan()}</li>
                  <li>• Status/Location: Private</li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">OTAA</Badge>
                    Over-The-Air Activation
                  </li>
                  <li>• LoRaWAN Version: 1.0.3</li>
                  <li>• PHY Version: 1.0.3-REV-A</li>
                  <li>• Supports Join: Yes</li>
                </>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <ul className="text-sm space-y-1 mt-1">
            <li>• {isGatewayMode ? 'Gateways' : 'Devices'} already registered in TTN will be skipped (treated as success)</li>
            {!isGatewayMode && <li>• AppKeys are sent securely server-side and never exposed in logs</li>}
            <li>• Registration is processed {isGatewayMode ? 'in batch' : 'sequentially'} to avoid TTN rate limits</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Alert variant="destructive" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700 dark:text-amber-400">
          <strong>Important:</strong> This action will register {items.length} {entityLabel}(s) 
          in your TTN {isGatewayMode ? 'account' : 'application'}. Existing TTN entities will not be overwritten.
        </AlertDescription>
      </Alert>

      {/* Confirmation checkbox */}
      <div className="flex items-center gap-3 p-4 border rounded-lg bg-card">
        <Checkbox
          id="confirm"
          checked={confirmed}
          onCheckedChange={(checked) => handleConfirmChange(checked === true)}
        />
        <label
          htmlFor="confirm"
          className="text-sm font-medium cursor-pointer select-none"
        >
          I understand and want to proceed with provisioning
        </label>
      </div>

      {stepStatus === 'passed' && (
        <p className="text-sm text-green-600 text-center">
          Ready to proceed. Click "Next" to start provisioning.
        </p>
      )}
    </div>
  );
}
