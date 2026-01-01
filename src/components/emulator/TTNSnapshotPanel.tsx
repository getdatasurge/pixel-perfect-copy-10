import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Cloud, RefreshCw, Loader2, Info, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TTNSnapshot } from '@/hooks/useTTNSnapshot';

interface TTNSnapshotPanelProps {
  snapshot: TTNSnapshot | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  onRefresh: () => void;
  selectedUserId?: string;
  orgId?: string;
  siteId?: string;
}

export function TTNSnapshotPanel({
  snapshot,
  loading,
  error,
  errorCode,
  onRefresh,
  selectedUserId,
}: TTNSnapshotPanelProps) {
  if (!selectedUserId) {
    return null;
  }

  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
      <CardContent className="pt-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cloud className="h-4 w-4 text-blue-500" />
            TTN Settings from FrostGuard
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading TTN settings from FrostGuard...
          </div>
        )}

        {/* Snapshot Data */}
        {!loading && snapshot && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Cluster:</span>
                <span className="ml-2 font-mono">{snapshot.cluster}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Application:</span>
                <span className="ml-2 font-mono">{snapshot.application_id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">API Key:</span>
                <span className="ml-2 font-mono">
                  {snapshot.api_key_name ? `${snapshot.api_key_name} ` : ''}
                  ****{snapshot.api_key_last4}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Webhook:</span>
                <Badge variant={snapshot.webhook_enabled ? "default" : "secondary"} className="text-xs">
                  {snapshot.webhook_enabled ? "Configured" : "Not Set"}
                </Badge>
              </div>
            </div>

            {/* Connection Status */}
            {snapshot.last_test_at && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
                {snapshot.last_test_success ? (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500" />
                )}
                <span>
                  Last test: {new Date(snapshot.last_test_at).toLocaleString()}
                  {snapshot.last_test_message && ` - ${snapshot.last_test_message}`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <Alert variant="default" className={cn(
            "border",
            errorCode === 'NOT_FOUND' ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : "border-red-200"
          )}>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {errorCode === 'NOT_FOUND'
                ? 'No TTN integration found for this user. Provision in FrostGuard first, or configure manually in the Webhook tab.'
                : error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
