import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { ProvisionResult, ProvisioningSummary, ProvisioningMode } from '../TTNProvisioningWizard';
import { useState } from 'react';

interface StepResultsProps {
  results: ProvisionResult[];
  summary: ProvisioningSummary;
  onRetryFailed: () => void;
  mode?: ProvisioningMode;
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
  const successResults = results.filter(r => r.status === 'created');
  const existingResults = results.filter(r => r.status === 'already_exists');

  const overallSuccess = summary.failed === 0;
  const partialSuccess = summary.failed > 0 && (summary.created > 0 || summary.already_exists > 0);

  return (
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

      {/* Failed items with expandable errors */}
      {failedResults.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                Failed {isGatewayMode ? 'Gateways' : 'Devices'} ({failedResults.length})
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryFailed}
                className="gap-2"
              >
                <RefreshCw className="h-3 w-3" />
                Retry Failed
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[150px]">
              <div className="space-y-2">
                {failedResults.map(result => {
                  const key = getResultKey(result);
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
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="p-2 mt-1 text-sm text-destructive bg-destructive/5 rounded">
                          {result.error || 'Unknown error'}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
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
  );
}
