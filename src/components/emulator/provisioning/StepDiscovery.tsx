import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, CheckCircle2, AlertCircle, Clock, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LoRaWANDevice, GatewayConfig, TTNConfig, generateTTNDeviceId, generateTTNGatewayId } from '@/lib/ttn-payload';
import { ProvisioningMode } from '../TTNProvisioningWizard';

interface StepDiscoveryProps {
  devices: LoRaWANDevice[];
  gateways?: GatewayConfig[];
  ttnConfig?: TTNConfig;
  deviceStatuses: Record<string, 'registered' | 'not_registered' | 'checking' | 'error'>;
  setDeviceStatuses: React.Dispatch<React.SetStateAction<Record<string, 'registered' | 'not_registered' | 'checking' | 'error'>>>;
  selectedDevices: string[];
  setSelectedDevices: React.Dispatch<React.SetStateAction<string[]>>;
  mode?: ProvisioningMode;
  reprovisionMode?: boolean;
  setReprovisionMode?: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function StepDiscovery({
  devices,
  gateways = [],
  ttnConfig,
  deviceStatuses,
  setDeviceStatuses,
  selectedDevices,
  setSelectedDevices,
  mode = 'devices',
  reprovisionMode = false,
  setReprovisionMode,
}: StepDiscoveryProps) {
  const [isChecking, setIsChecking] = useState(false);
  const isGatewayMode = mode === 'gateways';
  const items = isGatewayMode ? gateways : devices;

  const checkDeviceStatus = async (device: LoRaWANDevice): Promise<'registered' | 'not_registered' | 'error'> => {
    try {
      const ttnDeviceId = generateTTNDeviceId(device.devEui);
      
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_device',
          cluster: ttnConfig?.cluster,
          application_id: ttnConfig?.applicationId,
          device_id: ttnDeviceId,
        },
      });

      if (error) {
        console.error('Device check error:', error);
        return 'error';
      }

