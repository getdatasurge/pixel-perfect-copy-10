import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Thermometer, DoorOpen, Plus, Trash2, Copy, Check, QrCode, RefreshCw, Radio, Cloud, Loader2, Lock, Unlock, MapPin, Box, AlertCircle, RotateCcw, Download, ClipboardCopy, Database, ChevronDown } from 'lucide-react';
import { LoRaWANDevice, GatewayConfig, WebhookConfig, createDevice, generateEUI, generateAppKey } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import UnitSelect from './UnitSelect';
import SiteSelect from './SiteSelect';
import { OrgStateUnit } from '@/lib/frostguardOrgSync';
import { log } from '@/lib/debugLogger';
import { downloadSnapshot, buildSupportSnapshot } from '@/lib/supportSnapshot';
import { DEVICE_TEMPLATES, normalizeEui, normalizeAppKey } from '@/lib/deviceTemplates';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
interface DeviceManagerProps {
  devices: LoRaWANDevice[];
  gateways: GatewayConfig[];
  onDevicesChange: (devices: LoRaWANDevice[]) => void;
  onShowQR: (device: LoRaWANDevice) => void;
  disabled?: boolean;
  webhookConfig?: WebhookConfig;
  ttnConfigured?: boolean;
  ttnProvisionedDevices?: Set<string>;
  onProvisionToTTN?: () => void;
  // Unit/Site assignment props
  availableUnits?: OrgStateUnit[];
  availableSites?: Array<{ site_id: string; site_name: string | null }>;
  onAssignUnit?: (deviceId: string, unitId: string | undefined, siteId: string | undefined) => Promise<void>;
  onCreateUnit?: () => void;
}

