import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Thermometer, DoorOpen, Plus, Trash2, Copy, Check, QrCode, RefreshCw } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, createDevice, generateEUI, generateAppKey } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';

interface DeviceManagerProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  onDevicesChange: (devices: LoRaWANDevice[]) => void;
  onShowQR: (device: LoRaWANDevice) => void;
  disabled?: boolean;
}

export default function DeviceManager({ 
  devices, 
  gateways, 
  onDevicesChange, 
  onShowQR,
  disabled 
}: DeviceManagerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
  };

  const updateDevice = (id: string, updates: Partial<LoRaWANDevice>) => {
    onDevicesChange(devices.map(d => (d.id === id ? { ...d, ...updates } : d)));
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Devices</h3>
          <p className="text-sm text-muted-foreground">
            LoRaWAN devices with proper DevEUI/JoinEUI/AppKey credentials
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
