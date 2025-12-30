import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Thermometer, Droplets, Battery, Signal, DoorOpen, DoorClosed, Play, Square, Zap, Radio, Settings, Activity, FileText, Webhook, Cloud, FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import GatewayConfig from './emulator/GatewayConfig';
import WebhookSettings from './emulator/WebhookSettings';
import DeviceManager from './emulator/DeviceManager';
import QRCodeModal from './emulator/QRCodeModal';
import ScenarioPresets, { ScenarioConfig } from './emulator/ScenarioPresets';
import TestContextConfig from './emulator/TestContextConfig';
import TestDashboard from './emulator/TestDashboard';
import { 
  GatewayConfig as GatewayConfigType, 
  LoRaWANDevice, 
  WebhookConfig, 
  TestResult,
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

export default function LoRaWANEmulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  const [qrDevice, setQrDevice] = useState<LoRaWANDevice | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  
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
        const deviceId = `eui-${device.devEui.toLowerCase()}`;
        
        const { data, error } = await supabase.functions.invoke('ttn-simulate', {
          body: {
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
        const deviceId = `eui-${device.devEui.toLowerCase()}`;
        
        const { data, error } = await supabase.functions.invoke('ttn-simulate', {
          body: {
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

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Signal className="h-5 w-5" />
                LoRaWAN Ecosystem Emulator
              </CardTitle>
              <CardDescription>Simulate gateways, sensors, and TTN webhook payloads</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isRunning ? 'default' : 'secondary'}>
                {isRunning ? 'Running' : 'Stopped'}
              </Badge>
              <Badge variant="outline">{readingCount} readings</Badge>
              {webhookConfig.testOrgId && (
                <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">
                  Org: {webhookConfig.testOrgId}
                </Badge>
              )}
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
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sensors">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="sensors" className="flex items-center gap-1">
                <Thermometer className="h-4 w-4" />
                Sensors
              </TabsTrigger>
              <TabsTrigger value="gateways" className="flex items-center gap-1">
                <Radio className="h-4 w-4" />
                Gateways
              </TabsTrigger>
              <TabsTrigger value="devices" className="flex items-center gap-1">
                <Settings className="h-4 w-4" />
                Devices
              </TabsTrigger>
              <TabsTrigger value="webhook" className="flex items-center gap-1">
                <Webhook className="h-4 w-4" />
                Webhook
              </TabsTrigger>
              <TabsTrigger value="testing" className="flex items-center gap-1">
                <FlaskConical className="h-4 w-4" />
                Testing
              </TabsTrigger>
              <TabsTrigger value="monitor" className="flex items-center gap-1">
                <Activity className="h-4 w-4" />
                Monitor
              </TabsTrigger>
              <TabsTrigger value="logs" className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                Logs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sensors" className="space-y-6 mt-4">
              {/* Temperature Sensor Config */}
              <div className="space-y-4">
                <h3 className="font-medium flex items-center gap-2">
                  <Thermometer className="h-4 w-4" />
                  Temperature Sensor Settings
                </h3>
                
                <div className="space-y-2">
                  <Label>Temperature Range: {tempState.minTemp}°F - {tempState.maxTemp}°F</Label>
                  <div className="flex gap-4">
                    <Input
                      type="number"
                      value={tempState.minTemp}
                      onChange={e => setTempState(prev => ({ ...prev, minTemp: Number(e.target.value) }))}
                      disabled={isRunning}
                      className="w-24"
                    />
                    <Slider
                      value={[tempState.minTemp, tempState.maxTemp]}
                      min={-20}
                      max={80}
                      step={1}
                      onValueChange={([min, max]) => setTempState(prev => ({ ...prev, minTemp: min, maxTemp: max }))}
                      disabled={isRunning}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={tempState.maxTemp}
                      onChange={e => setTempState(prev => ({ ...prev, maxTemp: Number(e.target.value) }))}
                      disabled={isRunning}
                      className="w-24"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Humidity: {tempState.humidity}%</Label>
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
                    <Label>Interval: {tempState.intervalSeconds}s</Label>
                    <Slider
                      value={[tempState.intervalSeconds]}
                      min={5}
                      max={300}
                      step={5}
                      onValueChange={([v]) => setTempState(prev => ({ ...prev, intervalSeconds: v }))}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              </div>

              {/* Door Sensor Config */}
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2">
                    <DoorOpen className="h-4 w-4" />
                    Door Sensor Settings
                  </h3>
                  <Switch
                    checked={doorState.enabled}
                    onCheckedChange={enabled => setDoorState(prev => ({ ...prev, enabled }))}
                    disabled={isRunning}
                  />
                </div>

                {doorState.enabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Status Interval: {doorState.intervalSeconds}s</Label>
                      <Slider
                        value={[doorState.intervalSeconds]}
                        min={30}
                        max={600}
                        step={30}
                        onValueChange={([v]) => setDoorState(prev => ({ ...prev, intervalSeconds: v }))}
                        disabled={isRunning}
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <Button
                        variant={doorState.doorOpen ? 'destructive' : 'outline'}
                        onClick={toggleDoor}
                        className="flex items-center gap-2"
                      >
                        {doorState.doorOpen ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
                        {doorState.doorOpen ? 'Close Door' : 'Open Door'}
                      </Button>
                      <Badge variant={doorState.doorOpen ? 'destructive' : 'secondary'}>
                        Door is {doorState.doorOpen ? 'OPEN' : 'CLOSED'}
                      </Badge>
                    </div>
                  </>
                )}
              </div>

              {/* Scenario Presets */}
              <div className="border-t pt-4">
                <ScenarioPresets onApply={applyScenario} disabled={isRunning} />
              </div>
            </TabsContent>

            <TabsContent value="gateways" className="mt-4">
              <GatewayConfig
                gateways={gateways}
                onGatewaysChange={setGateways}
                disabled={isRunning}
              />
            </TabsContent>

            <TabsContent value="devices" className="mt-4">
              <DeviceManager
                devices={devices}
                gateways={gateways}
                onDevicesChange={setDevices}
                onShowQR={setQrDevice}
                disabled={isRunning}
                webhookConfig={webhookConfig}
              />
            </TabsContent>

            <TabsContent value="webhook" className="mt-4">
              <WebhookSettings
                config={webhookConfig}
                onConfigChange={setWebhookConfig}
                disabled={isRunning}
                currentDevEui={tempDevice?.devEui}
              />
            </TabsContent>

            <TabsContent value="testing" className="space-y-4 mt-4">
              <TestContextConfig
                config={webhookConfig}
                onConfigChange={setWebhookConfig}
                disabled={isRunning}
              />
              <TestDashboard
                results={testResults}
                onClearResults={() => setTestResults([])}
              />
            </TabsContent>

            <TabsContent value="monitor" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Thermometer className="h-4 w-4" />
                      Temperature Sensor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {currentTemp !== null ? `${currentTemp.toFixed(1)}°F` : '--'}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Battery className="h-3 w-3" />
                        {tempState.batteryLevel.toFixed(0)}%
                      </span>
                      <span className="flex items-center gap-1">
                        <Signal className="h-3 w-3" />
                        {tempState.signalStrength}dBm
                      </span>
                    </div>
                    {tempDevice && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        DevEUI: {tempDevice.devEui}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {doorState.enabled && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        {doorState.doorOpen ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
                        Door Sensor
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={`text-3xl font-bold ${doorState.doorOpen ? 'text-destructive' : 'text-green-500'}`}>
                        {doorState.doorOpen ? 'OPEN' : 'CLOSED'}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Battery className="h-3 w-3" />
                          {doorState.batteryLevel.toFixed(0)}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Signal className="h-3 w-3" />
                          {doorState.signalStrength}dBm
                        </span>
                      </div>
                      {doorDevice && (
                        <div className="text-xs text-muted-foreground mt-1 font-mono">
                          DevEUI: {doorDevice.devEui}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Gateway Status */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    Gateway Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {gateways.map(gw => (
                      <Badge key={gw.id} variant={gw.isOnline ? 'default' : 'secondary'}>
                        {gw.name}: {gw.isOnline ? 'Online' : 'Offline'}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logs" className="mt-4">
              <ScrollArea className="h-64 rounded-md border p-4">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">No logs yet</div>
                ) : (
                  <div className="space-y-1">
                    {logs.map(log => (
                      <div key={log.id} className="text-sm font-mono">
                        <span className="text-muted-foreground">
                          [{log.timestamp.toLocaleTimeString()}]
                        </span>{' '}
                        <span className={
                          log.type === 'error' ? 'text-destructive' : 
                          log.type === 'webhook' ? 'text-green-500' : ''
                        }>
                          {log.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <div className="flex gap-2 mt-6">
            {!isRunning ? (
              <>
                <Button onClick={startEmulation} className="flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  Start Emulation
                </Button>
                <Button variant="outline" onClick={sendTempReading} className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Single Reading
                </Button>
              </>
            ) : (
              <Button variant="destructive" onClick={stopEmulation} className="flex items-center gap-2">
                <Square className="h-4 w-4" />
                Stop Emulation
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <QRCodeModal
        device={qrDevice}
        open={!!qrDevice}
        onClose={() => setQrDevice(null)}
      />
    </>
  );
}
