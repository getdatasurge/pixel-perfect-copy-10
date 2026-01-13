import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Square, Zap, Cloud, Webhook, Radio, Check, X, Clock } from 'lucide-react';
import { WebhookConfig } from '@/lib/ttn-payload';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DeveloperMenu } from './DebugModeToggle';
import { getServerTime, getServerTimeOffset, getLastSyncTime, isTimeSyncStale } from '@/lib/serverTime';
import { format } from 'date-fns';
import { useState, useEffect } from 'react';
interface EmulatorHeaderProps {
  isRunning: boolean;
  readingCount: number;
  webhookConfig: WebhookConfig;
  onStartEmulation: () => void;
  onStopEmulation: () => void;
  onSingleReading: () => void;
}

// Format relative time for display
const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
};

export default function EmulatorHeader({
  isRunning,
  readingCount,
  webhookConfig,
  onStartEmulation,
  onStopEmulation,
  onSingleReading,
}: EmulatorHeaderProps) {
  // Update time display every second when running
  const [, setTick] = useState(0);
  
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const offsetMs = getServerTimeOffset();
  const lastSync = getLastSyncTime();
  const isSyncStale = isTimeSyncStale(5 * 60 * 1000); // 5 minutes
  const offsetSeconds = Math.round(offsetMs / 1000);
  
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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "gap-1 cursor-help",
                        webhookConfig.ttnConfig.lastTestSuccess === true && "bg-green-500/10 text-green-600 border-green-500/30",
                        webhookConfig.ttnConfig.lastTestSuccess === false && "bg-red-500/10 text-red-600 border-red-500/30",
                        webhookConfig.ttnConfig.lastTestSuccess === null || webhookConfig.ttnConfig.lastTestSuccess === undefined && "bg-primary/10 text-primary border-primary/30"
                      )}
                    >
                      <Cloud className="h-3 w-3" />
                      TTN
                      {webhookConfig.ttnConfig.lastTestSuccess === true && <Check className="h-3 w-3" />}
                      {webhookConfig.ttnConfig.lastTestSuccess === false && <X className="h-3 w-3" />}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {webhookConfig.ttnConfig.lastTestSuccess === true && webhookConfig.ttnConfig.lastTestAt && (
                      <p>Connected - Last checked {formatRelativeTime(new Date(webhookConfig.ttnConfig.lastTestAt))}</p>
                    )}
                    {webhookConfig.ttnConfig.lastTestSuccess === false && (
                      <p>Disconnected - Check Webhook settings</p>
                    )}
                    {(webhookConfig.ttnConfig.lastTestSuccess === null || webhookConfig.ttnConfig.lastTestSuccess === undefined) && (
                      <p>TTN enabled - Not tested yet</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {webhookConfig.enabled && !webhookConfig.ttnConfig?.enabled && (
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                <Webhook className="h-3 w-3 mr-1" />
                Webhook
              </Badge>
            )}

            {/* Server Time Sync Indicator */}
            {lastSync ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "gap-1 cursor-help font-mono text-xs",
                        isSyncStale && "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
                        !isSyncStale && "bg-blue-500/10 text-blue-600 border-blue-500/30"
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {format(getServerTime(), 'HH:mm:ss')}
                      <span className="opacity-60">
                        ({offsetSeconds === 0 ? '±0' : `${offsetSeconds > 0 ? '+' : ''}${offsetSeconds}s`})
                      </span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Server Time: {format(getServerTime(), 'PPpp')}</p>
                    <p className="text-xs text-muted-foreground">
                      Offset: {offsetSeconds}s from browser | Last synced: {formatRelativeTime(lastSync)}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Badge variant="outline" className="gap-1 font-mono text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">
                <Clock className="h-3 w-3" />
                {format(new Date(), 'HH:mm:ss')}
                <span className="opacity-60">(local)</span>
              </Badge>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Developer menu with debug toggle */}
            <DeveloperMenu />
            
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
