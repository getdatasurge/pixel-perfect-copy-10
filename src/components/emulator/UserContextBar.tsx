import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { User, Building2, MapPin, Radio, Clock, X, RefreshCw, Download, Hash, AlertTriangle } from 'lucide-react';
import { WebhookConfig } from '@/lib/ttn-payload';

interface UserContextBarProps {
  config: WebhookConfig;
  onClearContext: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
  isRefreshing?: boolean;
}

export default function UserContextBar({
  config,
  onClearContext,
  onRefresh,
  disabled,
  isRefreshing,
}: UserContextBarProps) {
  if (!config.selectedUserId) {
    return null;
  }

  const lastSyncTime = config.lastSyncAt 
    ? new Date(config.lastSyncAt).toLocaleTimeString() 
    : null;

  return (
    <Card className="mb-4">
      <div className="p-3 flex items-center justify-between gap-4 flex-wrap">
        {/* User info */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">
              {config.selectedUserDisplayName}
            </span>
          </div>

          {/* Organization */}
          {config.testOrgId && (
            <Badge variant="secondary" className="font-normal text-xs">
              <Building2 className="h-3 w-3 mr-1" />
              {config.orgName || `Org: ${config.testOrgId.slice(0, 8)}...`}
            </Badge>
          )}

          {/* Site */}
          {config.testSiteId && (
            <Badge variant="outline" className="font-normal text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              Site: {config.testSiteId.slice(0, 8)}...
            </Badge>
          )}

          {/* TTN Status */}
          {config.ttnConfig?.enabled && (
            <Badge 
              variant="default" 
              className="font-normal text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            >
              <Radio className="h-3 w-3 mr-1" />
              TTN: {config.ttnConfig.applicationId}
            </Badge>
          )}

          {/* Sync version */}
          {config.lastSyncVersion !== undefined && (
            <Badge variant="outline" className="font-normal text-xs">
              <Hash className="h-3 w-3 mr-1" />
              v{config.lastSyncVersion}
            </Badge>
          )}

          {/* Warning when user selected but no TTN config synced */}
          {config.selectedUserId && !config.ttnConfig?.enabled && (
            <Badge variant="destructive" className="font-normal text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              TTN sync missing
            </Badge>
          )}

          {/* Last sync time */}
          {lastSyncTime && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Pulled {lastSyncTime}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={disabled || isRefreshing}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearContext}
            disabled={disabled || isRefreshing}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Change User
          </Button>
        </div>
      </div>

      {/* Sync summary */}
      {config.lastSyncSummary && (
        <div className="px-3 pb-3 pt-0">
          <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 flex items-center gap-1">
            <Download className="h-3 w-3" />
            {config.lastSyncSummary}
          </p>
        </div>
      )}
    </Card>
  );
}
