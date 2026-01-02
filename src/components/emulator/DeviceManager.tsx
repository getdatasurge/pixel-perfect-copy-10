import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Thermometer, DoorOpen, Plus, Trash2, Copy, Check, QrCode, RefreshCw, Radio, Cloud, Loader2, Lock, Unlock, MapPin, Box } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, WebhookConfig, createDevice, generateEUI, generateAppKey } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import UnitSelect from './UnitSelect';
import { OrgStateUnit } from '@/lib/frostguardOrgSync';

interface DeviceManagerProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  onDevicesChange: (devices: LoRaWANDevice[]) => void;
  onShowQR: (device: LoRaWANDevice) => void;
  disabled?: boolean;
  webhookConfig?: WebhookConfig;
  ttnConfigured?: boolean;
  ttnProvisionedDevices?: Set<string>;
  onProvisionToTTN?: () => void;
  // Unit/Site assignment props
  availableUnits?: OrgStateUnit[];
  availableSites?: Array<{ site_id: string; site_name: string | null }>;
  onAssignUnit?: (deviceId: string, unitId: string | undefined, siteId: string | undefined) => Promise<void>;
  onCreateUnit?: () => void;
}

export default function DeviceManager({ 
  devices, 
  gateways, 
  onDevicesChange, 
  onShowQR,
  disabled,
  webhookConfig,
  ttnConfigured,
  ttnProvisionedDevices,
  onProvisionToTTN,
  availableUnits,
  availableSites,
  onAssignUnit,
  onCreateUnit,
}: DeviceManagerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [ttnRegistering, setTtnRegistering] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const canSync = !!webhookConfig?.testOrgId;

  // Helper to get site name from site_id
  const getSiteName = (siteId: string | undefined): string | null => {
    if (!siteId || !availableSites) return null;
    const site = availableSites.find(s => s.site_id === siteId);
    return site?.site_name || null;
  };

  // Helper to get unit name from unit_id
  const getUnitName = (unitId: string | undefined): string | null => {
    if (!unitId || !availableUnits) return null;
    const unit = availableUnits.find(u => u.id === unitId);
    return unit?.name || null;
  };

  // Get location badge for device
  const getLocationBadge = (device: LoRaWANDevice) => {
    if (!device.unitId && !device.siteId) {
      return (
        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600">
          Unassigned
        </Badge>
      );
    }
    if (device.unitId) {
      return (
        <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
          <Box className="h-2 w-2" />
          Assigned
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs text-blue-600 border-blue-600">
        Site Only
      </Badge>
    );
  };

  // Handle unit assignment change
  const handleUnitChange = async (
    deviceId: string, 
    unitId: string | undefined, 
    unit?: OrgStateUnit
  ) => {
    // Determine site_id from selected unit or keep existing
    const device = devices.find(d => d.id === deviceId);
    const siteId = unit?.site_id || device?.siteId;
    
    // Update local state immediately for responsiveness
    updateDevice(deviceId, { 
      unitId, 
      siteId,
    });
    
    // Sync to FrostGuard if callback provided
    if (onAssignUnit) {
      setAssigningId(deviceId);
      try {
        await onAssignUnit(deviceId, unitId, siteId);
        toast({ title: 'Unit Assigned', description: 'Device location updated successfully' });
      } catch (err) {
        // Revert local state on error
        updateDevice(deviceId, { 
          unitId: device?.unitId,
          siteId: device?.siteId,
        });
        toast({ 
          title: 'Assignment Failed', 
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive' 
        });
      } finally {
        setAssigningId(null);
      }
    }
  };


  const addDevice = (type: 'temperature' | 'door') => {
    const defaultGateway = gateways[0]?.id || '';
    const count = devices.filter(d => d.type === type).length + 1;
    const name = type === 'temperature' ? `Temp Sensor ${count}` : `Door Sensor ${count}`;
    const newDevice = {
      ...createDevice(name, type, defaultGateway),
      credentialSource: 'local_generated' as const,
      credentialsLockedFromFrostguard: false,
    };
    onDevicesChange([...devices, newDevice]);
    toast({ title: 'Device added', description: `Created ${name}` });
  };

  const removeDevice = (id: string) => {
    onDevicesChange(devices.filter(d => d.id !== id));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateDevice = (id: string, updates: Partial<LoRaWANDevice>) => {
    onDevicesChange(devices.map(d => (d.id === id ? { ...d, ...updates } : d)));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const regenerateCredentials = (id: string) => {
    updateDevice(id, {
      devEui: generateEUI(),
      joinEui: generateEUI(),
      appKey: generateAppKey(),
      credentialSource: 'manual_override',
      credentialsLockedFromFrostguard: false,
    });
    toast({ title: 'Regenerated', description: 'New credentials generated' });
  };

  const unlockCredentials = (id: string) => {
    updateDevice(id, {
      credentialsLockedFromFrostguard: false,
      credentialSource: 'manual_override',
    });
    toast({ title: 'Credentials Unlocked', description: 'You can now edit the credentials' });
  };

  const getCredentialSourceBadge = (device: LoRaWANDevice) => {
    if (!device.joinEui && !device.appKey) {
      return (
        <Badge variant="destructive" className="text-xs gap-1">
          Missing
        </Badge>
      );
    }
    
    switch (device.credentialSource) {
      case 'frostguard_pull':
        return (
          <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
            <Lock className="h-2 w-2" />
            FrostGuard
          </Badge>
        );
      case 'frostguard_generated':
        return (
          <Badge variant="outline" className="text-xs text-blue-600 border-blue-600 gap-1">
            <Lock className="h-2 w-2" />
            Generated
          </Badge>
        );
      case 'local_generated':
        return (
          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600">
            Local
          </Badge>
        );
      case 'manual_override':
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Override
          </Badge>
        );
      default:
        return null;
    }
  };

  const copyField = async (value: string, fieldId: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const registerInTTN = async (device: LoRaWANDevice) => {
    const ttnConfig = webhookConfig?.ttnConfig;
    if (!ttnConfig?.applicationId) {
      toast({ title: 'Configure TTN', description: 'Set TTN Application ID in Webhook tab first', variant: 'destructive' });
      return;
    }

    setTtnRegistering(device.id);
    try {
      const { data, error } = await supabase.functions.invoke('ttn-register-device', {
        body: {
          applicationId: ttnConfig.applicationId,
          cluster: ttnConfig.cluster,
          devEui: device.devEui,
          joinEui: device.joinEui,
          appKey: device.appKey,
          deviceName: device.name,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Registration failed');

      toast({ title: 'Registered in TTN', description: `Device ${device.name} registered` });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast({ title: 'TTN Registration Failed', description: errorMessage, variant: 'destructive' });
    } finally {
      setTtnRegistering(null);
    }
  };

  const syncDevice = async (device: LoRaWANDevice) => {
    if (!webhookConfig?.testOrgId) {
      toast({ 
        title: 'Configure Test Context', 
        description: 'Set Organization ID in the Testing tab first', 
        variant: 'destructive' 
      });
      return;
    }

    setSyncingId(device.id);
    try {
      const { data, error } = await supabase.functions.invoke('sync-to-frostguard', {
        body: {
          metadata: {
            sync_run_id: crypto.randomUUID(),
            initiated_at: new Date().toISOString(),
            source_project: 'pixel-perfect-copy-10',
          },
          context: {
            org_id: webhookConfig.testOrgId,
            site_id: webhookConfig.testSiteId,
            unit_id_override: webhookConfig.testUnitId,
          },
          entities: {
            gateways: [],
            devices: [{
              id: device.id,
              name: device.name,
              dev_eui: device.devEui,
              join_eui: device.joinEui,
              app_key: device.appKey,
              type: device.type,
              gateway_id: device.gatewayId,
            }],
          },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.results?.sensors?.errors?.[0] || 'Sync failed');

      setSyncedIds(prev => new Set(prev).add(device.id));
      toast({ title: 'Sensor Synced', description: `${device.name} synced` });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast({ title: 'Sync Failed', description: errorMessage, variant: 'destructive' });
    } finally {
      setSyncingId(null);
    }
  };

  const CopyButton = ({ value, fieldId }: { value: string; fieldId: string }) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => copyField(value, fieldId)}
    >
      {copiedField === fieldId ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );

  const SyncButton = ({ device }: { device: LoRaWANDevice }) => {
    const isSyncing = syncingId === device.id;
    const isSynced = syncedIds.has(device.id);

    if (!canSync) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="ghost" size="icon" disabled className="h-8 w-8">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Set Organization ID in Testing tab to sync</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => syncDevice(device)}
        disabled={disabled || isSyncing}
        title="Sync to Dashboard"
      >
        {isSyncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isSynced ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Cloud className="h-4 w-4 text-primary" />
        )}
      </Button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Devices</h3>
          <p className="text-sm text-muted-foreground">
            LoRaWAN devices with OTAA credentials
          </p>
        </div>
        <div className="flex gap-2">
          {/* Provision All to TTN Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={onProvisionToTTN}
                    disabled={!ttnConfigured || devices.length === 0 || disabled}
                    size="sm"
                    className="gap-1"
                  >
                    <Radio className="h-4 w-4" />
                    Provision All to TTN
                  </Button>
                </span>
              </TooltipTrigger>
              {(!ttnConfigured || devices.length === 0) && (
                <TooltipContent>
                  <p>
                    {devices.length === 0 
                      ? 'Add devices first' 
                      : 'Configure TTN on Webhook tab and pass Test Connection first'}
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          <Button 
            onClick={() => addDevice('temperature')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Temp
          </Button>
          <Button 
            onClick={() => addDevice('door')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Door
          </Button>
        </div>
      </div>

      {gateways.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Add a gateway first before creating devices
          </CardContent>
        </Card>
      )}

      {devices.length === 0 && gateways.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex gap-4 mb-4">
              <div className="p-3 rounded-full bg-blue-500/10">
                <Thermometer className="h-6 w-6 text-blue-500" />
              </div>
              <div className="p-3 rounded-full bg-orange-500/10">
                <DoorOpen className="h-6 w-6 text-orange-500" />
              </div>
            </div>
            <p className="font-medium">No devices configured</p>
            <p className="text-sm text-muted-foreground">Add temperature or door sensors</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {devices.map(device => (
          <Card key={device.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-md ${device.type === 'temperature' ? 'bg-blue-500/10' : 'bg-orange-500/10'}`}>
                    {device.type === 'temperature' ? (
                      <Thermometer className="h-4 w-4 text-blue-500" />
                    ) : (
                      <DoorOpen className="h-4 w-4 text-orange-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{device.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {device.type === 'temperature' ? 'Temperature' : 'Door'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">Class A</Badge>
                      {ttnProvisionedDevices?.has(device.devEui) && (
                        <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
                          <Radio className="h-3 w-3" />
                          TTN
                        </Badge>
                      )}
                      {syncedIds.has(device.id) && (
                        <Badge variant="outline" className="text-xs text-blue-600 border-blue-600">
                          Synced
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onShowQR(device)}
                    title="Show QR Code"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                  {webhookConfig?.ttnConfig?.applicationId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => registerInTTN(device)}
                      disabled={disabled || ttnRegistering === device.id}
                      title="Register in TTN"
                    >
                      {ttnRegistering === device.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Radio className="h-4 w-4 text-blue-500" />
                      )}
                    </Button>
                  )}
                  <SyncButton device={device} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => regenerateCredentials(device.id)}
                    disabled={disabled}
                    title="Regenerate credentials"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeDevice(device.id)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Row 1: Name + Gateway */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Device Name</Label>
                  <Input
                    value={device.name}
                    onChange={e => updateDevice(device.id, { name: e.target.value })}
                    disabled={disabled}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Gateway</Label>
                  <Select
                    value={device.gatewayId}
                    onValueChange={gatewayId => updateDevice(device.id, { gatewayId })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select gateway" />
                    </SelectTrigger>
                    <SelectContent>
                      {gateways.map(gw => (
                        <SelectItem key={gw.id} value={gw.id}>
                          {gw.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 1.5: Location - Store/Site + Unit */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium">Location</Label>
                  {getLocationBadge(device)}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Store/Site Display */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Store / Site</Label>
                    <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm truncate">
                        {getSiteName(device.siteId) || device.siteId?.slice(0, 8) || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Unit Dropdown */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Unit</Label>
                    <UnitSelect
                      units={availableUnits || []}
                      siteId={device.siteId}
                      selectedUnitId={device.unitId}
                      onSelect={(unitId, unit) => handleUnitChange(device.id, unitId, unit)}
                      onCreate={onCreateUnit || (() => {})}
                      disabled={disabled || assigningId === device.id}
                    />
                  </div>
                </div>
              </div>


              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">DevEUI</Label>
                <div className="flex gap-2">
                  <Input
                    value={device.devEui}
                    onChange={e => updateDevice(device.id, { devEui: e.target.value.toUpperCase() })}
                    disabled={disabled}
                    className="font-mono text-sm h-9"
                    maxLength={16}
                  />
                  <CopyButton value={device.devEui} fieldId={`${device.id}-deveui`} />
                </div>
                <p className="text-xs text-muted-foreground">16 hex characters</p>
              </div>

              {/* Row 2.5: TTN Device ID (read-only, canonical format) */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">TTN Device ID</Label>
                <div className="flex gap-2">
                  <Input
                    value={`sensor-${device.devEui.replace(/[:\s-]/g, '').toLowerCase()}`}
                    readOnly
                    className="font-mono text-sm h-9 bg-muted"
                  />
                  <CopyButton 
                    value={`sensor-${device.devEui.replace(/[:\s-]/g, '').toLowerCase()}`} 
                    fieldId={`${device.id}-ttndeviceid`} 
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Use this exact ID when registering in TTN Console
                </p>
              </div>

              {/* Row 3: JoinEUI + AppKey with credential source */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium">OTAA Credentials</Label>
                  {getCredentialSourceBadge(device)}
                  {device.credentialsLockedFromFrostguard && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => unlockCredentials(device.id)}
                          >
                            <Unlock className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Unlock to edit credentials (will lose FrostGuard sync)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">JoinEUI (AppEUI)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={device.joinEui}
                        onChange={e => updateDevice(device.id, { 
                          joinEui: e.target.value.toUpperCase(),
                          credentialSource: 'manual_override',
                          credentialsLockedFromFrostguard: false,
                        })}
                        disabled={disabled || device.credentialsLockedFromFrostguard}
                        readOnly={device.credentialsLockedFromFrostguard}
                        className={cn(
                          "font-mono text-xs h-9",
                          device.credentialsLockedFromFrostguard && "bg-muted cursor-not-allowed"
                        )}
                        maxLength={16}
                        placeholder={!device.joinEui ? "Missing" : undefined}
                      />
                      <CopyButton value={device.joinEui} fieldId={`${device.id}-joineui`} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">AppKey</Label>
                    <div className="flex gap-2">
                      <Input
                        value={device.appKey}
                        onChange={e => updateDevice(device.id, { 
                          appKey: e.target.value.toUpperCase(),
                          credentialSource: 'manual_override',
                          credentialsLockedFromFrostguard: false,
                        })}
                        disabled={disabled || device.credentialsLockedFromFrostguard}
                        readOnly={device.credentialsLockedFromFrostguard}
                        className={cn(
                          "font-mono text-xs h-9",
                          device.credentialsLockedFromFrostguard && "bg-muted cursor-not-allowed"
                        )}
                        maxLength={32}
                        placeholder={!device.appKey ? "Missing" : undefined}
                      />
                      <CopyButton value={device.appKey} fieldId={`${device.id}-appkey`} />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
