import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Info, Radio, CheckCircle2, RefreshCw, PlusCircle, MinusCircle } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId, validateGatewayEui } from '@/lib/ttn-payload';
import { StepStatus, ProvisioningMode } from '../TTNProvisioningWizard';

interface StepStrategyProps {
  selectedDevices: LoRaWANDevice[];
  selectedGateways?: GatewayConfig[];
  ttnConfig?: TTNConfig;
  onConfirm: () => void;
  stepStatus: StepStatus;
  mode?: ProvisioningMode;
  reprovisionMode?: boolean;
  deviceStatuses?: Record<string, 'registered' | 'not_registered' | 'checking' | 'error'>;
}

type PlannedAction = 'create' | 'update' | 'skip' | 'blocked';

interface PreviewItem {
  id: string;
  name: string;
  eui: string;
  ttnId: string;
  action: PlannedAction;
  reason?: string;
}

export default function StepStrategy({
  selectedDevices,
  selectedGateways = [],
  ttnConfig,
  onConfirm,
  stepStatus,
  mode = 'devices',
  reprovisionMode = false,
  deviceStatuses = {},
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

  // Build preview items with planned actions
  const previewItems: PreviewItem[] = isGatewayMode
    ? selectedGateways.map(gateway => {
        const validation = validateGatewayEui(gateway.eui);
        let ttnGatewayId = 'invalid';
        try {
          ttnGatewayId = generateTTNGatewayId(gateway.eui);
        } catch {}
        
        const isRegistered = deviceStatuses[gateway.id] === 'registered';
        
        let action: PlannedAction;
        let reason: string | undefined;
        
        if (!validation.valid) {
          action = 'blocked';
          reason = validation.error;
        } else if (!gateway.name || gateway.name.trim().length === 0) {
          action = 'blocked';
          reason = 'Gateway name is required';
        } else if (isRegistered && reprovisionMode) {
          action = 'update';
          reason = 'Will verify and update TTN metadata';
        } else if (isRegistered) {
          action = 'skip';
          reason = 'Already registered in TTN';
        } else {
          action = 'create';
        }
        
        return { id: gateway.id, name: gateway.name, eui: gateway.eui, ttnId: ttnGatewayId, action, reason };
      })
    : selectedDevices.map(device => {
        let ttnDeviceId = 'invalid';
        try {
          ttnDeviceId = generateTTNDeviceId(device.devEui);
        } catch {}
        
        const isRegistered = deviceStatuses[device.id] === 'registered';
        
        let action: PlannedAction;
        let reason: string | undefined;
        
        if (isRegistered && reprovisionMode) {
          action = 'update';
        } else if (isRegistered) {
          action = 'skip';
          reason = 'Already registered in TTN';
        } else {
          action = 'create';
        }
        
        return { id: device.id, name: device.name, eui: device.devEui, ttnId: ttnDeviceId, action, reason };
      });

  const createCount = previewItems.filter(i => i.action === 'create').length;
  const updateCount = previewItems.filter(i => i.action === 'update').length;
  const skipCount = previewItems.filter(i => i.action === 'skip').length;
  const blockedCount = previewItems.filter(i => i.action === 'blocked').length;

  const handleConfirmChange = (checked: boolean) => {
    setConfirmed(checked);
    if (checked) {
      onConfirm();
    }
  };

  const getActionBadge = (action: PlannedAction) => {
    switch (action) {
      case 'create':
        return <Badge className="bg-green-600 gap-1"><PlusCircle className="h-3 w-3" />Create</Badge>;
      case 'update':
        return <Badge className="bg-blue-600 gap-1"><RefreshCw className="h-3 w-3" />Update</Badge>;
      case 'skip':
        return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Skip</Badge>;
      case 'blocked':
        return <Badge variant="destructive" className="gap-1"><MinusCircle className="h-3 w-3" />Blocked</Badge>;
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
              <p className="text-muted-foreground">{isGatewayMode ? 'Gateways' : 'Devices'} Selected</p>
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

          {/* Action summary */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Planned Actions</p>
            <div className="flex flex-wrap gap-2">
              {createCount > 0 && (
                <Badge className="bg-green-600">{createCount} to create</Badge>
              )}
              {updateCount > 0 && (
                <Badge className="bg-blue-600">{updateCount} to update</Badge>
              )}
              {skipCount > 0 && (
                <Badge variant="secondary">{skipCount} to skip</Badge>
              )}
              {blockedCount > 0 && (
                <Badge variant="destructive">{blockedCount} blocked</Badge>
              )}
            </div>
          </div>

          {/* Dry-run preview table */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Dry-Run Preview</p>
            <div className="border rounded-lg overflow-hidden max-h-[180px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{entityLabel}</TableHead>
                    <TableHead>TTN ID</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.eui.substring(0, 8)}...</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{item.ttnId}</code>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {getActionBadge(item.action)}
                          {item.reason && (
                            <span className="text-xs text-muted-foreground max-w-[150px] truncate" title={item.reason}>
                              {item.reason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                  {reprovisionMode && <li>• Mode: Re-provision (will update existing)</li>}
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
      {blockedCount > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {blockedCount} {entityLabel}(s) have validation errors and will be skipped. Fix them before provisioning.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <ul className="text-sm space-y-1 mt-1">
            <li>• {isGatewayMode ? 'Gateways' : 'Devices'} already registered in TTN will be {reprovisionMode ? 'updated' : 'skipped'}</li>
            {!isGatewayMode && <li>• AppKeys are sent securely server-side and never exposed in logs</li>}
            <li>• Registration is processed {isGatewayMode ? 'in batch' : 'sequentially'} to avoid TTN rate limits</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Alert variant="destructive" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700 dark:text-amber-400">
          <strong>Important:</strong> This action will {reprovisionMode ? 'register/update' : 'register'} {createCount + updateCount} {entityLabel}(s) 
          in your TTN {isGatewayMode ? 'account' : 'application'}.
        </AlertDescription>
      </Alert>

      {/* Confirmation checkbox */}
      <div className="flex items-center gap-3 p-4 border rounded-lg bg-card">
        <Checkbox
          id="confirm"
          checked={confirmed}
          onCheckedChange={(checked) => handleConfirmChange(checked === true)}
          disabled={blockedCount === items.length}
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
