import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Download, Loader2, MapPin, Box, Radio, Wifi,
  ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react';
import { pullFreshTrackOrgState } from '@/lib/freshtrackExport';
import {
  loadOrgState,
  saveOrgState,
  FreshTrackOrgState,
} from '@/lib/freshtrackOrgStateStore';
import { toast } from '@/hooks/use-toast';

interface OrgStateViewerProps {
  orgId: string;
}

function SummaryCard({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count: number }) {
  return (
    <div className="bg-muted rounded-lg p-3 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
      <div className="text-lg font-semibold">{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'active' || status === 'online' || status === 'ok'
    ? 'outline'
    : status === 'offline' || status === 'fault' || status === 'inactive'
      ? 'destructive'
      : 'secondary';
  return <Badge variant={variant} className="text-xs">{status}</Badge>;
}

export default function OrgStateViewer({ orgId }: OrgStateViewerProps) {
  const [orgState, setOrgState] = useState<FreshTrackOrgState | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Load cached state on mount
  useEffect(() => {
    const cached = loadOrgState();
    if (cached && cached.orgId === orgId) {
      setOrgState(cached);
    }
  }, [orgId]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handlePullState = useCallback(async () => {
    setIsPulling(true);
    const result = await pullFreshTrackOrgState(orgId);
    if (result.ok && result.orgState) {
      setOrgState(result.orgState);
      saveOrgState(result.orgState);
      const s = result.orgState;
      toast({
        title: 'State Pulled',
        description: `${s.sites.length} sites, ${s.units.length} units, ${s.sensors.length} sensors, ${s.gateways.length} gateways`,
      });
    } else {
      toast({
        title: 'Pull Failed',
        description: result.hint || result.error || 'Unknown error',
        variant: 'destructive',
      });
    }
    setIsPulling(false);
  }, [orgId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            FreshTrack Organization State
          </CardTitle>
          <div className="flex items-center gap-2">
            {orgState && (
              <Badge variant="outline" className="text-xs">
                v{orgState.syncVersion} @ {new Date(orgState.pulledAt).toLocaleTimeString()}
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handlePullState}
              disabled={isPulling}
            >
              {isPulling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Pull State
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!orgState ? (
          <p className="text-sm text-muted-foreground">
            Click "Pull State" to fetch the organization structure from FreshTrack Pro.
          </p>
        ) : (
          <>
            {/* Summary Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard icon={MapPin} label="Sites" count={orgState.sites.length} />
              <SummaryCard icon={Box} label="Units" count={orgState.units.length} />
              <SummaryCard icon={Radio} label="Sensors" count={orgState.sensors.length} />
              <SummaryCard icon={Wifi} label="Gateways" count={orgState.gateways.length} />
            </div>

            {/* Sites */}
            {orgState.sites.length > 0 && (
              <Collapsible open={expandedSections.sites} onOpenChange={() => toggleSection('sites')}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-muted-foreground w-full">
                  {expandedSections.sites ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Sites ({orgState.sites.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="max-h-48 mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">City</TableHead>
                          <TableHead className="text-xs">State</TableHead>
                          <TableHead className="text-xs">Timezone</TableHead>
                          <TableHead className="text-xs">Active</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgState.sites.map(site => (
                          <TableRow key={site.id}>
                            <TableCell className="text-xs font-medium">{site.name}</TableCell>
                            <TableCell className="text-xs">{site.city || '—'}</TableCell>
                            <TableCell className="text-xs">{site.state || '—'}</TableCell>
                            <TableCell className="text-xs font-mono">{site.timezone || '—'}</TableCell>
                            <TableCell className="text-xs">{site.is_active ? 'Yes' : 'No'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Units */}
            {orgState.units.length > 0 && (
              <Collapsible open={expandedSections.units} onOpenChange={() => toggleSection('units')}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-muted-foreground w-full">
                  {expandedSections.units ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Units ({orgState.units.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="max-h-48 mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Temp Limits</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgState.units.map(unit => (
                          <TableRow key={unit.id}>
                            <TableCell className="text-xs font-medium">{unit.name}</TableCell>
                            <TableCell className="text-xs">{unit.unit_type || '—'}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {unit.temp_limit_low != null ? `${unit.temp_limit_low}°` : '—'}
                              {' / '}
                              {unit.temp_limit_high != null ? `${unit.temp_limit_high}°` : '—'}
                            </TableCell>
                            <TableCell className="text-xs">
                              {unit.status ? <StatusBadge status={unit.status} /> : '—'}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{unit.id.slice(0, 8)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Sensors */}
            {orgState.sensors.length > 0 && (
              <Collapsible open={expandedSections.sensors} onOpenChange={() => toggleSection('sensors')}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-muted-foreground w-full">
                  {expandedSections.sensors ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Sensors ({orgState.sensors.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="max-h-48 mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">DEV EUI</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Model</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgState.sensors.map(sensor => (
                          <TableRow key={sensor.id}>
                            <TableCell className="text-xs font-medium">{sensor.name}</TableCell>
                            <TableCell className="text-xs font-mono">{sensor.dev_eui}</TableCell>
                            <TableCell className="text-xs">{sensor.sensor_type}</TableCell>
                            <TableCell className="text-xs">{sensor.model || '—'}</TableCell>
                            <TableCell className="text-xs">
                              <StatusBadge status={sensor.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Gateways */}
            {orgState.gateways.length > 0 && (
              <Collapsible open={expandedSections.gateways} onOpenChange={() => toggleSection('gateways')}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-muted-foreground w-full">
                  {expandedSections.gateways ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Gateways ({orgState.gateways.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="max-h-48 mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">EUI</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Last Seen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orgState.gateways.map(gw => (
                          <TableRow key={gw.id}>
                            <TableCell className="text-xs font-medium">{gw.name}</TableCell>
                            <TableCell className="text-xs font-mono">{gw.gateway_eui}</TableCell>
                            <TableCell className="text-xs">
                              <StatusBadge status={gw.status} />
                            </TableCell>
                            <TableCell className="text-xs">
                              {gw.last_seen_at ? new Date(gw.last_seen_at).toLocaleString() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* TTN Config */}
            {orgState.ttn && (
              <Collapsible open={expandedSections.ttn} onOpenChange={() => toggleSection('ttn')}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-muted-foreground w-full">
                  {expandedSections.ttn ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  TTN Configuration
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div className="text-muted-foreground">Enabled</div>
                    <div>{orgState.ttn.enabled ? 'Yes' : 'No'}</div>
                    {orgState.ttn.cluster && (
                      <>
                        <div className="text-muted-foreground">Cluster</div>
                        <div className="font-mono">{orgState.ttn.cluster}</div>
                      </>
                    )}
                    {orgState.ttn.application_id && (
                      <>
                        <div className="text-muted-foreground">Application ID</div>
                        <div className="font-mono">{orgState.ttn.application_id}</div>
                      </>
                    )}
                    {orgState.ttn.webhook_id && (
                      <>
                        <div className="text-muted-foreground">Webhook ID</div>
                        <div className="font-mono">{orgState.ttn.webhook_id}</div>
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
