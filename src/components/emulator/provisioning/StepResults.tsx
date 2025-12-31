import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  RefreshCw,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { ProvisionResult, ProvisioningSummary, ProvisioningMode } from '../TTNProvisioningWizard';
import { useState } from 'react';

interface StepResultsProps {
  results: ProvisionResult[];
  summary: ProvisioningSummary;
  onRetryFailed: (filter?: 'all' | 'retryable') => void;
  mode?: ProvisioningMode;
}

// Get actionable hint for common errors
function getErrorHint(error?: string, errorCode?: string): string | null {
  if (!error && !errorCode) return null;
  
  if (errorCode === 'AUTH_INVALID' || error?.includes('401') || (error?.includes('Invalid') && error?.includes('key'))) {
    return 'Check your TTN API key in Webhook settings';
  }
  if (errorCode === 'AUTH_FORBIDDEN' || error?.includes('403') || error?.toLowerCase().includes('permission')) {
    return 'Ensure your API key has gateway/device registration permissions';
  }
  if (errorCode === 'INVALID_EUI' || (error?.includes('Invalid') && error?.includes('EUI'))) {
    return 'EUI must be 16 hexadecimal characters';
  }
  if (errorCode === 'RATE_LIMITED' || error?.includes('rate limit') || error?.includes('429')) {
    return 'Wait a moment and try again - TTN rate limit reached';
  }
  if (errorCode === 'SERVER_ERROR' || error?.includes('500') || error?.includes('503')) {
    return 'TTN server temporarily unavailable - try again later';
  }
  if (errorCode === 'NETWORK_ERROR' || error?.toLowerCase().includes('network') || error?.toLowerCase().includes('timeout')) {
    return 'Check your internet connection and try again';
  }
  return null;
}

export default function StepResults({
  results,
  summary,
  onRetryFailed,
  mode = 'devices',
}: StepResultsProps) {
  const [expandedErrors, setExpandedErrors] = useState<string[]>([]);
  const isGatewayMode = mode === 'gateways';
  const entityLabel = isGatewayMode ? 'gateway' : 'device';
  const entityLabelPlural = isGatewayMode ? 'gateways' : 'devices';

  const getResultKey = (result: ProvisionResult) => {
    return result.dev_eui || result.eui || result.name;
  };

  const getDisplayId = (result: ProvisionResult) => {
    return isGatewayMode ? result.ttn_gateway_id : result.ttn_device_id;
  };

  const toggleError = (key: string) => {
    setExpandedErrors(prev =>
      prev.includes(key)
        ? prev.filter(e => e !== key)
        : [...prev, key]
    );
  };

  const failedResults = results.filter(r => r.status === 'failed');
  const retryableFailures = failedResults.filter(r => r.retryable !== false);
  const permanentFailures = failedResults.filter(r => r.retryable === false);
  const successResults = results.filter(r => r.status === 'created');
  const existingResults = results.filter(r => r.status === 'already_exists');

  const overallSuccess = summary.failed === 0;
  const partialSuccess = summary.failed > 0 && (summary.created > 0 || summary.already_exists > 0);

  const renderFailureCard = (
    failures: ProvisionResult[], 
    title: string, 
    icon: React.ReactNode, 
    borderClass: string,
    showRetryButton: boolean,
    retryFilter: 'all' | 'retryable'
  ) => {
    if (failures.length === 0) return null;

    return (
      <Card className={borderClass}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              {icon}
              {title} ({failures.length})
            </span>
            {showRetryButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetryFailed(retryFilter)}
                className="gap-2"
              >
                <RefreshCw className="h-3 w-3" />
                Retry {retryFilter === 'retryable' ? 'These' : 'All'}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[150px]">
            <div className="space-y-2">
              {failures.map(result => {
                const key = getResultKey(result);
                const hint = getErrorHint(result.error, result.error_code);
                return (
                  <Collapsible
                    key={key}
                    open={expandedErrors.includes(key)}
                    onOpenChange={() => toggleError(key)}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between p-2 rounded bg-destructive/10 hover:bg-destructive/20 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{result.name}</span>
                          <code className="text-xs text-muted-foreground">
                            {getDisplayId(result)}
                          </code>
                          {result.attempts && result.attempts > 1 && (
                            <Badge variant="outline" className="text-xs">
                              {result.attempts} attempts
                            </Badge>
                          )}
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="p-2 mt-1 space-y-2 text-sm bg-destructive/5 rounded">
                        <p className="text-destructive">
                          {result.error || 'Unknown error'}
                        </p>
                        {hint && (
                          <p className="text-muted-foreground flex items-center gap-1">
                            <HelpCircle className="h-3 w-3" />
                            <span>{hint}</span>
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Overall status banner */}
        {overallSuccess ? (
          <Alert className="border-green-600/30 bg-green-50 dark:bg-green-950/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              All {entityLabelPlural} provisioned successfully!
            </AlertDescription>
          </Alert>
        ) : partialSuccess ? (
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              Provisioning completed with some failures. {summary.failed} {entityLabel}(s) failed.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Provisioning failed. Check the errors below and try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-green-600/30">
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-green-600">{summary.created}</p>
              <p className="text-xs text-muted-foreground">Created</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{summary.already_exists}</p>
              <p className="text-xs text-muted-foreground">Already Existed</p>
            </CardContent>
          </Card>
          <Card className="border-destructive/30">
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-destructive">{summary.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
        </div>

        {/* Retryable failures */}
        {renderFailureCard(
          retryableFailures,
          'Retryable Failures',
          <AlertTriangle className="h-4 w-4 text-amber-500" />,
          'border-amber-500/30',
          true,
          'retryable'
        )}

        {/* Permanent failures */}
        {renderFailureCard(
          permanentFailures,
          <span className="flex items-center gap-1">
            Permanent Failures
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-[200px]">
                  These errors require manual intervention (invalid EUI, permission denied, etc.)
                </p>
              </TooltipContent>
            </Tooltip>
          </span> as unknown as string,
          <XCircle className="h-4 w-4 text-destructive" />,
          'border-destructive/30',
          false,
          'all'
        )}

        {/* Successful registrations */}
        {(successResults.length > 0 || existingResults.length > 0) && (
          <Card className="border-green-600/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Successful ({successResults.length + existingResults.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[150px]">
                <div className="space-y-1">
                  {[...successResults, ...existingResults].map(result => {
                    const key = getResultKey(result);
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{result.name}</span>
                          <code className="text-xs text-muted-foreground">
                            {getDisplayId(result)}
                          </code>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            result.status === 'created'
                              ? 'text-green-600 border-green-600/30'
                              : 'text-amber-600 border-amber-600/30'
                          }
                        >
                          {result.status === 'created' ? 'Created' : 'Existed'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
