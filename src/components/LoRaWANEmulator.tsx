import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Thermometer, Droplets, Battery, Signal, DoorOpen, DoorClosed, 
  Radio, Settings, Activity, FileText, Webhook, FlaskConical,
  ClipboardList, Info
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import EmulatorHeader from './emulator/EmulatorHeader';
import GatewayConfig from './emulator/GatewayConfig';
import WebhookSettings from './emulator/WebhookSettings';
import DeviceManager from './emulator/DeviceManager';
import QRCodeModal from './emulator/QRCodeModal';
import ScenarioPresets, { ScenarioConfig } from './emulator/ScenarioPresets';
import TestContextConfig from './emulator/TestContextConfig';
import TestDashboard from './emulator/TestDashboard';
import TelemetryMonitor from './emulator/TelemetryMonitor';
import TTNProvisioningWizard from './emulator/TTNProvisioningWizard';
import UserSelectionGate, { STORAGE_KEY_USER_CONTEXT } from './emulator/UserSelectionGate';
import UserContextBar from './emulator/UserContextBar';
import DebugTerminal from './emulator/DebugTerminal';
import { 
  GatewayConfig as GatewayConfigType, 
  LoRaWANDevice, 
  WebhookConfig, 
  TestResult,
  SyncResult,
  createGateway, 
  createDevice,
  buildTTNPayload 
} from '@/lib/ttn-payload';
import { assignDeviceToUnit, fetchOrgState, fetchOrgGateways, LocalGateway } from '@/lib/frostguardOrgSync';
import { log } from '@/lib/debugLogger';
import { logTTNSimulateEvent } from '@/lib/supportSnapshot';
import { getCanonicalConfig, setCanonicalConfig, isConfigStale, hasCanonicalConfig, isLocalDirty, canAcceptCanonicalUpdate, clearLocalDirty, logConfigSnapshot } from '@/lib/ttnConfigStore';
import CreateUnitModal from './emulator/CreateUnitModal';

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'temp' | 'door' | 'info' | 'error' | 'webhook';
  message: string;
}

interface TempSensorState {
  minTemp: number;
  maxTemp: number;
  humidity: number;
  batteryLevel: number;
  signalStrength: number;
  intervalSeconds: number;
}

interface DoorSensorState {
  enabled: boolean;
  batteryLevel: number;
  signalStrength: number;
  doorOpen: boolean;
  intervalSeconds: number;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: 'Every 15 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every 1 minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
];

