import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Radio, 
  Loader2,
  ExternalLink,
  ArrowRightLeft
} from 'lucide-react';
import { debug } from '@/lib/debugLogger';

export interface PreflightDevice {
  dev_eui: string;
  device_id: string;
  name?: string;
  registered: boolean;
  error?: string;
  hint?: string;
}

export interface PreflightResult {
  ok: boolean;
  cluster: string;
  host: string;
  application: {
    id: string;
    exists: boolean;
    error?: string;
  };
  devices: PreflightDevice[];
  all_registered: boolean;
  unregistered_count: number;
  cluster_mismatch?: {
    detected_cluster: string;
    configured_cluster: string;
    hint: string;
  };
  request_id: string;
  settings_source: string;
}

interface TTNPreflightModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preflightResult: PreflightResult | null;
  onRegisterDevices: () => void;
  onOpenProvisioningWizard: () => void;
  onSwitchCluster: (newCluster: string) => void;
  onContinueAnyway: () => void;
  isRegistering?: boolean;
}

export default function TTNPreflightModal({
  open,
  onOpenChange,
  preflightResult,
  onRegisterDevices,
  onOpenProvisioningWizard,
  onSwitchCluster,
  onContinueAnyway,
  isRegistering = false,
}: TTNPreflightModalProps) {
  if (!preflightResult) return null;

  const { 
    cluster, 
    host, 
    application, 
    devices, 
    all_registered, 
    unregistered_count,
    cluster_mismatch,
    request_id,
  } = preflightResult;

  const unregisteredDevices = devices.filter(d => !d.registered);
  const registeredDevices = devices.filter(d => d.registered);

  const hasClusterMismatch = !!cluster_mismatch;
  const hasAppError = !application.exists;
  const hasUnregistered = unregistered_count > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            TTN Preflight Check
          </DialogTitle>
          <DialogDescription>
            Verifying TTN configuration before emulation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cluster Mismatch Warning */}
          {hasClusterMismatch && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Cluster Mismatch Detected</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{cluster_mismatch.hint}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline">{cluster_mismatch.configured_cluster}</Badge>
                  <ArrowRightLeft className="h-4 w-4" />
                  <Badge variant="secondary">{cluster_mismatch.detected_cluster}</Badge>
                </div>
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="mt-2"
                  onClick={() => onSwitchCluster(cluster_mismatch.detected_cluster)}
                >
                  Switch to {cluster_mismatch.detected_cluster}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Application Status */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex items-center gap-2">
              {application.exists ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="font-medium">Application</span>
            </div>
            <div className="text-right">
              <code className="text-sm bg-muted px-2 py-0.5 rounded">{application.id}</code>
              {application.error && (
                <p className="text-xs text-destructive mt-1">{application.error}</p>
              )}
            </div>
          </div>

          {/* Host Info */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <span className="text-sm text-muted-foreground">Active TTN Host</span>
            <code className="text-sm">{host}</code>
          </div>

          {/* Device Registration Status */}
          {devices.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Devices</span>
                <div className="flex gap-2">
                  {registeredDevices.length > 0 && (
                    <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                      {registeredDevices.length} registered
                    </Badge>
                  )}
                  {unregisteredDevices.length > 0 && (
                    <Badge variant="destructive">
                      {unregisteredDevices.length} not registered
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {devices.map((device) => (
                    <div 
                      key={device.dev_eui}
                      className={`flex items-center justify-between p-2 rounded text-sm ${
                        device.registered ? 'bg-green-500/5' : 'bg-destructive/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {device.registered ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-destructive" />
                        )}
                        <span>{device.name || device.device_id}</span>
                      </div>
                      <code className="text-xs text-muted-foreground">
                        {device.device_id}
                      </code>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Unregistered Device Warning */}
          {hasUnregistered && !hasClusterMismatch && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Devices Not Registered</AlertTitle>
              <AlertDescription>
                {unregistered_count} device{unregistered_count > 1 ? 's are' : ' is'} not registered in TTN.
                Uplinks will be dropped with "Entity not found" until registered.
              </AlertDescription>
            </Alert>
          )}

          {/* Request ID for debugging */}
          <div className="text-xs text-muted-foreground text-right">
            Request ID: {request_id}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {hasClusterMismatch ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                variant="default"
                onClick={() => onSwitchCluster(cluster_mismatch.detected_cluster)}
              >
                Switch to {cluster_mismatch.detected_cluster}
              </Button>
            </>
          ) : hasUnregistered ? (
            <>
              <Button 
                variant="outline" 
                onClick={onContinueAnyway}
                className="text-muted-foreground"
              >
                Skip (uplinks will fail)
              </Button>
              <Button 
                variant="secondary"
                onClick={onOpenProvisioningWizard}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Wizard
              </Button>
              <Button 
                variant="default"
                onClick={onRegisterDevices}
                disabled={isRegistering}
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  'Register Now'
                )}
              </Button>
            </>
          ) : (
            <Button variant="default" onClick={() => onOpenChange(false)}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              All Checks Passed
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
