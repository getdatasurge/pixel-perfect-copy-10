import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Square, Zap, Cloud, Webhook, Radio } from 'lucide-react';
import { WebhookConfig } from '@/lib/ttn-payload';

interface EmulatorHeaderProps {
  isRunning: boolean;
  readingCount: number;
  webhookConfig: WebhookConfig;
  onStartEmulation: () => void;
  onStopEmulation: () => void;
  onSingleReading: () => void;
}

export default function EmulatorHeader({
  isRunning,
  readingCount,
  webhookConfig,
  onStartEmulation,
  onStopEmulation,
  onSingleReading,
}: EmulatorHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-background border-b">
      <div className="flex items-center justify-between px-6 py-4">
        {/* Left: App name and context badges */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">LoRaWAN Device Emulator</h1>
          </div>
          
          <div className="flex items-center gap-2">
            {webhookConfig.testOrgId && (
              <Badge variant="secondary" className="font-mono text-xs">
                Org: {webhookConfig.testOrgId.slice(0, 8)}...
              </Badge>
            )}
          </div>
        </div>

        {/* Right: Status and actions */}
        <div className="flex items-center gap-3">
          {/* Status badges */}
          <div className="flex items-center gap-2">
            <Badge 
              variant={isRunning ? 'default' : 'secondary'}
              className={isRunning ? 'bg-green-500 hover:bg-green-500' : ''}
            >
              {isRunning ? 'Running' : 'Stopped'}
            </Badge>
            
            <Badge variant="outline" className="font-mono">
              {readingCount} readings
            </Badge>

            {webhookConfig.ttnConfig?.enabled && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                <Cloud className="h-3 w-3 mr-1" />
                TTN
              </Badge>
            )}

            {webhookConfig.enabled && !webhookConfig.ttnConfig?.enabled && (
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                <Webhook className="h-3 w-3 mr-1" />
                Webhook
              </Badge>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <>
                <Button onClick={onStartEmulation} size="sm" className="gap-2">
                  <Play className="h-4 w-4" />
                  Start Emulation
                </Button>
                <Button variant="outline" onClick={onSingleReading} size="sm" className="gap-2">
                  <Zap className="h-4 w-4" />
                  Single Reading
                </Button>
              </>
            ) : (
              <Button variant="destructive" onClick={onStopEmulation} size="sm" className="gap-2">
                <Square className="h-4 w-4" />
                Stop Emulation
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