      return data?.exists ? 'registered' : 'not_registered';
    } catch (err) {
      console.error('Device check failed:', err);
      return 'error';
    }
  };

  const checkGatewayStatus = async (gateway: GatewayConfig): Promise<'registered' | 'not_registered' | 'error'> => {
    try {
      const ttnGatewayId = generateTTNGatewayId(gateway.eui);
      
      const { data, error } = await supabase.functions.invoke('manage-ttn-settings', {
        body: {
          action: 'check_gateway',
          cluster: ttnConfig?.cluster,
          gateway_id: ttnGatewayId,
        },
      });

      if (error) {
        console.error('Gateway check error:', error);
        return 'error';
      }

      return data?.exists ? 'registered' : 'not_registered';
    } catch (err) {
      console.error('Gateway check failed:', err);
      return 'error';
    }
  };

  const checkAllItems = async () => {
    setIsChecking(true);
    
    // Mark all as checking
    const checkingStatuses: Record<string, 'checking'> = {};
    items.forEach(item => {
      checkingStatuses[item.id] = 'checking';
    });
    setDeviceStatuses(checkingStatuses);

    // Check each item
    const newStatuses: Record<string, 'registered' | 'not_registered' | 'error'> = {};
    const newSelected: string[] = [];

    for (const item of items) {
      const status = isGatewayMode 
        ? await checkGatewayStatus(item as GatewayConfig)
        : await checkDeviceStatus(item as LoRaWANDevice);
      
      newStatuses[item.id] = status;
      
      // Auto-select unregistered items
      if (status === 'not_registered') {
        newSelected.push(item.id);
      }
    }

    setDeviceStatuses(newStatuses);
    setSelectedDevices(newSelected);
    setIsChecking(false);
  };

  useEffect(() => {
    if (Object.keys(deviceStatuses).length === 0 && items.length > 0) {
      checkAllItems();
    }
  }, []);

  const toggleItem = (itemId: string) => {
    setSelectedDevices(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const selectAllUnregistered = () => {
    const unregistered = items
      .filter(item => deviceStatuses[item.id] === 'not_registered')
      .map(item => item.id);
    setSelectedDevices(unregistered);
  };

  const selectNone = () => {
    setSelectedDevices([]);
  };

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'registered':
        return (
          <Badge variant="outline" className="text-green-600 border-green-600/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Registered
          </Badge>
        );
      case 'not_registered':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-600/30 gap-1">
            <Clock className="h-3 w-3" />
            Not Registered
          </Badge>
        );
      case 'checking':
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking...
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Error
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const unregisteredCount = items.filter(item => deviceStatuses[item.id] === 'not_registered').length;
  const registeredCount = items.filter(item => deviceStatuses[item.id] === 'registered').length;
  const entityLabel = isGatewayMode ? 'Gateway' : 'Device';
  const entityLabelPlural = isGatewayMode ? 'gateways' : 'devices';

  // Determine if an item can be selected based on reprovision mode
  const canSelectItem = (status: string | undefined) => {
    if (reprovisionMode) {
      // In reprovision mode, can select both registered and unregistered
      return status !== 'checking';
    }
    // Normal mode: only unregistered items
    return status === 'not_registered';
  };

  return (
    <div className="space-y-4">
      {/* Re-provision mode toggle */}
      {setReprovisionMode && (
        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label htmlFor="reprovision-mode" className="text-sm font-medium cursor-pointer">
                Re-provision Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                Allow selecting already-registered {entityLabelPlural} to update their TTN configuration
              </p>
            </div>
          </div>
          <Switch
            id="reprovision-mode"
            checked={reprovisionMode}
            onCheckedChange={setReprovisionMode}
            disabled={isChecking}
          />
        </div>
      )}

      {/* Summary and actions */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{entityLabel} Status</p>
          <p className="text-xs text-muted-foreground">
            {registeredCount} registered, {unregisteredCount} not registered, {selectedDevices.length} selected
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAllUnregistered}
            disabled={isChecking}
          >
            Select Unregistered
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={selectNone}
            disabled={isChecking}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={checkAllItems}
            disabled={isChecking}
          >
            {isChecking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Items table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{entityLabel}</TableHead>
              {!isGatewayMode && <TableHead>Type</TableHead>}
              <TableHead>TTN {entityLabel} ID</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isGatewayMode ? (
              // Gateway rows
              gateways.map(gateway => {
                const status = deviceStatuses[gateway.id];
                const isSelected = selectedDevices.includes(gateway.id);
                const isDisabled = !canSelectItem(status);
                let ttnGatewayId: string;
                try {
                  ttnGatewayId = generateTTNGatewayId(gateway.eui);
                } catch {
                  ttnGatewayId = 'Invalid EUI';
                }

                return (
                  <TableRow key={gateway.id} className={isDisabled ? 'opacity-60' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItem(gateway.id)}
                        disabled={isDisabled}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{gateway.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {gateway.eui.substring(0, 8)}...
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {ttnGatewayId}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      {getStatusBadge(status)}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              // Device rows
              devices.map(device => {
                const status = deviceStatuses[device.id];
                const isSelected = selectedDevices.includes(device.id);
                const isDisabled = !canSelectItem(status);
                let ttnDeviceId: string;
                try {
                  ttnDeviceId = generateTTNDeviceId(device.devEui);
                } catch {
                  ttnDeviceId = 'Invalid DevEUI';
                }

                return (
                  <TableRow key={device.id} className={isDisabled ? 'opacity-60' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItem(device.id)}
                        disabled={isDisabled}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{device.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {device.devEui.substring(0, 8)}...
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {device.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {ttnDeviceId}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      {getStatusBadge(status)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={isGatewayMode ? 4 : 5} className="text-center py-8 text-muted-foreground">
                  No {entityLabelPlural} configured. Add {entityLabelPlural} in the {isGatewayMode ? 'Gateways' : 'Devices'} tab first.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selectedDevices.length === 0 && items.length > 0 && (
        <p className="text-sm text-amber-600 text-center">
          Select at least one {entityLabel.toLowerCase()} to provision
        </p>
      )}
    </div>
  );
}