export default function DeviceManager({ 
  devices, 
  gateways, 
  onDevicesChange, 
  onShowQR,
  disabled,
  webhookConfig,
  ttnConfigured,
  ttnProvisionedDevices,
  onProvisionToTTN,
  availableUnits,
  availableSites,
  onAssignUnit,
  onCreateUnit,
}: DeviceManagerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [ttnRegistering, setTtnRegistering] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [assigningId, setAssigningId] = useState<string | null>(null);
  
  // Rich error info for assignment failures
  interface AssignmentError {
    message: string;
    status_code?: number;
    hint?: string;
    request_id?: string;
    error_code?: string;
  }
  const [assignmentErrors, setAssignmentErrors] = useState<Map<string, AssignmentError>>(new Map());

  const canSync = !!webhookConfig?.testOrgId;

  // Helper to get site name from site_id
  const getSiteName = (siteId: string | undefined): string | null => {
    if (!siteId || !availableSites) return null;
    const site = availableSites.find(s => s.site_id === siteId);
    return site?.site_name || null;
  };

  // Helper to get unit name from unit_id
  const getUnitName = (unitId: string | undefined): string | null => {
    if (!unitId || !availableUnits) return null;
    const unit = availableUnits.find(u => u.id === unitId);
    return unit?.name || null;
  };

  // Get location badge for device
  const getLocationBadge = (device: LoRaWANDevice) => {
    if (!device.unitId && !device.siteId) {
      return (
        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600">
          Unassigned
        </Badge>
      );
    }
    if (device.unitId) {
      return (
        <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
          <Box className="h-2 w-2" />
          Assigned
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs text-blue-600 border-blue-600">
        Site Only
      </Badge>
    );
  };

  // Handle site assignment change
  const handleSiteChange = async (deviceId: string, siteId: string | undefined) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    // Clear any previous error for this device
    setAssignmentErrors(prev => {
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });

    // Check if current unit belongs to new site - if not, clear it
    let newUnitId = device.unitId;
    if (device.unitId && siteId) {
      const currentUnit = availableUnits?.find(u => u.id === device.unitId);
      if (currentUnit && currentUnit.site_id !== siteId) {
        newUnitId = undefined; // Clear unit if it doesn't belong to new site
        toast({ 
          title: 'Unit Cleared', 
          description: 'Previous unit was in a different site',
          variant: 'default' 
        });
      }
    }
    // If site is cleared, also clear unit
    if (!siteId) {
      newUnitId = undefined;
    }

    // Log the request
    log('context', 'info', 'ASSIGNMENT_UPDATE_REQUEST', {
      device_id: deviceId,
      device_name: device.name,
      new_site_id: siteId || 'null',
      new_unit_id: newUnitId || 'null',
      previous_site_id: device.siteId || 'null',
      previous_unit_id: device.unitId || 'null',
    });

    // Update local state immediately for responsiveness
    updateDevice(deviceId, { siteId, unitId: newUnitId });

    // Sync to FrostGuard if callback provided
    if (onAssignUnit) {
      setAssigningId(deviceId);
      const startTime = Date.now();
      try {
        await onAssignUnit(deviceId, newUnitId, siteId);
        log('context', 'info', 'ASSIGNMENT_UPDATE_SUCCESS', {
          device_id: deviceId,
          site_id: siteId,
          unit_id: newUnitId,
          duration_ms: Date.now() - startTime,
        });
        toast({ title: 'Site Assigned', description: 'Device location updated successfully' });
      } catch (err) {
        const error = err as Error & { 
          status_code?: number; 
          hint?: string; 
          request_id?: string; 
          error_code?: string;
        };
        const errorMessage = error.message || 'Unknown error';
        
        log('context', 'error', 'ASSIGNMENT_UPDATE_ERROR', {
          device_id: deviceId,
          error: errorMessage,
          status_code: error.status_code,
          error_code: error.error_code,
          hint: error.hint,
          request_id: error.request_id,
          duration_ms: Date.now() - startTime,
        });
        
        // Revert local state on error
        updateDevice(deviceId, { siteId: device.siteId, unitId: device.unitId });
        
        // Store rich error for inline display
        const errorInfo: AssignmentError = {
          message: errorMessage,
          status_code: error.status_code,
          hint: error.hint,
          request_id: error.request_id,
          error_code: error.error_code,
        };
        setAssignmentErrors(prev => new Map(prev).set(deviceId, errorInfo));
        
        toast({ 
          title: 'Assignment Failed', 
          description: errorMessage,
          variant: 'destructive' 
        });
      } finally {
        setAssigningId(null);
      }
    }
  };

  // Handle unit assignment change
  const handleUnitChange = async (
    deviceId: string, 
    unitId: string | undefined, 
    unit?: OrgStateUnit
  ) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    // Clear any previous error for this device
    setAssignmentErrors(prev => {
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });

    // Determine site_id from selected unit or keep existing
    const siteId = unit?.site_id || device.siteId;

    // Log the request
    log('context', 'info', 'ASSIGNMENT_UPDATE_REQUEST', {
      device_id: deviceId,
      device_name: device.name,
      new_site_id: siteId || 'null',
      new_unit_id: unitId || 'null',
      previous_site_id: device.siteId || 'null',
      previous_unit_id: device.unitId || 'null',
    });
    
    // Update local state immediately for responsiveness
    updateDevice(deviceId, { unitId, siteId });
    
    // Sync to FrostGuard if callback provided
    if (onAssignUnit) {
      setAssigningId(deviceId);
      const startTime = Date.now();
      try {
        await onAssignUnit(deviceId, unitId, siteId);
        log('context', 'info', 'ASSIGNMENT_UPDATE_SUCCESS', {
          device_id: deviceId,
          site_id: siteId,
          unit_id: unitId,
          duration_ms: Date.now() - startTime,
        });
        toast({ title: 'Unit Assigned', description: 'Device location updated successfully' });
      } catch (err) {
        const error = err as Error & { 
          status_code?: number; 
          hint?: string; 
          request_id?: string; 
          error_code?: string;
        };
        const errorMessage = error.message || 'Unknown error';
        
        log('context', 'error', 'ASSIGNMENT_UPDATE_ERROR', {
          device_id: deviceId,
          error: errorMessage,
          status_code: error.status_code,
          error_code: error.error_code,
          hint: error.hint,
          request_id: error.request_id,
          duration_ms: Date.now() - startTime,
        });
        
        // Revert local state on error
        updateDevice(deviceId, { unitId: device.unitId, siteId: device.siteId });
        
        // Store rich error for inline display
        const errorInfo: AssignmentError = {
          message: errorMessage,
          status_code: error.status_code,
          hint: error.hint,
          request_id: error.request_id,
          error_code: error.error_code,
        };
        setAssignmentErrors(prev => new Map(prev).set(deviceId, errorInfo));
        
        toast({ 
          title: 'Assignment Failed', 
          description: errorMessage,
          variant: 'destructive' 
        });
      } finally {
        setAssigningId(null);
      }
    }
  };

  // Retry assignment for a device
  const handleRetryAssignment = (deviceId: string) => {
    const device = devices.find(d => d.id === deviceId);
    if (device) {
      handleSiteChange(deviceId, device.siteId);
    }
  };

  // Export support snapshot for a specific device issue
  const handleExportSnapshot = async () => {
    const snapshot = buildSupportSnapshot();
    downloadSnapshot(snapshot);
  };


  const addDevice = (type: 'temperature' | 'door') => {
    const defaultGateway = gateways[0]?.id || '';
    const count = devices.filter(d => d.type === type).length + 1;
    const name = type === 'temperature' ? `Temp Sensor ${count}` : `Door Sensor ${count}`;
    const newDevice = {
      ...createDevice(name, type, defaultGateway),
      credentialSource: 'local_generated' as const,
      credentialsLockedFromFrostguard: false,
    };
    onDevicesChange([...devices, newDevice]);
    toast({ title: 'Device added', description: `Created ${name}` });
  };

  const removeDevice = (id: string) => {
    onDevicesChange(devices.filter(d => d.id !== id));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateDevice = (id: string, updates: Partial<LoRaWANDevice>) => {
    onDevicesChange(devices.map(d => (d.id === id ? { ...d, ...updates } : d)));
    setSyncedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const regenerateCredentials = (id: string) => {
    updateDevice(id, {
      devEui: generateEUI(),
      joinEui: generateEUI(),
      appKey: generateAppKey(),
      credentialSource: 'manual_override',
      credentialsLockedFromFrostguard: false,
    });
    toast({ title: 'Regenerated', description: 'New credentials generated' });
  };

  const unlockCredentials = (id: string) => {
    updateDevice(id, {
      credentialsLockedFromFrostguard: false,
      credentialSource: 'manual_override',
    });
    toast({ title: 'Credentials Unlocked', description: 'You can now edit the credentials' });
  };

  const getCredentialSourceBadge = (device: LoRaWANDevice) => {
    if (!device.joinEui && !device.appKey) {
      return (
        <Badge variant="destructive" className="text-xs gap-1">
          Missing
        </Badge>
      );
    }
    
    switch (device.credentialSource) {
      case 'frostguard_pull':
        return (
          <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
            <Lock className="h-2 w-2" />
            FrostGuard
          </Badge>
        );
      case 'frostguard_generated':
        return (
          <Badge variant="outline" className="text-xs text-blue-600 border-blue-600 gap-1">
            <Lock className="h-2 w-2" />
            Generated
          </Badge>
        );
      case 'local_generated':
        return (
          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600">
            Local
          </Badge>
        );
      case 'manual_override':
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Override
          </Badge>
        );
      default:
        return null;
    }
  };

  const copyField = async (value: string, fieldId: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const registerInTTN = async (device: LoRaWANDevice) => {
    const ttnConfig = webhookConfig?.ttnConfig;
    if (!ttnConfig?.applicationId) {
      toast({ title: 'Configure TTN', description: 'Set TTN Application ID in Webhook tab first', variant: 'destructive' });
      return;
    }

    setTtnRegistering(device.id);
    try {
      const { data, error } = await supabase.functions.invoke('ttn-register-device', {
        body: {
          applicationId: ttnConfig.applicationId,
          cluster: ttnConfig.cluster,
          devEui: device.devEui,
          joinEui: device.joinEui,
          appKey: device.appKey,
          deviceName: device.name,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Registration failed');

      toast({ title: 'Registered in TTN', description: `Device ${device.name} registered` });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast({ title: 'TTN Registration Failed', description: errorMessage, variant: 'destructive' });
    } finally {
      setTtnRegistering(null);
    }
  };

  const syncDevice = async (device: LoRaWANDevice) => {
    if (!webhookConfig?.testOrgId) {
      toast({ 
        title: 'Configure Test Context', 
        description: 'Set Organization ID in the Testing tab first', 
        variant: 'destructive' 
      });
      return;
    }

    const requestId = crypto.randomUUID().slice(0, 8);
    setSyncingId(device.id);
    
    log('network', 'info', 'SYNC_TO_FROSTGUARD_REQUEST', {
      request_id: requestId,
      device_id: device.id,
      device_name: device.name,
      dev_eui: device.devEui,
      org_id: webhookConfig.testOrgId,
    });
    
    const startTime = Date.now();
    
    try {
      // Normalize credentials before sending (single source of truth)
      const normalizedDevEui = normalizeEui(device.devEui) || device.devEui;
      const normalizedJoinEui = normalizeEui(device.joinEui) || device.joinEui;
      const normalizedAppKey = normalizeAppKey(device.appKey) || device.appKey;
      
      const { data, error } = await supabase.functions.invoke('sync-to-frostguard', {
        body: {
          metadata: {
            sync_run_id: crypto.randomUUID(),
            initiated_at: new Date().toISOString(),
            source_project: 'pixel-perfect-copy-10',
            request_id: requestId,
          },
          context: {
            org_id: webhookConfig.testOrgId,
            site_id: webhookConfig.testSiteId,
            unit_id: webhookConfig.testUnitId,
            ttn_application_id: webhookConfig.ttnConfig?.applicationId,
            ttn_region: webhookConfig.ttnConfig?.cluster,
          },
          entities: {
            gateways: [],
            devices: [{
              id: device.id,
              name: device.name,
              dev_eui: normalizedDevEui,
              join_eui: normalizedJoinEui,
              app_key: normalizedAppKey,
              type: device.type, // 'door' or 'temperature' - backend maps to sensor_kind
              gateway_id: device.gatewayId,
            }],
          },
        },
      });

      if (error) throw error;
      if (!data?.ok && !data?.success) {
        const errorMsg = data?.error || data?.results?.sensors?.errors?.[0] || 'Sync failed';
        throw new Error(errorMsg);
      }

      log('network', 'info', 'SYNC_TO_FROSTGUARD_SUCCESS', {
        request_id: requestId,
        device_id: device.id,
        duration_ms: Date.now() - startTime,
        method: data?.method,
      });
      
      setSyncedIds(prev => new Set(prev).add(device.id));
      toast({ title: 'Sensor Synced', description: `${device.name} synced` });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      log('network', 'error', 'SYNC_TO_FROSTGUARD_ERROR', {
        request_id: requestId,
        device_id: device.id,
        error: errorMessage,
        duration_ms: Date.now() - startTime,
      });
      
      toast({ 
        title: 'Sync Failed', 
        description: `${errorMessage} (ID: ${requestId})`, 
        variant: 'destructive' 
      });
    } finally {
      setSyncingId(null);
    }
  };

  // Write Test Sensor - DB-only smoke test without TTN
  // Now supports both temperature and door sensor types with correct metadata
  const writeTestSensor = async (type: 'temperature' | 'door' = 'temperature') => {
    if (!webhookConfig?.testOrgId) {
      toast({ 
        title: 'Configure Test Context', 
        description: 'Set Organization ID in the Testing tab first', 
        variant: 'destructive' 
      });
      return;
    }

    const requestId = crypto.randomUUID().slice(0, 8);
    const template = DEVICE_TEMPLATES[type];
    const testDevEui = generateEUI().toUpperCase();
    
    const testSensor = {
      id: crypto.randomUUID(),
      org_id: webhookConfig.testOrgId,
      site_id: webhookConfig.testSiteId || null,
      unit_id: webhookConfig.testUnitId || crypto.randomUUID(), // Required field
      dev_eui: testDevEui,
      join_eui: generateEUI().toUpperCase(),
      app_key: generateAppKey().toUpperCase(),
      sensor_kind: template.sensor_kind,
      manufacturer: template.manufacturer,
      model: template.model,
      firmware_version: template.firmware_version,
      description: template.description,
      status: 'pending' as const,
      name: `Test ${type === 'door' ? 'Door' : 'Temp'} Sensor ${Date.now().toString(36).toUpperCase()}`,
      ttn_device_id: `sensor-${testDevEui.toLowerCase()}`,
      ttn_application_id: webhookConfig.ttnConfig?.applicationId || null,
      ttn_region: webhookConfig.ttnConfig?.cluster || 'nam1',
    };
    
    log('network', 'info', 'WRITE_TEST_SENSOR_REQUEST', {
      request_id: requestId,
      sensor_id: testSensor.id,
      sensor_type: type,
      sensor_kind: template.sensor_kind,
      dev_eui: testSensor.dev_eui,
      org_id: testSensor.org_id,
    });

    try {
      const { data, error } = await supabase
        .from('lora_sensors')
        .insert(testSensor)
        .select()
        .single();
        
      if (error) {
        log('network', 'error', 'WRITE_TEST_SENSOR_ERROR', {
          request_id: requestId,
          error: error.message,
          error_code: error.code,
        });
        toast({ 
          title: 'DB Write Failed', 
          description: `${error.message} (ID: ${requestId})`, 
          variant: 'destructive' 
        });
      } else {
        log('network', 'info', 'WRITE_TEST_SENSOR_SUCCESS', {
          request_id: requestId,
          sensor_id: data.id,
          sensor_kind: template.sensor_kind,
          dev_eui: data.dev_eui,
        });
        toast({ 
          title: `Test ${type === 'door' ? 'Door' : 'Temp'} Sensor Created`, 
          description: `${template.model} (${template.sensor_kind}) • DevEUI: ${data.dev_eui}` 
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log('network', 'error', 'WRITE_TEST_SENSOR_EXCEPTION', {
        request_id: requestId,
        error: errorMessage,
      });
      toast({ 
        title: 'DB Write Failed', 
        description: `${errorMessage} (ID: ${requestId})`, 
        variant: 'destructive' 
      });
    }
  };

  const CopyButton = ({ value, fieldId }: { value: string; fieldId: string }) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => copyField(value, fieldId)}
    >
      {copiedField === fieldId ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );

  const SyncButton = ({ device }: { device: LoRaWANDevice }) => {
    const isSyncing = syncingId === device.id;
    const isSynced = syncedIds.has(device.id);

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
        onClick={() => syncDevice(device)}
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
          <h3 className="text-lg font-medium">Devices</h3>
          <p className="text-sm text-muted-foreground">
            LoRaWAN devices with OTAA credentials
          </p>
        </div>
        <div className="flex gap-2">
          {/* Provision All to TTN Button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={onProvisionToTTN}
                    disabled={!ttnConfigured || devices.length === 0 || disabled}
                    size="sm"
                    className="gap-1"
                  >
                    <Radio className="h-4 w-4" />
                    Provision All to TTN
                  </Button>
                </span>
              </TooltipTrigger>
              {(!ttnConfigured || devices.length === 0) && (
                <TooltipContent>
                  <p>
                    {devices.length === 0 
                      ? 'Add devices first' 
                      : 'Configure TTN on Webhook tab and pass Test Connection first'}
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          {/* DB-only Smoke Test Button with type dropdown */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        disabled={!canSync || disabled}
                        size="sm"
                        variant="outline"
                        className="gap-1"
                      >
                        <Database className="h-4 w-4" />
                        Write Test Sensor
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => writeTestSensor('temperature')}>
                        <Thermometer className="h-4 w-4 mr-2" />
                        Temperature Sensor
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => writeTestSensor('door')}>
                        <DoorOpen className="h-4 w-4 mr-2" />
                        Door Sensor
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </TooltipTrigger>
              {!canSync && (
                <TooltipContent>
                  <p>Set Organization ID in Testing tab first</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          <Button 
            onClick={() => addDevice('temperature')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Temp
          </Button>
          <Button 
            onClick={() => addDevice('door')} 
            disabled={disabled || gateways.length === 0} 
            size="sm" 
            variant="outline"
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Door
          </Button>
        </div>
      </div>

      {gateways.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Add a gateway first before creating devices
          </CardContent>
        </Card>
      )}

      {devices.length === 0 && gateways.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex gap-4 mb-4">
              <div className="p-3 rounded-full bg-blue-500/10">
                <Thermometer className="h-6 w-6 text-blue-500" />
              </div>
              <div className="p-3 rounded-full bg-orange-500/10">
                <DoorOpen className="h-6 w-6 text-orange-500" />
              </div>
            </div>
            <p className="font-medium">No devices configured</p>
            <p className="text-sm text-muted-foreground">Add temperature or door sensors</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {devices.map(device => (
          <Card key={device.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-md ${device.type === 'temperature' ? 'bg-blue-500/10' : 'bg-orange-500/10'}`}>
                    {device.type === 'temperature' ? (
                      <Thermometer className="h-4 w-4 text-blue-500" />
                    ) : (
                      <DoorOpen className="h-4 w-4 text-orange-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{device.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {device.type === 'temperature' ? 'Temperature' : 'Door'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">Class A</Badge>
                      {ttnProvisionedDevices?.has(device.devEui) && (
                        <Badge variant="outline" className="text-xs text-green-600 border-green-600 gap-1">
                          <Radio className="h-3 w-3" />
                          TTN
                        </Badge>
                      )}
                      {syncedIds.has(device.id) && (
                        <Badge variant="outline" className="text-xs text-blue-600 border-blue-600">
                          Synced
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onShowQR(device)}
                    title="Show QR Code"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                  {webhookConfig?.ttnConfig?.applicationId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => registerInTTN(device)}
                      disabled={disabled || ttnRegistering === device.id}
                      title="Register in TTN"
                    >
                      {ttnRegistering === device.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Radio className="h-4 w-4 text-blue-500" />
                      )}
                    </Button>
                  )}
                  <SyncButton device={device} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => regenerateCredentials(device.id)}
                    disabled={disabled}
                    title="Regenerate credentials"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeDevice(device.id)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Row 1: Name + Gateway */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Device Name</Label>
                  <Input
                    value={device.name}
                    onChange={e => updateDevice(device.id, { name: e.target.value })}
                    disabled={disabled}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Gateway</Label>
                  <Select
                    value={device.gatewayId}
                    onValueChange={gatewayId => updateDevice(device.id, { gatewayId })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select gateway" />
                    </SelectTrigger>
                    <SelectContent>
                      {gateways.map(gw => (
                        <SelectItem key={gw.id} value={gw.id}>
                          {gw.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 1.5: Location - Store/Site + Unit */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium">Location</Label>
                  {getLocationBadge(device)}
                  {assigningId === device.id && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Store/Site Dropdown */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Store / Site</Label>
                    <SiteSelect
                      sites={availableSites || []}
                      selectedSiteId={device.siteId}
                      onSelect={(siteId) => handleSiteChange(device.id, siteId)}
                      disabled={disabled || assigningId === device.id}
                    />
                  </div>
                  
                  {/* Unit Dropdown */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Unit</Label>
                    <UnitSelect
                      units={availableUnits || []}
                      siteId={device.siteId}
                      selectedUnitId={device.unitId}
                      onSelect={(unitId, unit) => handleUnitChange(device.id, unitId, unit)}
                      onCreate={onCreateUnit || (() => {})}
                      disabled={disabled || assigningId === device.id}
                    />
                  </div>
                </div>

                {/* Inline assignment error display with rich details */}
                {assignmentErrors.get(device.id) && (() => {
                  const errorInfo = assignmentErrors.get(device.id)!;
                  return (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="ml-2">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {errorInfo.status_code && `[${errorInfo.status_code}] `}
                            {errorInfo.message}
                          </span>
                          {errorInfo.hint && (
                            <span className="text-xs opacity-80">
                              {errorInfo.hint}
                            </span>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {errorInfo.request_id && (
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-6 px-2 text-xs"
                                onClick={() => {
                                  navigator.clipboard.writeText(errorInfo.request_id || '');
                                  toast({ title: 'Copied', description: 'Request ID copied to clipboard' });
                                }}
                              >
                                <ClipboardCopy className="h-3 w-3 mr-1" />
                                Copy ID
                              </Button>
                            )}
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="h-6 px-2 text-xs"
                              onClick={() => handleRetryAssignment(device.id)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Retry
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="h-6 px-2 text-xs"
                              onClick={handleExportSnapshot}
                            >
                              <Download className="h-3 w-3 mr-1" />
                              Export
                            </Button>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  );
                })()}
              </div>


              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">DevEUI</Label>
                <div className="flex gap-2">
                  <Input
                    value={device.devEui}
                    onChange={e => updateDevice(device.id, { devEui: e.target.value.toUpperCase() })}
                    disabled={disabled}
                    className="font-mono text-sm h-9"
                    maxLength={16}
                  />
                  <CopyButton value={device.devEui} fieldId={`${device.id}-deveui`} />
                </div>
                <p className="text-xs text-muted-foreground">16 hex characters</p>
              </div>

              {/* Row 2.5: TTN Device ID (read-only, canonical format) */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">TTN Device ID</Label>
                <div className="flex gap-2">
                  <Input
                    value={`sensor-${device.devEui.replace(/[:\s-]/g, '').toLowerCase()}`}
                    readOnly
                    className="font-mono text-sm h-9 bg-muted"
                  />
                  <CopyButton 
                    value={`sensor-${device.devEui.replace(/[:\s-]/g, '').toLowerCase()}`} 
                    fieldId={`${device.id}-ttndeviceid`} 
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Use this exact ID when registering in TTN Console
                </p>
              </div>

              {/* Row 3: JoinEUI + AppKey with credential source */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium">OTAA Credentials</Label>
                  {getCredentialSourceBadge(device)}
                  {device.credentialsLockedFromFrostguard && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => unlockCredentials(device.id)}
                          >
                            <Unlock className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Unlock to edit credentials (will lose FrostGuard sync)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">JoinEUI (AppEUI)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={device.joinEui}
                        onChange={e => updateDevice(device.id, { 
                          joinEui: e.target.value.toUpperCase(),
                          credentialSource: 'manual_override',
                          credentialsLockedFromFrostguard: false,
                        })}
                        disabled={disabled || device.credentialsLockedFromFrostguard}
                        readOnly={device.credentialsLockedFromFrostguard}
                        className={cn(
                          "font-mono text-xs h-9",
                          device.credentialsLockedFromFrostguard && "bg-muted cursor-not-allowed"
                        )}
                        maxLength={16}
                        placeholder={!device.joinEui ? "Missing" : undefined}
                      />
                      <CopyButton value={device.joinEui} fieldId={`${device.id}-joineui`} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">AppKey</Label>
                    <div className="flex gap-2">
                      <Input
                        value={device.appKey}
                        onChange={e => updateDevice(device.id, { 
                          appKey: e.target.value.toUpperCase(),
                          credentialSource: 'manual_override',
                          credentialsLockedFromFrostguard: false,
                        })}
                        disabled={disabled || device.credentialsLockedFromFrostguard}
                        readOnly={device.credentialsLockedFromFrostguard}
                        className={cn(
                          "font-mono text-xs h-9",
                          device.credentialsLockedFromFrostguard && "bg-muted cursor-not-allowed"
                        )}
                        maxLength={32}
                        placeholder={!device.appKey ? "Missing" : undefined}
                      />
                      <CopyButton value={device.appKey} fieldId={`${device.id}-appkey`} />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
