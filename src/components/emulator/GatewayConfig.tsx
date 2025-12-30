import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Radio, Plus, Trash2, Copy, Check } from 'lucide-react';
import { GatewayConfig as GatewayConfigType, createGateway } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';

interface GatewayConfigProps {
  gateways: GatewayConfigType[];
  onGatewaysChange: (gateways: GatewayConfigType[]) => void;
  disabled?: boolean;
}

export default function GatewayConfig({ gateways, onGatewaysChange, disabled }: GatewayConfigProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const addGateway = () => {
    const newGateway = createGateway(`Gateway ${gateways.length + 1}`);
    onGatewaysChange([...gateways, newGateway]);
    toast({ title: 'Gateway added', description: `Created ${newGateway.name} with EUI ${newGateway.eui}` });
  };

  const removeGateway = (id: string) => {
    onGatewaysChange(gateways.filter(g => g.id !== id));
  };

  const updateGateway = (id: string, updates: Partial<GatewayConfigType>) => {
    onGatewaysChange(gateways.map(g => (g.id === id ? { ...g, ...updates } : g)));
  };

  const copyEui = async (eui: string, id: string) => {
    await navigator.clipboard.writeText(eui);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: 'Copied', description: 'Gateway EUI copied to clipboard' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Gateways</h3>
          <p className="text-sm text-muted-foreground">
            Emulated LoRaWAN gateways that receive sensor data
          </p>
        </div>
        <Button onClick={addGateway} disabled={disabled} size="sm" className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Gateway
        </Button>
      </div>

      {gateways.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No gateways configured</p>
            <p className="text-sm text-muted-foreground">Add a gateway to start emulating</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {gateways.map(gateway => (
            <Card key={gateway.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    <CardTitle className="text-base">{gateway.name}</CardTitle>
                    <Badge variant={gateway.isOnline ? 'default' : 'secondary'}>
                      {gateway.isOnline ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeGateway(gateway.id)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gateway Name</Label>
                    <Input
                      value={gateway.name}
                      onChange={e => updateGateway(gateway.id, { name: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Gateway EUI</Label>
                    <div className="flex gap-2">
                      <Input
                        value={gateway.eui}
                        onChange={e => updateGateway(gateway.id, { eui: e.target.value.toUpperCase() })}
                        disabled={disabled}
                        className="font-mono text-sm"
                        maxLength={16}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyEui(gateway.eui, gateway.id)}
                      >
                        {copiedId === gateway.id ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Online Status</Label>
                    <p className="text-xs text-muted-foreground">
                      Toggle to simulate gateway going offline
                    </p>
                  </div>
                  <Switch
                    checked={gateway.isOnline}
                    onCheckedChange={isOnline => updateGateway(gateway.id, { isOnline })}
                    disabled={disabled}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
