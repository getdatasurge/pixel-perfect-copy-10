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
  
  // TTN Snapshot from FrostGuard (loaded when user is selected)
  const [ttnSnapshot, setTtnSnapshot] = useState<import('@/hooks/useTTNSnapshot').TTNSnapshot | null>(null);
  
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
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
    return {
      enabled: false,
      targetUrl: '',
      applicationId: 'frostguard',
      sendToLocal: true,
    };
  });

  // Persist webhook config
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WEBHOOK, JSON.stringify(webhookConfig));
  }, [webhookConfig]);

  // Persist TTN provisioned devices
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TTN_PROVISIONED, JSON.stringify([...ttnProvisionedDevices]));
  }, [ttnProvisionedDevices]);

  // Persist TTN provisioned gateways
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TTN_PROVISIONED_GATEWAYS, JSON.stringify([...ttnProvisionedGateways]));
  }, [ttnProvisionedGateways]);

  // Check if TTN is configured and ready
  const isTTNConfigured = !!(
    webhookConfig?.ttnConfig?.applicationId &&
    webhookConfig?.ttnConfig?.enabled
  );

  // Handle provisioning wizard completion
  const handleProvisioningComplete = useCallback((results?: Array<{ dev_eui?: string; eui?: string; status: string }>) => {
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
        const newProvisioned = new Set(ttnProvisionedGateways);
        results.forEach(r => {
          if ((r.status === 'created' || r.status === 'already_exists') && r.eui) {
            newProvisioned.add(r.eui);
          }
        });
        setTtnProvisionedGateways(newProvisioned);
        toast({ title: 'Provisioning Complete', description: 'Gateways registered in TTN' });
      }
    }
    setShowProvisioningWizard(false);
  }, [provisioningMode, ttnProvisionedDevices, ttnProvisionedGateways]);

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
        // Use canonical device_id format: sensor-{normalized_deveui}
        const normalizedDevEui = device.devEui.replace(/[:\s-]/g, '').toLowerCase();
        const deviceId = `sensor-${normalizedDevEui}`;
        
        const { data, error } = await supabase.functions.invoke('ttn-simulate', {
          body: {
            org_id: webhookConfig.testOrgId, // Pass org for settings lookup
            applicationId: ttnConfig.applicationId,
            deviceId,
            cluster: ttnConfig.cluster,
            decodedPayload: payload,
            fPort: 1, // Temperature readings on port 1
          },
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'TTN API error');
        
        testResult.ttnStatus = 'success';
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 Sent via TTN → ${ttnConfig.applicationId}`);
      } 
      // Send to external webhook if configured
      else if (webhookConfig.enabled && webhookConfig.targetUrl) {
        testResult.ttnStatus = 'skipped';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const response = await fetch(webhookConfig.targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      addLog('error', '❌ No door sensor configured');
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
        
        const { data, error } = await supabase.functions.invoke('ttn-simulate', {
          body: {
            org_id: webhookConfig.testOrgId, // Pass org for settings lookup
            applicationId: ttnConfig.applicationId,
            deviceId,
            cluster: ttnConfig.cluster,
            decodedPayload: payload,
            fPort: 2, // Door events on port 2
          },
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'TTN API error');
        
        testResult.ttnStatus = 'success';
        testResult.webhookStatus = 'success';
        testResult.dbStatus = 'inserted';
        addLog('webhook', `📤 Door event sent via TTN → ${ttnConfig.applicationId}`);
      }
      // Send to external webhook if configured
      else if (webhookConfig.enabled && webhookConfig.targetUrl) {
        testResult.ttnStatus = 'skipped';
        const ttnPayload = buildTTNPayload(device, gateway, payload, webhookConfig.applicationId);
        const response = await fetch(webhookConfig.targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  const startEmulation = useCallback(() => {
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
  }, [tempState.intervalSeconds, doorState, sendTempReading, sendDoorEvent, addLog]);

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

  return (
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
            />
          </TabsContent>

          {/* Webhook Tab */}
          <TabsContent value="webhook">
            <WebhookSettings
              config={webhookConfig}
              onConfigChange={setWebhookConfig}
              disabled={isRunning}
              currentDevEui={tempDevice?.devEui}
              orgId={webhookConfig.testOrgId}
              devices={devices}
              ttnSnapshot={ttnSnapshot}
            />
          </TabsContent>

          {/* Testing Tab */}
          <TabsContent value="testing" className="space-y-6">
            <TestContextConfig
              config={webhookConfig}
              onConfigChange={setWebhookConfig}
              disabled={isRunning}
              gateways={gateways}
              devices={devices}
              onSyncResult={addSyncResult}
              onTTNSnapshotChange={setTtnSnapshot}
            />
            <TestDashboard
              results={testResults}
              syncResults={syncResults}
              onClearResults={() => {
                setTestResults([]);
                setSyncResults([]);
              }}
            />
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
    </div>
  );
}
