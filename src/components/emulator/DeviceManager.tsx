import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Thermometer, DoorOpen, Plus, Trash2, Copy, Check, QrCode, RefreshCw, Radio, Cloud, Loader2 } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, WebhookConfig, createDevice, generateEUI, generateAppKey } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface DeviceManagerProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  onDevicesChange: (devices: LoRaWANDevice[]) => void;
  onShowQR: (device: LoRaWANDevice) => void;
  disabled?: boolean;
  webhookConfig?: WebhookConfig;
}

export default function DeviceManager({ 
  devices, 
  gateways, 
  onDevicesChange, 
  onShowQR,
  disabled,
  webhookConfig
}: DeviceManagerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [ttnRegistering, setTtnRegistering] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());

  const canSync = !!webhookConfig?.testOrgId;

  const addDevice = (type: 'temperature' | 'door') => {
    const defaultGateway = gateways[0]?.id || '';
    const count = devices.filter(d => d.type === type).length + 1;
    const name = type === 'temperature' ? `Temp Sensor ${count}` : `Door Sensor ${count}`;
    const newDevice = createDevice(name, type, defaultGateway);
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
    // Mark as unsynced when changed
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
    });
    toast({ title: 'Regenerated', description: 'New device credentials generated' });
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

      toast({ title: 'Registered in TTN', description: `Device ${device.name} registered successfully` });
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
      toast({ title: 'Sensor Synced', description: `${device.name} synced to dashboard` });
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
      className="h-8 w-8"
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
                <Button variant="ghost" size="icon" disabled>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
      <div>
        <h3 className="text-lg font-medium">Devices</h3>
        <p className="text-sm text-muted-foreground">
          LoRaWAN devices with DevEUI/JoinEUI/AppKey credentials (persisted across sessions)
        </p>
      </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => addDevice('temperature')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="flex items-center gap-1"
          >
            <Thermometer className="h-4 w-4" />
            Add Temp
          </Button>
          <Button 
            onClick={() => addDevice('door')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="flex items-center gap-1"
          >
            <DoorOpen className="h-4 w-4" />
            Add Door
          </Button>
        </div>
      </div>

      {gateways.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            Add a gateway first before creating devices
          </CardContent>
        </Card>
      )}

      {devices.length === 0 && gateways.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex gap-4 mb-4">
              <Thermometer className="h-12 w-12 text-muted-foreground" />
              <DoorOpen className="h-12 w-12 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No devices configured</p>
            <p className="text-sm text-muted-foreground">Add temperature or door sensors</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {devices.map(device => (
          <Card key={device.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {device.type === 'temperature' ? (
                    <Thermometer className="h-4 w-4 text-blue-500" />
                  ) : (
                    <DoorOpen className="h-4 w-4 text-orange-500" />
                  )}
                  <CardTitle className="text-base">{device.name}</CardTitle>
                  <Badge variant="outline">
                    {device.type === 'temperature' ? 'Temperature' : 'Door'}
                  </Badge>
                  {syncedIds.has(device.id) && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      Synced
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onShowQR(device)}
                    title="Show QR Code"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                  {webhookConfig?.ttnConfig?.applicationId && (
                    <Button
                      variant="ghost"
                      size="icon"
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
                    onClick={() => regenerateCredentials(device.id)}
                    disabled={disabled}
                    title="Regenerate credentials"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDevice(device.id)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Device Name</Label>
                  <Input
                    value={device.name}
                    onChange={e => updateDevice(device.id, { name: e.target.value })}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gateway</Label>
                  <Select
                    value={device.gatewayId}
                    onValueChange={gatewayId => updateDevice(device.id, { gatewayId })}
                    disabled={disabled}
                  >
                    <SelectTrigger>
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

              <div className="space-y-2">
                <Label>DevEUI</Label>
                <div className="flex gap-2">
                  <Input
                    value={device.devEui}
                    onChange={e => updateDevice(device.id, { devEui: e.target.value.toUpperCase() })}
                    disabled={disabled}
                    className="font-mono text-sm"
                    maxLength={16}
                  />
                  <CopyButton value={device.devEui} fieldId={`${device.id}-deveui`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>JoinEUI (AppEUI)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={device.joinEui}
                      onChange={e => updateDevice(device.id, { joinEui: e.target.value.toUpperCase() })}
                      disabled={disabled}
                      className="font-mono text-xs"
                      maxLength={16}
                    />
                    <CopyButton value={device.joinEui} fieldId={`${device.id}-joineui`} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>AppKey</Label>
                  <div className="flex gap-2">
                    <Input
                      value={device.appKey}
                      onChange={e => updateDevice(device.id, { appKey: e.target.value.toUpperCase() })}
                      disabled={disabled}
                      className="font-mono text-xs"
                      maxLength={32}
                    />
                    <CopyButton value={device.appKey} fieldId={`${device.id}-appkey`} />
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
