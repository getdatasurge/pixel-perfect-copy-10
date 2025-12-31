import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Radio, Plus, Trash2, Copy, Check, Cloud, Loader2, Pencil } from 'lucide-react';
import { GatewayConfig as GatewayConfigType, WebhookConfig, createGateway } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface GatewayConfigProps {
  gateways: GatewayConfigType[];
  onGatewaysChange: (gateways: GatewayConfigType[]) => void;
  disabled?: boolean;
  webhookConfig?: WebhookConfig;
  ttnConfigured?: boolean;
  onProvisionToTTN?: () => void;
}

export default function GatewayConfig({ gateways, onGatewaysChange, disabled, webhookConfig, ttnConfigured, onProvisionToTTN }: GatewayConfigProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const canSync = !!webhookConfig?.testOrgId;
  const primaryGateway = gateways[0];
  const secondaryGateways = gateways.slice(1);

  const addGateway = () => {
    const newGateway = createGateway(`Gateway ${gateways.length + 1}`);
    onGatewaysChange([...gateways, newGateway]);
    toast({ title: 'Gateway added', description: `Created ${newGateway.name}` });
  };

  const removeGateway = (id: string) => {
    onGatewaysChange(gateways.filter(g => g.id !== id));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateGateway = (id: string, updates: Partial<GatewayConfigType>) => {
    onGatewaysChange(gateways.map(g => (g.id === id ? { ...g, ...updates } : g)));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const copyEui = async (eui: string, id: string) => {
    await navigator.clipboard.writeText(eui);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: 'Copied', description: 'Gateway EUI copied' });
  };

  const syncGateway = async (gateway: GatewayConfigType) => {
    if (!webhookConfig?.testOrgId) {
      toast({ 
        title: 'Configure Test Context', 
        description: 'Set Organization ID in the Testing tab first', 
        variant: 'destructive' 
      });
      return;
    }

    setSyncingId(gateway.id);
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
          },
          entities: {
            gateways: [{
              id: gateway.id,
              name: gateway.name,
              eui: gateway.eui,
              is_online: gateway.isOnline,
            }],
            devices: [],
          },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.results?.gateways?.errors?.[0] || 'Sync failed');

      setSyncedIds(prev => new Set(prev).add(gateway.id));
      toast({ title: 'Gateway Synced', description: `${gateway.name} synced to dashboard` });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast({ title: 'Sync Failed', description: errorMessage, variant: 'destructive' });
    } finally {
      setSyncingId(null);
    }
  };

  const SyncButton = ({ gateway }: { gateway: GatewayConfigType }) => {
    const isSyncing = syncingId === gateway.id;
    const isSynced = syncedIds.has(gateway.id);

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
        onClick={() => syncGateway(gateway)}
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
          <h3 className="text-lg font-medium">Gateways</h3>
          <p className="text-sm text-muted-foreground">
            Emulated LoRaWAN gateways that receive sensor data
          </p>
        </div>
        <div className="flex gap-2">
          {/* Provision to TTN Button - Coming Soon */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    disabled={true}
                    size="sm"
                    variant="outline"
                    className="gap-1"
                  >
                    <Radio className="h-4 w-4" />
                    Provision to TTN
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Gateway registration in TTN coming soon</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button onClick={addGateway} disabled={disabled} size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            Add Gateway
          </Button>
        </div>
      </div>

      {gateways.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-3 rounded-full bg-muted mb-4">
              <Radio className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium">No gateways configured</p>
            <p className="text-sm text-muted-foreground">Add a gateway to start emulating</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Primary Gateway Card */}
          {primaryGateway && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Radio className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {editingId === primaryGateway.id ? (
                          <Input
                            value={primaryGateway.name}
                            onChange={e => updateGateway(primaryGateway.id, { name: e.target.value })}
                            onBlur={() => setEditingId(null)}
                            onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                            className="h-7 w-40"
                            autoFocus
                          />
                        ) : (
                          <>
                            {primaryGateway.name}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setEditingId(primaryGateway.id)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">Primary Gateway</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={primaryGateway.isOnline ? 'default' : 'secondary'}>
                      {primaryGateway.isOnline ? 'Online' : 'Offline'}
                    </Badge>
                    {syncedIds.has(primaryGateway.id) && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Synced
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Connection Status</Label>
                    <p className="text-xs text-muted-foreground">
                      Emulates a Semtech UDP Packet Forwarder gateway
                    </p>
                  </div>
                  <Switch
                    checked={primaryGateway.isOnline}
                    onCheckedChange={isOnline => updateGateway(primaryGateway.id, { isOnline })}
                    disabled={disabled}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm">Gateway EUI</Label>
                  <div className="flex gap-2">
                    <Input
                      value={primaryGateway.eui}
                      onChange={e => updateGateway(primaryGateway.id, { eui: e.target.value.toUpperCase() })}
                      disabled={disabled}
                      className="font-mono text-sm"
                      maxLength={16}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyEui(primaryGateway.eui, primaryGateway.id)}
                    >
                      {copiedId === primaryGateway.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <SyncButton gateway={primaryGateway} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Secondary Gateways Table */}
          {secondaryGateways.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Secondary Gateways</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>EUI</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {secondaryGateways.map(gateway => (
                      <TableRow key={gateway.id}>
                        <TableCell className="font-medium">
                          {editingId === gateway.id ? (
                            <Input
                              value={gateway.name}
                              onChange={e => updateGateway(gateway.id, { name: e.target.value })}
                              onBlur={() => setEditingId(null)}
                              onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                              className="h-7 w-32"
                              autoFocus
                            />
                          ) : (
                            gateway.name
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {gateway.eui}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={gateway.isOnline}
                              onCheckedChange={isOnline => updateGateway(gateway.id, { isOnline })}
                              disabled={disabled}
                            />
                            <span className="text-xs text-muted-foreground">
                              {gateway.isOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditingId(gateway.id)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => copyEui(gateway.eui, gateway.id)}
                            >
                              {copiedId === gateway.id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <SyncButton gateway={gateway} />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => removeGateway(gateway.id)}
                              disabled={disabled}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