export default function LoRaWANEmulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  const [qrDevice, setQrDevice] = useState<LoRaWANDevice | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [showProvisioningWizard, setShowProvisioningWizard] = useState(false);
  const [provisioningMode, setProvisioningMode] = useState<'devices' | 'gateways'>('devices');
  const [showCreateUnitModal, setShowCreateUnitModal] = useState(false);
  
  // Storage keys for TTN provisioned entities
  const STORAGE_KEY_TTN_PROVISIONED = 'lorawan-emulator-ttn-provisioned';
  const STORAGE_KEY_TTN_PROVISIONED_GATEWAYS = 'lorawan-emulator-ttn-provisioned-gateways';
  
  // Track which devices have been provisioned to TTN
  const [ttnProvisionedDevices, setTtnProvisionedDevices] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TTN_PROVISIONED);
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  // Track which gateways have been provisioned to TTN
  const [ttnProvisionedGateways, setTtnProvisionedGateways] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TTN_PROVISIONED_GATEWAYS);
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set();
      }
    }
    return new Set();
  });
  
  const tempIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const doorIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track consecutive permission errors to auto-stop emulation
  const permissionErrorCountRef = useRef<number>(0);
  const MAX_PERMISSION_ERRORS = 2; // Stop after 2 consecutive permission errors

  // Storage keys for persistence
  const STORAGE_KEY_DEVICES = 'lorawan-emulator-devices';
  const STORAGE_KEY_GATEWAYS = 'lorawan-emulator-gateways';
  const STORAGE_KEY_WEBHOOK = 'lorawan-emulator-webhook';

  // Gateway and device management with localStorage persistence
  const [gateways, setGateways] = useState<GatewayConfigType[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_GATEWAYS);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
    return [createGateway('Primary Gateway')];
  });

  const [devices, setDevices] = useState<LoRaWANDevice[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_DEVICES);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
    const gateway = gateways[0] || createGateway('Primary Gateway');
    return [
      createDevice('Temp Sensor 1', 'temperature', gateway.id),
      createDevice('Door Sensor 1', 'door', gateway.id),
    ];
  });

  // Persist devices and gateways to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DEVICES, JSON.stringify(devices));
  }, [devices]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_GATEWAYS, JSON.stringify(gateways));
  }, [gateways]);

  // Initialize devices with correct gateway ID
  useEffect(() => {
    if (gateways.length > 0 && devices.length > 0) {
      const defaultGatewayId = gateways[0].id;
      const needsUpdate = devices.some(d => !gateways.find(g => g.id === d.gatewayId));
      if (needsUpdate) {
        setDevices(devices.map(d => ({
          ...d,
          gatewayId: gateways.find(g => g.id === d.gatewayId)?.id || defaultGatewayId,
        })));
      }
    }
  }, [gateways]);

  // Webhook configuration with localStorage persistence
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WEBHOOK);
    if (saved) {
      try {
        return { ...JSON.parse(saved), ttnWebhookSecret: null };
      } catch {
        // Fall through to default
      }
    }
    return {
      enabled: false,
      targetUrl: '',
      applicationId: 'frostguard',
      sendToLocal: true,
      ttnWebhookSecret: null,
    };
  });

  // Persist webhook config
  useEffect(() => {
    const { ttnWebhookSecret, ...persistableConfig } = webhookConfig;
    localStorage.setItem(STORAGE_KEY_WEBHOOK, JSON.stringify(persistableConfig));
  }, [webhookConfig]);

  // Persist TTN provisioned devices
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TTN_PROVISIONED, JSON.stringify([...ttnProvisionedDevices]));
  }, [ttnProvisionedDevices]);

  // Persist TTN provisioned gateways
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TTN_PROVISIONED_GATEWAYS, JSON.stringify([...ttnProvisionedGateways]));
  }, [ttnProvisionedGateways]);

  // Load gateways from database when org context changes
  useEffect(() => {
    const loadGatewaysFromDatabase = async () => {
      if (!webhookConfig.testOrgId) return;

      log('ui', 'info', 'LOAD_GATEWAYS_ON_ORG_CHANGE', { org_id: webhookConfig.testOrgId });

      const result = await fetchOrgGateways(webhookConfig.testOrgId);
      if (result.ok && result.gateways.length > 0) {
        // Convert LocalGateway to GatewayConfigType
        const dbGateways: GatewayConfigType[] = result.gateways.map(g => ({
          id: g.id,
          eui: g.eui,
          name: g.name || `Gateway ${g.eui.slice(-4)}`,
          isOnline: g.is_online,
          provisioningStatus: g.status === 'active' ? 'completed' : g.status === 'pending' ? 'pending' : 'failed',
          lastProvisionedAt: g.provisioned_at || undefined,
          lastProvisionError: g.provision_error || undefined,
          ttnGatewayId: g.ttn_gateway_id || undefined,
        }));

        // Merge: use database gateways as base, keep any local-only gateways not in DB
        setGateways(prev => {
          const dbEuis = new Set(dbGateways.map(g => g.eui.toUpperCase()));
          const localOnly = prev.filter(g => !dbEuis.has(g.eui.toUpperCase()));
          return [...dbGateways, ...localOnly];
        });

        // Update provisioned set
        const provisionedEuis = new Set(
          result.gateways
            .filter(g => g.status === 'active')
            .map(g => g.eui.toUpperCase())
        );
        setTtnProvisionedGateways(provisionedEuis);

        log('ui', 'info', 'GATEWAYS_LOADED_FROM_DB', {
          total: result.gateways.length,
          active: provisionedEuis.size,
        });
      }
    };

    loadGatewaysFromDatabase();
  }, [webhookConfig.testOrgId]);

  // Check if TTN is configured and ready
  const isTTNConfigured = !!(
    webhookConfig?.ttnConfig?.applicationId &&
    webhookConfig?.ttnConfig?.enabled
  );

  // Refresh gateways from database - called after provisioning
  const refreshGatewaysFromDatabase = useCallback(async () => {
    if (!webhookConfig.testOrgId) return;

    log('ui', 'info', 'REFRESH_GATEWAYS_FROM_DB', { org_id: webhookConfig.testOrgId });

    const result = await fetchOrgGateways(webhookConfig.testOrgId);
    if (result.ok && result.gateways.length > 0) {
      // Convert LocalGateway to GatewayConfigType
      const dbGateways: GatewayConfigType[] = result.gateways.map(g => ({
        id: g.id,
        eui: g.eui,
        name: g.name || `Gateway ${g.eui.slice(-4)}`,
        isOnline: g.is_online,
        provisioningStatus: g.status === 'active' ? 'completed' : g.status === 'pending' ? 'pending' : 'failed',
        lastProvisionedAt: g.provisioned_at || undefined,
        lastProvisionError: g.provision_error || undefined,
        ttnGatewayId: g.ttn_gateway_id || undefined,
      }));

      // Merge with existing gateways (prefer database version for provisioned ones)
      setGateways(prev => {
        const mergedMap = new Map<string, GatewayConfigType>();

        // Add existing local gateways first
        prev.forEach(g => mergedMap.set(g.eui.toUpperCase(), g));

        // Override with database gateways (authoritative source for provisioned ones)
        dbGateways.forEach(g => {
          const normalizedEui = g.eui.toUpperCase();
          const existing = mergedMap.get(normalizedEui);
          if (existing) {
            // Merge: keep local-only fields, update provisioning status from DB
            mergedMap.set(normalizedEui, {
              ...existing,
              provisioningStatus: g.provisioningStatus,
              lastProvisionedAt: g.lastProvisionedAt,
              lastProvisionError: g.lastProvisionError,
              ttnGatewayId: g.ttnGatewayId,
            });
          } else {
            // New gateway from database
            mergedMap.set(normalizedEui, g);
          }
        });

        return Array.from(mergedMap.values());
      });

      // Update provisioned set based on database status
      const provisionedEuis = new Set(
        result.gateways
          .filter(g => g.status === 'active')
          .map(g => g.eui.toUpperCase())
      );
      setTtnProvisionedGateways(provisionedEuis);

      log('ui', 'info', 'GATEWAYS_REFRESHED_FROM_DB', {
        total: result.gateways.length,
        active: provisionedEuis.size,
      });
    }
  }, [webhookConfig.testOrgId]);

  // Handle provisioning wizard completion
  const handleProvisioningComplete = useCallback(async (results?: Array<{ dev_eui?: string; eui?: string; status: string; error?: string; ttn_gateway_id?: string }>) => {
    if (results) {
      if (provisioningMode === 'devices') {
        const newProvisioned = new Set(ttnProvisionedDevices);
        results.forEach(r => {
          if ((r.status === 'created' || r.status === 'already_exists') && r.dev_eui) {
            newProvisioned.add(r.dev_eui);
          }
        });
        setTtnProvisionedDevices(newProvisioned);
        toast({ title: 'Provisioning Complete', description: 'Devices registered in TTN' });
      } else {
        // Refresh gateway state from database (authoritative source after provisioning)
        await refreshGatewaysFromDatabase();
        toast({ title: 'Provisioning Complete', description: 'Gateways registered in TTN and synced' });
      }
    }
    setShowProvisioningWizard(false);
  }, [provisioningMode, ttnProvisionedDevices, refreshGatewaysFromDatabase]);

  const [tempState, setTempState] = useState<TempSensorState>({
    minTemp: 35,
    maxTemp: 40,
    humidity: 45,
    batteryLevel: 95,
    signalStrength: -65,
    intervalSeconds: 60,
  });

  const [doorState, setDoorState] = useState<DoorSensorState>({
    enabled: true,
    batteryLevel: 90,
    signalStrength: -70,
    doorOpen: false,
    intervalSeconds: 300,
  });

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      type,
      message,
    };
    setLogs(prev => [entry, ...prev].slice(0, 100));
  }, []);

  const addTestResult = useCallback((result: Omit<TestResult, 'id' | 'timestamp'>) => {
    const entry: TestResult = {
      ...result,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    };
    setTestResults(prev => [entry, ...prev].slice(0, 50));
  }, []);

  const addSyncResult = useCallback((result: SyncResult) => {
    setSyncResults(prev => [result, ...prev].slice(0, 20));
  }, []);

  const getActiveDevice = useCallback((type: 'temperature' | 'door') => {
    return devices.find(d => d.type === type);
  }, [devices]);

  const getActiveGateway = useCallback((device?: LoRaWANDevice) => {
    if (!device) return gateways.find(g => g.isOnline);
    return gateways.find(g => g.id === device.gatewayId && g.isOnline);
  }, [gateways]);

  const sendTempReading = useCallback(async () => {
    const device = getActiveDevice('temperature');
    const gateway = getActiveGateway(device);
    
    if (!device) {
      addLog('error', '❌ No temperature sensor configured');
      return;
    }
    
    if (!gateway) {
      addLog('error', '❌ No online gateway available');
      return;
    }

    const temp = tempState.minTemp + Math.random() * (tempState.maxTemp - tempState.minTemp);
    const humidity = tempState.humidity + (Math.random() - 0.5) * 5;
    const battery = Math.max(0, tempState.batteryLevel - Math.random() * 0.1);
    const signal = tempState.signalStrength + (Math.random() - 0.5) * 10;

    setCurrentTemp(temp);
    setTempState(prev => ({ ...prev, batteryLevel: battery }));

    // Build payload with org context
    const payload = {
      temperature: Math.round(temp * 10) / 10,
      humidity: Math.round(humidity * 10) / 10,
      battery_level: Math.round(battery),
      signal_strength: Math.round(signal),
      unit_id: webhookConfig.testUnitId || device.name,
      reading_type: 'scheduled',
      // Multi-tenant context
      org_id: webhookConfig.testOrgId || null,
      site_id: webhookConfig.testSiteId || null,
    };

    let testResult: Omit<TestResult, 'id' | 'timestamp'> = {
      deviceId: device.id,
      deviceType: 'temperature',
      ttnStatus: 'skipped',
      webhookStatus: 'pending',
      dbStatus: 'pending',
      orgApplied: !!webhookConfig.testOrgId,
    };

    try {
      const ttnConfig = webhookConfig.ttnConfig;
      
      // Route through TTN if enabled
      if (ttnConfig?.enabled && ttnConfig.applicationId) {
        // Check centralized config store for canonical values
        const canonicalConfig = getCanonicalConfig();
        
        // Log snapshot before simulation
        logConfigSnapshot('BEFORE_SIMULATE');
        
        // Freshness guard: Check if TTN config is stale or not from canonical source
        // CRITICAL: Don't refresh if locally dirty (user just saved a new key)
        const isLocallyDirty = isLocalDirty();
        const shouldRefresh = 
          !isLocallyDirty && // Never refresh if locally dirty
          (
            canonicalConfig.source === 'UNSET' || // No config at all
            (canonicalConfig.source !== 'FROSTGUARD_CANONICAL' && isConfigStale(5 * 60 * 1000)) || // Stale non-canonical
            !canonicalConfig.apiKeyLast4 // No key
          );
        
        if (isLocallyDirty) {
          log('ttn-sync', 'info', 'TTN_REFRESH_SKIPPED_LOCAL_DIRTY', { 
            source: canonicalConfig.source,
            apiKeyLast4: canonicalConfig.apiKeyLast4 ? `****${canonicalConfig.apiKeyLast4}` : null,
            localSavedAt: canonicalConfig.localSavedAt,
            reason: 'User recently saved a new key locally',
          });
        }
        
        if (shouldRefresh && webhookConfig.testOrgId) {
          log('ttn-sync', 'info', 'TTN_CONFIG_STALE_OR_NOT_CANONICAL', { 
            source: canonicalConfig.source,
            isStale: isConfigStale(5 * 60 * 1000),
            has_key_last4: !!canonicalConfig.apiKeyLast4,
            orgId: webhookConfig.testOrgId,
          });
          
          // Auto-refresh from FrostGuard
          const pullResult = await fetchOrgState(webhookConfig.testOrgId);
          if (pullResult.ok && pullResult.data?.ttn) {
            const fgTtn = pullResult.data.ttn;
            
            // Check if we can accept this canonical update
            const canUpdate = canAcceptCanonicalUpdate(fgTtn.updated_at, fgTtn.api_key_last4);
            
            if (canUpdate) {
              log('ttn-sync', 'info', 'TTN_CONFIG_REFRESHED_FOR_SIMULATE', {
                api_key_last4: fgTtn.api_key_last4 ? `****${fgTtn.api_key_last4}` : null,
                source: 'FROSTGUARD_CANONICAL',
              });
              
              // Update the centralized store
              setCanonicalConfig({
                enabled: fgTtn.enabled,
                cluster: fgTtn.cluster,
                applicationId: fgTtn.application_id,
                apiKeyLast4: fgTtn.api_key_last4 || null,
                webhookSecretLast4: fgTtn.webhook_secret_last4 || null,
                updatedAt: new Date().toISOString(),
                source: 'FROSTGUARD_CANONICAL',
                orgId: webhookConfig.testOrgId,
                userId: webhookConfig.selectedUserId || null,
                localDirty: false,
                localSavedAt: null,
              });
              
              // Clear dirty flag since canonical now matches
              clearLocalDirty();
              
              // Update the webhook config with fresh TTN settings
              setWebhookConfig(prev => ({
                ...prev,
                ttnConfig: {
                  ...prev.ttnConfig,
                  enabled: fgTtn.enabled,
                  applicationId: fgTtn.application_id,
                  cluster: fgTtn.cluster as 'eu1' | 'nam1',
                  api_key_last4: fgTtn.api_key_last4,
                  updated_at: new Date().toISOString(),
                },
              }));
            } else {
              log('ttn-sync', 'warn', 'TTN_CANONICAL_UPDATE_REJECTED', {
                reason: 'Local config is newer or different',
                local_key_last4: canonicalConfig.apiKeyLast4 ? `****${canonicalConfig.apiKeyLast4}` : null,
                canonical_key_last4: fgTtn.api_key_last4 ? `****${fgTtn.api_key_last4}` : null,
                local_saved_at: canonicalConfig.localSavedAt,
                canonical_updated_at: fgTtn.updated_at,
              });
            }
          } else if (!canonicalConfig.apiKeyLast4 && !ttnConfig.api_key_last4) {
            // Can't proceed without a key
            addLog('error', '❌ TTN API key not configured. Save TTN settings first.');
            toast({
              title: 'TTN Not Configured',
              description: 'Please save TTN settings before simulating.',
              variant: 'destructive',
            });
            return;
          }
        }
        
        // Log which config source is being used
        const configToUse = hasCanonicalConfig() ? getCanonicalConfig() : null;
        log('ttn-sync', 'info', 'TTN_CONFIG_USED_FOR_CALL', {
          source: configToUse?.source || 'PROPS_FALLBACK',
          apiKeyLast4: configToUse?.apiKeyLast4 || ttnConfig.api_key_last4 || null,
          cluster: configToUse?.cluster || ttnConfig.cluster,
          applicationId: configToUse?.applicationId || ttnConfig.applicationId,
        });
        
        // Use canonical device_id format: sensor-{normalized_deveui}
        const normalizedDevEui = device.devEui.replace(/[:\s-]/g, '').toLowerCase();
        const deviceId = `sensor-${normalizedDevEui}`;
        
        // Log request to debug terminal
        log('ttn-preflight', 'info', 'TTN_WEBHOOK_FORWARD_REQUEST', {
          deviceId,
          devEui: device.devEui,
          applicationId: ttnConfig.applicationId,
          fPort: 1,
        });

        const webhookHeaders = webhookConfig.ttnWebhookSecret
          ? { 'x-ttn-webhook-secret': webhookConfig.ttnWebhookSecret }
          : undefined;

        const { data, error } = await supabase.functions.invoke('ttn-webhook-forward', {
          body: {
            org_id: webhookConfig.testOrgId, // Pass org for settings lookup
            selected_user_id: webhookConfig.selectedUserId, // Pass user for TTN settings lookup
            applicationId: ttnConfig.applicationId,
            deviceId,
            devEui: device.devEui,
            decodedPayload: payload,
            fPort: 1, // Temperature readings on port 1
          },
          headers: webhookHeaders,
        });

        // Handle Supabase invoke error (network, etc)
        if (error) {
          // Try to extract detailed error info from the error context
          const errorContext = (error as any).context;
          let errorDetails = {
            message: error.message || 'Unknown error',
            errorType: 'invoke_error',
            hint: 'Check network connection and Edge Function logs.',
          };
          
          // If context has response body, parse it
          if (errorContext?.body) {
            try {
              const bodyData = typeof errorContext.body === 'string' 
                ? JSON.parse(errorContext.body) 
                : errorContext.body;
              errorDetails = {
                message: bodyData.error || bodyData.message || error.message,
                errorType: bodyData.errorType || 'invoke_error',
                hint: bodyData.hint,
                ...bodyData,
              };
            } catch {
              // Body wasn't JSON, use raw message
            }
          }
          
          log('ttn-preflight', 'error', 'TTN_WEBHOOK_FORWARD_INVOKE_ERROR', {
            error: errorDetails.message,
            errorType: errorDetails.errorType,
            hint: errorDetails.hint,
            originalError: error.message,
          });
          
          // Show actionable error message
          toast({
            title: 'Webhook Forward Failed',
            description: `${errorDetails.message}${errorDetails.hint ? ` - ${errorDetails.hint}` : ''}`,
            variant: 'destructive',
          });
          
          throw new Error(errorDetails.message);
        }

        // Handle TTN-level error (API returned non-success)
        if (data && !data.ok) {
          const ttnError = {
            message: data.error || 'Webhook forward error',
            hint: data.hint,
            errorType: data.errorType,
            status: data.status,
            requiredRights: data.requiredRights,
            requestId: data.request_id,
          };

          log('ttn-preflight', 'error', 'TTN_WEBHOOK_FORWARD_ERROR', {
            error: ttnError.message,
            hint: ttnError.hint,
            errorType: ttnError.errorType,
            status: ttnError.status,
            required_rights: ttnError.requiredRights,
            request_id: ttnError.requestId,
          });

          // Log to snapshot history
          logTTNSimulateEvent({
            timestamp: new Date().toISOString(),
            device_id: deviceId,
            application_id: ttnConfig.applicationId,
            status: 'error',
            status_code: ttnError.status,
            request_id: ttnError.requestId,
            error_type: ttnError.errorType,
            error: ttnError.message,
            hint: ttnError.hint,
            required_rights: ttnError.requiredRights,
          });

          // Track permission errors for auto-stop
          if (ttnError.errorType === 'permission_error') {
            permissionErrorCountRef.current += 1;

            // Auto-stop emulation after repeated permission errors
            if (permissionErrorCountRef.current >= MAX_PERMISSION_ERRORS && isRunning) {
              addLog('error', '🛑 Stopping emulation due to repeated API key permission errors');
              addLog('error', '💡 Fix: Edit your API key in TTN Console and add "Write downlink application traffic" permission');

              // Stop emulation asynchronously to avoid calling setState during render
              setTimeout(() => {
                setIsRunning(false);
                if (tempIntervalRef.current) clearInterval(tempIntervalRef.current);
                if (doorIntervalRef.current) clearInterval(doorIntervalRef.current);
                addLog('info', '⏹️ Emulation stopped due to permission errors');
              }, 0);

              toast({
                title: 'Emulation Stopped',
                description: 'API key lacks required permissions. Please update your TTN API key.',
                variant: 'destructive',
              });
            }
          }

          // Show actionable hint in logs
          if (ttnError.hint) {
            addLog('error', `💡 ${ttnError.hint}`);
          }

          // Show rich error toast for permission errors (only first time)
          if (ttnError.errorType === 'permission_error' && permissionErrorCountRef.current === 1) {
            toast({
              title: 'TTN Permission Error',
              description: `${ttnError.message}. ${ttnError.hint || ''}`,
              variant: 'destructive',
            });
          }

          throw new Error(ttnError.message);
        }

        // Reset permission error counter on success
        permissionErrorCountRef.current = 0;

        // Log success
        log('ttn-preflight', 'info', 'TTN_WEBHOOK_FORWARD_SUCCESS', {
          deviceId,
          applicationId: data?.applicationId || ttnConfig.applicationId,
          settingsSource: data?.settingsSource,
        });
        
        // Log to snapshot history
        logTTNSimulateEvent({
          timestamp: new Date().toISOString(),
          device_id: deviceId,
          application_id: data?.applicationId || ttnConfig.applicationId,
          status: 'success',
          request_id: data?.request_id,
          settings_source: data?.settingsSource,
        });
        
        testResult.ttnStatus = 'success';
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        testResult.uplinkPath = 'webhook-forward';
        addLog('webhook', `📤 Sent via webhook-forward → ${ttnConfig.applicationId}`);
      } 
      // Send to external webhook if configured
      else if (webhookConfig.enabled && webhookConfig.targetUrl) {
        testResult.ttnStatus = 'skipped';
        testResult.uplinkPath = 'external-webhook';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const response = await fetch(webhookConfig.targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify(ttnPayload),
        });
        
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 TTN payload sent to external webhook`);
      } 
      // Default: use local ttn-webhook function
      else {
        testResult.ttnStatus = 'skipped';
        testResult.uplinkPath = 'local-webhook';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const { error } = await supabase.functions.invoke('ttn-webhook', {
          body: ttnPayload,
        });

        if (error) throw error;
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 Sent via local ttn-webhook`);
      }

      setReadingCount(prev => prev + 1);
      addLog('temp', `📡 Temp: ${temp.toFixed(1)}°F, Humidity: ${humidity.toFixed(1)}%, Battery: ${battery.toFixed(0)}%`);
    } catch (err: any) {
      testResult.webhookStatus = 'failed';
      testResult.dbStatus = 'failed';
      testResult.error = err.message;
      addLog('error', `❌ Failed to send temp reading: ${err.message}`);
      toast({
        title: 'Error sending reading',
        description: err.message,
        variant: 'destructive',
      });
    }

    addTestResult(testResult);
  }, [tempState, webhookConfig, addLog, addTestResult, getActiveDevice, getActiveGateway]);

  const sendDoorEvent = useCallback(async (status?: 'open' | 'closed') => {
    if (!doorState.enabled) return;

    const device = getActiveDevice('door');
    const gateway = getActiveGateway(device);

    if (!device) {
      // Only log as info since door sensor might intentionally not be configured
      addLog('info', '📋 Door sensor not configured - skipping door event');
      return;
    }
    
    if (!gateway) {
      addLog('error', '❌ No online gateway available');
      return;
    }

    const doorStatus = status ?? (doorState.doorOpen ? 'open' : 'closed');
    const battery = Math.max(0, doorState.batteryLevel - Math.random() * 0.05);
    const signal = doorState.signalStrength + (Math.random() - 0.5) * 10;

    setDoorState(prev => ({ ...prev, batteryLevel: battery }));

    // Build payload with org context
    const payload = {
      door_status: doorStatus,
      battery_level: Math.round(battery),
      signal_strength: Math.round(signal),
      unit_id: webhookConfig.testUnitId || device.name,
      // Multi-tenant context
      org_id: webhookConfig.testOrgId || null,
      site_id: webhookConfig.testSiteId || null,
    };

    let testResult: Omit<TestResult, 'id' | 'timestamp'> = {
      deviceId: device.id,
      deviceType: 'door',
      ttnStatus: 'skipped',
      webhookStatus: 'pending',
      dbStatus: 'pending',
      orgApplied: !!webhookConfig.testOrgId,
    };

    try {
      const ttnConfig = webhookConfig.ttnConfig;
      
      // Route through TTN if enabled
      if (ttnConfig?.enabled && ttnConfig.applicationId) {
        // Use canonical device_id format: sensor-{normalized_deveui}
        const normalizedDevEui = device.devEui.replace(/[:\s-]/g, '').toLowerCase();
        const deviceId = `sensor-${normalizedDevEui}`;
        
        // Log request to debug terminal
        log('ttn-preflight', 'info', 'TTN_WEBHOOK_FORWARD_REQUEST', {
          deviceId,
          devEui: device.devEui,
          applicationId: ttnConfig.applicationId,
          fPort: 2,
        });

        const webhookHeaders = webhookConfig.ttnWebhookSecret
          ? { 'x-ttn-webhook-secret': webhookConfig.ttnWebhookSecret }
          : undefined;

        const { data, error } = await supabase.functions.invoke('ttn-webhook-forward', {
          body: {
            org_id: webhookConfig.testOrgId, // Pass org for settings lookup
            selected_user_id: webhookConfig.selectedUserId, // Pass user for TTN settings lookup
            applicationId: ttnConfig.applicationId,
            deviceId,
            devEui: device.devEui,
            decodedPayload: payload,
            fPort: 2, // Door events on port 2
          },
          headers: webhookHeaders,
        });

        // Handle Supabase invoke error (network, etc)
        if (error) {
          log('ttn-preflight', 'error', 'TTN_WEBHOOK_FORWARD_INVOKE_ERROR', {
            error: error.message,
            errorType: 'invoke_error',
          });
          throw error;
        }
        
        // Handle TTN-level error (API returned non-success)
        if (data && !data.ok) {
          const ttnError = {
            message: data.error || 'Webhook forward error',
            hint: data.hint,
            errorType: data.errorType,
            status: data.status,
            requiredRights: data.requiredRights,
            requestId: data.request_id,
          };
          
          log('ttn-preflight', 'error', 'TTN_WEBHOOK_FORWARD_ERROR', {
            error: ttnError.message,
            hint: ttnError.hint,
            errorType: ttnError.errorType,
            status: ttnError.status,
            required_rights: ttnError.requiredRights,
            request_id: ttnError.requestId,
          });
          
          // Log to snapshot history
          logTTNSimulateEvent({
            timestamp: new Date().toISOString(),
            device_id: deviceId,
            application_id: ttnConfig.applicationId,
            status: 'error',
            status_code: ttnError.status,
            request_id: ttnError.requestId,
            error_type: ttnError.errorType,
            error: ttnError.message,
            hint: ttnError.hint,
            required_rights: ttnError.requiredRights,
          });
          
          // Show actionable hint in logs
          if (ttnError.hint) {
            addLog('error', `💡 ${ttnError.hint}`);
          }
          
          // Show rich error toast for permission errors
          if (ttnError.errorType === 'permission_error') {
            toast({
              title: 'TTN Permission Error',
              description: `${ttnError.message}. ${ttnError.hint || ''}`,
              variant: 'destructive',
            });
          }
          
          throw new Error(ttnError.message);
        }
        
        // Log success
        log('ttn-preflight', 'info', 'TTN_WEBHOOK_FORWARD_SUCCESS', {
          deviceId,
          applicationId: data?.applicationId || ttnConfig.applicationId,
          settingsSource: data?.settingsSource,
        });
        
        // Log to snapshot history
        logTTNSimulateEvent({
          timestamp: new Date().toISOString(),
          device_id: deviceId,
          application_id: data?.applicationId || ttnConfig.applicationId,
          status: 'success',
          request_id: data?.request_id,
          settings_source: data?.settingsSource,
        });
        
        testResult.ttnStatus = 'success';
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        testResult.uplinkPath = 'webhook-forward';
        addLog('webhook', `📤 Door event sent via webhook-forward → ${ttnConfig.applicationId}`);
      }
      // Send to external webhook if configured
      else if (webhookConfig.enabled && webhookConfig.targetUrl) {
        testResult.ttnStatus = 'skipped';
        testResult.uplinkPath = 'external-webhook';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const response = await fetch(webhookConfig.targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify(ttnPayload),
        });
        
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 Door event sent via external webhook`);
      } 
      // Default: use local ttn-webhook function
      else {
        testResult.ttnStatus = 'skipped';
        testResult.uplinkPath = 'local-webhook';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const { error } = await supabase.functions.invoke('ttn-webhook', {
          body: ttnPayload,
        });

        if (error) throw error;
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 Door event sent via local ttn-webhook`);
      }

      addLog('door', `🚪 Door ${doorStatus === 'open' ? 'OPENED' : 'CLOSED'} - Battery: ${battery.toFixed(0)}%`);
    } catch (err: any) {
      testResult.webhookStatus = 'failed';
      testResult.dbStatus = 'failed';
      testResult.error = err.message;
      addLog('error', `❌ Failed to send door event: ${err.message}`);
      toast({
        title: 'Error sending door event',
        description: err.message,
        variant: 'destructive',
      });
    }

    addTestResult(testResult);
  }, [doorState, webhookConfig, addLog, addTestResult, getActiveDevice, getActiveGateway]);

  const toggleDoor = useCallback(() => {
    const newStatus = !doorState.doorOpen;
    setDoorState(prev => ({ ...prev, doorOpen: newStatus }));
    sendDoorEvent(newStatus ? 'open' : 'closed');
  }, [doorState.doorOpen, sendDoorEvent]);

  // Preflight check: validate TTN configuration and API key permissions before starting
  const runPreflightCheck = useCallback(async (): Promise<{ ok: boolean; error?: string; hint?: string }> => {
    const ttnConfig = webhookConfig.ttnConfig;

    // Skip preflight if TTN is not enabled
    if (!ttnConfig?.enabled || !ttnConfig.applicationId) {
      return { ok: true }; // No TTN config, proceed with local webhook
    }

    // Check if user is selected
    if (!webhookConfig.selectedUserId) {
      return {
        ok: false,
        error: 'No user selected',
        hint: 'Please select a user from the user selector to forward emulator uplinks.',
      };
    }

    // Get devices to check
    const devicesToCheck = devices
      .filter(d => d.devEui)
      .map(d => ({ dev_eui: d.devEui, name: d.name }));

    try {
      addLog('info', '🔍 Running TTN preflight check...');

      const { data, error } = await supabase.functions.invoke('ttn-preflight', {
        body: {
          selected_user_id: webhookConfig.selectedUserId,
          org_id: webhookConfig.testOrgId,
          devices: devicesToCheck,
        },
      });

      if (error) {
        return {
          ok: false,
          error: `Preflight check failed: ${error.message}`,
          hint: 'Check your network connection and try again.',
        };
      }

      if (!data.ok) {
        // Check for specific error types
        if (data.application && !data.application.exists) {
          const appError = data.application.error || 'Application not found';
          // Check if it's a permission error
          if (appError.includes('permission') || appError.includes('403')) {
            return {
              ok: false,
              error: `API key permission error: ${appError}`,
              hint: 'Your API key may not have the required permissions. Edit your API key in TTN Console and add: "Read application traffic" and "Write downlink application traffic".',
            };
          }
          return {
            ok: false,
            error: appError,
            hint: `Verify the application ID "${data.application.id}" exists on cluster "${data.cluster}".`,
          };
        }

        // Cluster mismatch
        if (data.cluster_mismatch) {
          return {
            ok: false,
            error: `Cluster mismatch: configured "${data.cluster_mismatch.configured_cluster}" but detected "${data.cluster_mismatch.detected_cluster}"`,
            hint: data.cluster_mismatch.hint,
          };
        }

        // Unregistered devices - this is a warning, not a blocker
        if (data.unregistered_count > 0) {
          addLog('info', `⚠️ ${data.unregistered_count} device(s) not registered in TTN - uplinks may be dropped`);
          // Continue anyway - uplinks may still be forwarded
        }
      }

      addLog('info', '✅ TTN preflight check passed');
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: `Preflight check error: ${err.message}`,
        hint: 'Check your network connection and try again.',
      };
    }
  }, [webhookConfig, devices, addLog]);

  const startEmulation = useCallback(async () => {
    // Reset permission error counter on fresh start
    permissionErrorCountRef.current = 0;

    // Run preflight check if TTN is enabled
    const ttnConfig = webhookConfig.ttnConfig;
    if (ttnConfig?.enabled && ttnConfig.applicationId) {
      const preflight = await runPreflightCheck();
      if (!preflight.ok) {
        addLog('error', `❌ ${preflight.error}`);
        if (preflight.hint) {
          addLog('error', `💡 ${preflight.hint}`);
        }
        toast({
          title: 'Cannot Start Emulation',
          description: preflight.error,
          variant: 'destructive',
        });
        return; // Don't start emulation if preflight fails
      }
    }

    setIsRunning(true);
    addLog('info', '▶️ Emulation started');

    // Send initial readings
    sendTempReading();
    if (doorState.enabled) {
      sendDoorEvent();
    }

    // Set up intervals
    tempIntervalRef.current = setInterval(sendTempReading, tempState.intervalSeconds * 1000);

    if (doorState.enabled) {
      doorIntervalRef.current = setInterval(() => sendDoorEvent(), doorState.intervalSeconds * 1000);
    }
  }, [tempState.intervalSeconds, doorState, sendTempReading, sendDoorEvent, addLog, webhookConfig, runPreflightCheck]);

  const stopEmulation = useCallback(() => {
    setIsRunning(false);
    if (tempIntervalRef.current) clearInterval(tempIntervalRef.current);
    if (doorIntervalRef.current) clearInterval(doorIntervalRef.current);
    addLog('info', '⏹️ Emulation stopped');
  }, [addLog]);

  useEffect(() => {
    return () => {
      if (tempIntervalRef.current) clearInterval(tempIntervalRef.current);
      if (doorIntervalRef.current) clearInterval(doorIntervalRef.current);
    };
  }, []);

  const applyScenario = (scenario: ScenarioConfig) => {
    if (scenario.tempRange) {
      setTempState(prev => ({
        ...prev,
        minTemp: scenario.tempRange!.min,
        maxTemp: scenario.tempRange!.max,
        humidity: scenario.humidity ?? prev.humidity,
        batteryLevel: scenario.batteryLevel ?? prev.batteryLevel,
        signalStrength: scenario.signalStrength ?? prev.signalStrength,
      }));
    }
    if (scenario.doorBehavior === 'stuck-open') {
      setDoorState(prev => ({ ...prev, doorOpen: true }));
    }
    addLog('info', `🎛️ Applied "${scenario.name}" scenario`);
    toast({ title: 'Scenario applied', description: scenario.description });
  };

  const tempDevice = getActiveDevice('temperature');
  const doorDevice = getActiveDevice('door');

  const getLogBadgeVariant = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return 'destructive';
      case 'webhook': return 'default';
      case 'temp': return 'secondary';
      case 'door': return 'outline';
      default: return 'secondary';
    }
  };

  const getLogBadgeLabel = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return 'ERR';
      case 'webhook': return 'TX';
      case 'temp': return 'TEMP';
      case 'door': return 'DOOR';
      default: return 'INFO';
    }
  };

  // Clear user context handler
  const handleClearContext = useCallback(() => {
    console.log('[LoRaWANEmulator] Clearing user context');
    sessionStorage.removeItem(STORAGE_KEY_USER_CONTEXT);
    // Reset webhookConfig to clear user context fields
    setWebhookConfig(prev => ({
      ...prev,
      testOrgId: undefined,
      testSiteId: undefined,
      selectedUserId: undefined,
      selectedUserDisplayName: undefined,
      selectedUserSites: undefined,
      ttnConfig: undefined,
      ttnWebhookSecret: undefined,
      contextSetAt: undefined,
      isHydrated: false,
      lastSyncAt: undefined,
      lastSyncRunId: undefined,
      lastSyncSummary: undefined,
    }));
    // Force page reload to show the gate
    window.location.reload();
  }, []);

  // Handle device unit assignment
  const handleAssignDeviceUnit = useCallback(async (
    deviceId: string, 
    unitId: string | undefined, 
    siteId: string | undefined
  ) => {
    if (!webhookConfig.testOrgId) {
      throw new Error('No organization context');
    }
    
    const result = await assignDeviceToUnit(
      webhookConfig.testOrgId,
      deviceId,
      unitId,
      siteId
    );
    
    if (!result.ok) {
      // Create enriched error with full details from errorDetails
      const enrichedError = new Error(result.error || 'Assignment failed') as Error & {
        status_code?: number;
        hint?: string;
        request_id?: string;
        error_code?: string;
      };
      if (result.errorDetails) {
        enrichedError.status_code = result.errorDetails.status_code;
        enrichedError.hint = result.errorDetails.hint;
        enrichedError.request_id = result.errorDetails.request_id;
        enrichedError.error_code = result.errorDetails.error_code;
      }
      throw enrichedError;
    }
    
    // Re-pull org state to confirm the change from FrostGuard
    const orgResult = await fetchOrgState(webhookConfig.testOrgId);
    if (orgResult.ok && orgResult.data) {
      // Update devices with new assignments from FrostGuard
      const updatedDevices = devices.map(device => {
        const sensor = orgResult.data!.sensors?.find(s => s.id === device.id);
        if (sensor) {
          return {
            ...device,
            siteId: sensor.site_id,
            unitId: sensor.unit_id,
          };
        }
        return device;
      });
      setDevices(updatedDevices);
      
      // Update units list
      if (orgResult.data.units) {
        setWebhookConfig(prev => ({
          ...prev,
          availableUnits: orgResult.data!.units?.map(u => ({
            id: u.id,
            name: u.name,
            site_id: u.site_id,
            description: u.description,
            location: u.location,
            created_at: u.created_at,
          })),
        }));
      }
    }
  }, [webhookConfig.testOrgId, devices, setDevices, setWebhookConfig]);

  // Handle unit creation and refresh
  const handleCreateUnit = useCallback(async (
    siteId: string,
    name: string,
    description?: string,
    location?: string
  ) => {
    // This is handled by CreateUnitModal which calls createUnitInFrostGuard
    // After success, we need to refresh the org state to get the new unit
    if (webhookConfig.testOrgId) {
      const orgResult = await fetchOrgState(webhookConfig.testOrgId);
      if (orgResult.ok && orgResult.data?.units) {
        setWebhookConfig(prev => ({
          ...prev,
          availableUnits: orgResult.data!.units?.map(u => ({
            id: u.id,
            name: u.name,
            site_id: u.site_id,
            description: u.description,
            location: u.location,
            created_at: u.created_at,
          })),
        }));
      }
    }
  }, [webhookConfig.testOrgId, setWebhookConfig]);

  return (
    <UserSelectionGate
      config={webhookConfig}
      onConfigChange={setWebhookConfig}
      gateways={gateways}
      devices={devices}
      onGatewaysChange={setGateways}
      onDevicesChange={setDevices}
    >
      <div className="flex flex-col min-h-screen">
        <EmulatorHeader
          isRunning={isRunning}
          readingCount={readingCount}
          webhookConfig={webhookConfig}
          onStartEmulation={startEmulation}
          onStopEmulation={stopEmulation}
          onSingleReading={sendTempReading}
        />

        <main className="flex-1 p-6">
          {/* User Context Bar - read-only display with change option */}
          <UserContextBar
            config={webhookConfig}
            onClearContext={handleClearContext}
            disabled={isRunning}
          />

          <Tabs defaultValue="sensors" className="w-full">
            <TabsList className="grid w-full grid-cols-7 mb-6">
              <TabsTrigger value="sensors" className="gap-2">
                <Thermometer className="h-4 w-4" />
                <span className="hidden sm:inline">Sensors</span>
              </TabsTrigger>
              <TabsTrigger value="gateways" className="gap-2">
                <Radio className="h-4 w-4" />
                <span className="hidden sm:inline">Gateways</span>
              </TabsTrigger>
              <TabsTrigger value="devices" className="gap-2">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Devices</span>
              </TabsTrigger>
              <TabsTrigger value="webhook" className="gap-2">
                <Webhook className="h-4 w-4" />
                <span className="hidden sm:inline">Webhook</span>
              </TabsTrigger>
              <TabsTrigger value="testing" className="gap-2">
                <FlaskConical className="h-4 w-4" />
                <span className="hidden sm:inline">Testing</span>
              </TabsTrigger>
              <TabsTrigger value="monitor" className="gap-2">
                <Activity className="h-4 w-4" />
                <span className="hidden sm:inline">Monitor</span>
              </TabsTrigger>
              <TabsTrigger value="logs" className="gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Logs</span>
              </TabsTrigger>
            </TabsList>

          {/* Sensors Tab */}
          <TabsContent value="sensors" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Temperature Sensor Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Thermometer className="h-4 w-4 text-blue-500" />
                    Temperature Sensor Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-sm">Temperature Range</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        value={tempState.minTemp}
                        onChange={e => setTempState(prev => ({ ...prev, minTemp: Number(e.target.value) }))}
                        disabled={isRunning}
                        className="w-20 h-9 text-center"
                      />
                      <div className="flex-1">
                        <Slider
                          value={[tempState.minTemp, tempState.maxTemp]}
                          min={-20}
                          max={80}
                          step={1}
                          onValueChange={([min, max]) => setTempState(prev => ({ ...prev, minTemp: min, maxTemp: max }))}
                          disabled={isRunning}
                        />
                      </div>
                      <Input
                        type="number"
                        value={tempState.maxTemp}
                        onChange={e => setTempState(prev => ({ ...prev, maxTemp: Number(e.target.value) }))}
                        disabled={isRunning}
                        className="w-20 h-9 text-center"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      {tempState.minTemp}°F — {tempState.maxTemp}°F
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm flex items-center gap-2">
                        <Droplets className="h-3 w-3" />
                        Humidity
                      </Label>
                      <span className="text-sm font-medium">{tempState.humidity}%</span>
                    </div>
                    <Slider
                      value={[tempState.humidity]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={([v]) => setTempState(prev => ({ ...prev, humidity: v }))}
                      disabled={isRunning}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Reading Interval</Label>
                    <Select
                      value={String(tempState.intervalSeconds)}
                      onValueChange={(v) => setTempState(prev => ({ ...prev, intervalSeconds: Number(v) }))}
                      disabled={isRunning}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INTERVAL_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Door Sensor Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <DoorOpen className="h-4 w-4 text-orange-500" />
                      Door Sensor Settings
                    </CardTitle>
                    <Switch
                      checked={doorState.enabled}
                      onCheckedChange={enabled => setDoorState(prev => ({ ...prev, enabled }))}
                      disabled={isRunning}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {doorState.enabled ? (
                    <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Status Interval</Label>
                          <span className="text-sm font-medium">{doorState.intervalSeconds}s</span>
                        </div>
                        <Slider
                          value={[doorState.intervalSeconds]}
                          min={30}
                          max={600}
                          step={30}
                          onValueChange={([v]) => setDoorState(prev => ({ ...prev, intervalSeconds: v }))}
                          disabled={isRunning}
                        />
                      </div>

                      <div className="flex flex-col items-center gap-4 py-4">
                        <div className={`text-4xl font-bold ${doorState.doorOpen ? 'text-destructive' : 'text-green-500'}`}>
                          {doorState.doorOpen ? 'OPEN' : 'CLOSED'}
                        </div>
                        <Button
                          variant={doorState.doorOpen ? 'destructive' : 'outline'}
                          onClick={toggleDoor}
                          className="gap-2"
                        >
                          {doorState.doorOpen ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
                          {doorState.doorOpen ? 'Close Door' : 'Open Door'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <DoorClosed className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground">Door sensor disabled</p>
                      <p className="text-xs text-muted-foreground">Enable to configure settings</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Scenario Presets */}
            <Card>
              <CardContent className="pt-6">
                <ScenarioPresets onApply={applyScenario} disabled={isRunning} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Gateways Tab */}
          <TabsContent value="gateways">
            <GatewayConfig
              gateways={gateways}
              onGatewaysChange={setGateways}
              disabled={isRunning}
              webhookConfig={webhookConfig}
              ttnConfigured={isTTNConfigured}
              ttnProvisionedGateways={ttnProvisionedGateways}
              onProvisionToTTN={() => {
                setProvisioningMode('gateways');
                setShowProvisioningWizard(true);
              }}
            />
          </TabsContent>

          {/* Devices Tab */}
          <TabsContent value="devices">
            <DeviceManager
              devices={devices}
              gateways={gateways}
              onDevicesChange={setDevices}
              onShowQR={setQrDevice}
              disabled={isRunning}
              webhookConfig={webhookConfig}
              ttnConfigured={isTTNConfigured}
              ttnProvisionedDevices={ttnProvisionedDevices}
              onProvisionToTTN={() => {
                setProvisioningMode('devices');
                setShowProvisioningWizard(true);
              }}
              availableUnits={webhookConfig.availableUnits}
              availableSites={webhookConfig.selectedUserSites}
              onAssignUnit={handleAssignDeviceUnit}
              onCreateUnit={() => setShowCreateUnitModal(true)}
            />
          </TabsContent>

          {/* Webhook Tab */}
          <TabsContent value="webhook">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <WebhookSettings
                  config={webhookConfig}
                  onConfigChange={setWebhookConfig}
                  disabled={isRunning}
                  currentDevEui={tempDevice?.devEui}
                  orgId={webhookConfig.testOrgId}
                  devices={devices}
                />
              </div>
              <div>
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Live Telemetry
                </h3>
                <TelemetryMonitor
                  orgId={webhookConfig.testOrgId}
                  unitId={webhookConfig.testUnitId}
                  localState={{
                    currentTemp,
                    humidity: tempState.humidity,
                    doorOpen: doorState.doorOpen,
                    batteryLevel: tempState.batteryLevel,
                    signalStrength: tempState.signalStrength,
                  }}
                />
              </div>
            </div>
          </TabsContent>

          {/* Testing Tab */}
          <TabsContent value="testing" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <TestContextConfig
                  config={webhookConfig}
                  onConfigChange={setWebhookConfig}
                  disabled={isRunning}
                  gateways={gateways}
                  devices={devices}
                />
                <TestDashboard
                  results={testResults}
                  syncResults={syncResults}
                  onClearResults={() => {
                    setTestResults([]);
                    setSyncResults([]);
                  }}
                />
              </div>
              <div>
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Live Telemetry
                </h3>
                <TelemetryMonitor
                  orgId={webhookConfig.testOrgId}
                  unitId={webhookConfig.testUnitId}
                  localState={{
                    currentTemp,
                    humidity: tempState.humidity,
                    doorOpen: doorState.doorOpen,
                    batteryLevel: tempState.batteryLevel,
                    signalStrength: tempState.signalStrength,
                  }}
                />
              </div>
            </div>
          </TabsContent>

          {/* Monitor Tab - Database-Driven Telemetry */}
          <TabsContent value="monitor">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Database Telemetry (when org context is set) */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4" />
                  <h3 className="font-medium">Live Telemetry</h3>
                  {webhookConfig.testOrgId && (
                    <Badge variant="outline" className="text-xs">
                      Org: {webhookConfig.testOrgId.slice(0, 8)}...
                    </Badge>
                  )}
                </div>
                <TelemetryMonitor
                  orgId={webhookConfig.testOrgId}
                  unitId={webhookConfig.testUnitId}
                  localState={{
                    currentTemp,
                    humidity: tempState.humidity,
                    doorOpen: doorState.doorOpen,
                    batteryLevel: tempState.batteryLevel,
                    signalStrength: tempState.signalStrength,
                  }}
                />
              </div>

              {/* Local Emulator State (always visible) */}
              <div className="bg-slate-900 rounded-lg p-6 space-y-6">
                <div className="flex items-center gap-2 mb-2">
                  <Radio className="h-4 w-4 text-slate-400" />
                  <h3 className="font-medium text-slate-200">Local Emulator State</h3>
                </div>
                
                {/* Temperature Sensor Monitor */}
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-slate-200">
                      <Thermometer className="h-4 w-4 text-blue-400" />
                      Temperature Sensor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-5xl font-bold text-white mb-4">
                      {currentTemp !== null ? `${currentTemp.toFixed(1)}°F` : '-- --'}
                    </div>
                    <div className="flex items-center gap-6 text-sm text-slate-400">
                      <span className="flex items-center gap-2">
                        <Battery className="h-4 w-4" />
                        {tempState.batteryLevel.toFixed(0)}%
                      </span>
                      <span className="flex items-center gap-2">
                        <Signal className="h-4 w-4" />
                        {tempState.signalStrength}dBm
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">Last Seen: Just now</p>
                    {tempDevice && (
                      <p className="text-xs text-slate-600 mt-1 font-mono">
                        {tempDevice.devEui}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Door Sensor Monitor */}
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-slate-200">
                      {doorState.doorOpen ? <DoorOpen className="h-4 w-4 text-red-400" /> : <DoorClosed className="h-4 w-4 text-green-400" />}
                      Door Sensor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-5xl font-bold mb-4 ${doorState.doorOpen ? 'text-red-400' : 'text-green-400'}`}>
                      {doorState.enabled ? (doorState.doorOpen ? 'OPEN' : 'CLOSED') : 'DISABLED'}
                    </div>
                    <div className="flex items-center gap-6 text-sm text-slate-400">
                      <span className="flex items-center gap-2">
                        <Battery className="h-4 w-4" />
                        {doorState.batteryLevel.toFixed(0)}%
                      </span>
                      <span className="flex items-center gap-2">
                        <Signal className="h-4 w-4" />
                        {doorState.signalStrength}dBm
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">Last Seen: Just now</p>
                    {doorDevice && (
                      <p className="text-xs text-slate-600 mt-1 font-mono">
                        {doorDevice.devEui}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Gateway Status */}
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-slate-200">
                      <Radio className="h-4 w-4" />
                      Gateway Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      {gateways.map(gw => (
                        <div key={gw.id} className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${gw.isOnline ? 'bg-green-400' : 'bg-slate-500'}`} />
                          <span className="text-sm text-slate-300">{gw.name}</span>
                          <Badge variant={gw.isOnline ? 'default' : 'secondary'} className="text-xs">
                            {gw.isOnline ? 'Online' : 'Offline'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Realtime Notice */}
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Live Telemetry</strong> reads from the <code>unit_telemetry</code> table via realtime subscription.
                Set an Org ID in the Testing tab to see database values. Door and temperature events sent through TTN or the local webhook will update both views.
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs">
            {logs.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 rounded-full bg-muted mb-4">
                    <ClipboardList className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium mb-2">No logs yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                    Logs will appear here when you start emulation or send readings
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={startEmulation} disabled={isRunning}>
                      Enable Logging
                    </Button>
                    <Button variant="outline" onClick={sendTempReading}>
                      Run Single Reading
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Recent Logs</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogs([])}
                    >
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <div className="space-y-2">
                      {logs.map(log => (
                        <div key={log.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                          <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">
                            {log.timestamp.toLocaleTimeString()}
                          </span>
                          <Badge variant={getLogBadgeVariant(log.type)} className="text-xs shrink-0">
                            {getLogBadgeLabel(log.type)}
                          </Badge>
                          <span className={`text-sm font-mono flex-1 ${log.type === 'error' ? 'text-destructive' : ''}`}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <QRCodeModal
        device={qrDevice}
        open={!!qrDevice}
        onClose={() => setQrDevice(null)}
      />

      <TTNProvisioningWizard
        open={showProvisioningWizard}
        onOpenChange={setShowProvisioningWizard}
        devices={devices}
        gateways={gateways}
        webhookConfig={webhookConfig}
        onComplete={handleProvisioningComplete}
        mode={provisioningMode}
      />

      {webhookConfig.testOrgId && webhookConfig.testSiteId && (
        <CreateUnitModal
          open={showCreateUnitModal}
          onOpenChange={setShowCreateUnitModal}
          orgId={webhookConfig.testOrgId}
          siteId={webhookConfig.testSiteId}
          siteName={webhookConfig.selectedUserSites?.find(s => s.site_id === webhookConfig.testSiteId)?.site_name || undefined}
          existingUnits={webhookConfig.availableUnits || []}
          onSuccess={async (unit) => {
            // Refresh units list after creation
            await handleCreateUnit(webhookConfig.testSiteId!, unit.name);
            setShowCreateUnitModal(false);
          }}
          onCreateUnit={async (data) => {
            const { createUnitInFrostGuard } = await import('@/lib/frostguardOrgSync');
            const result = await createUnitInFrostGuard(
              webhookConfig.testOrgId!,
              webhookConfig.testSiteId!,
              data.name,
              data.description,
              data.location
            );
            if (!result.ok || !result.unit) {
              throw new Error(result.error || 'Failed to create unit');
            }
            return result.unit;
          }}
        />
      )}

      {/* Debug Terminal - bottom docked */}
      <DebugTerminal />
    </div>
    </UserSelectionGate>
  );
}
