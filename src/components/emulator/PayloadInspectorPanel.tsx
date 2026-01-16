/**
 * Payload Inspector Panel
 * 
 * Displays decoded payloads, full TTN envelopes, simulation context,
 * and metadata for debugging and reproducibility.
 */

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Radio,
  Cpu,
  Hash,
  Signal,
  Clock,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { TTNEnvelope } from '@/lib/deviceLibrary/envelopeBuilder';
import type { SimulationContext, GenerationMode } from '@/lib/deviceLibrary/types';

// ============================================
// Types
// ============================================

export interface InspectionData {
  deviceInstanceId: string;
  libraryDeviceId: string | null;
  deviceName?: string;
  mode: GenerationMode;
  scenario?: string;
  alarm?: string;
  context: SimulationContext;
  seed?: number;
  decodedPayload: Record<string, unknown>;
  envelope?: TTNEnvelope;
  metadata: {
    f_port: number;
    f_cnt: number;
    rssi: number;
    snr: number;
    generatedAt: string;
  };
}

interface PayloadInspectorPanelProps {
  data: InspectionData | null;
  className?: string;
}

// ============================================
// Helpers
// ============================================

function formatSeed(seed: number | undefined): string {
  if (seed === undefined) return 'N/A';
  return `0x${seed.toString(16).slice(0, 8)}`;
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

// ============================================
// Sub-components
// ============================================

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: `${label} copied to clipboard` });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs gap-1"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      Copy
    </Button>
  );
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const jsonString = useMemo(() => formatJson(data), [data]);
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton text={jsonString} label={label} />
      </div>
      <ScrollArea className="h-32 rounded border bg-muted/30">
        <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">
          {jsonString}
        </pre>
      </ScrollArea>
    </div>
  );
}

function ContextRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function PayloadInspectorPanel({ data, className }: PayloadInspectorPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showEnvelope, setShowEnvelope] = useState(false);

  if (!data) {
    return (
      <Card className={`p-4 ${className}`}>
        <div className="text-center text-sm text-muted-foreground py-8">
          <Cpu className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No payload data to inspect</p>
          <p className="text-xs mt-1">Emit a reading to see details here</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`overflow-hidden ${className}`}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        {/* Header */}
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-3 border-b hover:bg-muted/30 cursor-pointer">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Cpu className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Payload Inspector</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={data.mode === 'alarm' ? 'destructive' : 'secondary'} className="text-xs">
                {data.mode === 'alarm' ? (
                  <><AlertTriangle className="h-3 w-3 mr-1" />{data.alarm || 'Alarm'}</>
                ) : data.scenario ? (
                  <><Zap className="h-3 w-3 mr-1" />{data.scenario}</>
                ) : (
                  'Normal'
                )}
              </Badge>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-3 space-y-4">
            {/* Device Info */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Device</span>
              </div>
              <div className="pl-5 space-y-0.5">
                <ContextRow 
                  label="Instance ID" 
                  value={data.deviceInstanceId} 
                  mono 
                />
                <ContextRow 
                  label="Library Model" 
                  value={data.libraryDeviceId || 'Legacy'} 
                  mono 
                />
                {data.deviceName && (
                  <ContextRow label="Name" value={data.deviceName} />
                )}
              </div>
            </div>

            {/* Context */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Simulation Context</span>
              </div>
              <div className="pl-5 space-y-0.5 text-xs">
                <ContextRow label="Org ID" value={data.context.orgId} mono />
                <ContextRow label="Site ID" value={data.context.siteId} mono />
                <ContextRow label="Unit ID" value={data.context.unitId} mono />
                <ContextRow label="Device Instance" value={data.context.deviceInstanceId} mono />
                <ContextRow label="Emission Sequence" value={data.context.emissionSequence.toString()} />
                <ContextRow label="Seed" value={formatSeed(data.seed)} mono />
              </div>
            </div>

            {/* Envelope Metadata */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Signal className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Envelope Metadata</span>
              </div>
              <div className="pl-5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                <ContextRow label="f_port" value={data.metadata.f_port.toString()} />
                <ContextRow label="f_cnt" value={data.metadata.f_cnt.toString()} />
                <ContextRow label="RSSI" value={`${data.metadata.rssi} dBm`} />
                <ContextRow label="SNR" value={`${data.metadata.snr} dB`} />
              </div>
            </div>

            {/* Timestamp */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Generated at: {new Date(data.metadata.generatedAt).toLocaleString()}</span>
            </div>

            {/* Decoded Payload */}
            <JsonBlock data={data.decodedPayload} label="Decoded Payload" />

            {/* Full Envelope (collapsible) */}
            {data.envelope && (
              <Collapsible open={showEnvelope} onOpenChange={setShowEnvelope}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between h-8 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      {showEnvelope ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Full TTN Envelope
                    </span>
                    <CopyButton text={formatJson(data.envelope)} label="Envelope" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <ScrollArea className="h-48 rounded border bg-muted/30">
                    <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">
                      {formatJson(data.envelope)}
                    </pre>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default PayloadInspectorPanel;
