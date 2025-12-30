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
import { Thermometer, Droplets, Battery, Signal, DoorOpen, DoorClosed, Play, Square, Zap, Settings, Activity, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'temp' | 'door' | 'info' | 'error';
  message: string;
}

interface TempSensorConfig {
  deviceSerial: string;
  unitId: string;
  minTemp: number;
  maxTemp: number;
  humidity: number;
  batteryLevel: number;
  signalStrength: number;
  intervalSeconds: number;
}

interface DoorSensorConfig {
  enabled: boolean;
  deviceSerial: string;
  unitId: string;
  batteryLevel: number;
  signalStrength: number;
  doorOpen: boolean;
  intervalSeconds: number;
}

const generateSerial = () => `EMU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

export default function LoRaWANEmulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [readingCount, setReadingCount] = useState(0);
  
  const tempIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const doorIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [tempConfig, setTempConfig] = useState<TempSensorConfig>({
    deviceSerial: generateSerial(),
    unitId: 'UNIT-001',
    minTemp: 32,
    maxTemp: 40,
    humidity: 45,
    batteryLevel: 95,
    signalStrength: -65,
    intervalSeconds: 60,
  });

  const [doorConfig, setDoorConfig] = useState<DoorSensorConfig>({
    enabled: true,
    deviceSerial: generateSerial(),
    unitId: 'UNIT-001',
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

  const sendTempReading = useCallback(async () => {
    const temp = tempConfig.minTemp + Math.random() * (tempConfig.maxTemp - tempConfig.minTemp);
    const humidity = tempConfig.humidity + (Math.random() - 0.5) * 5;
    const battery = Math.max(0, tempConfig.batteryLevel - Math.random() * 0.1);
    const signal = tempConfig.signalStrength + (Math.random() - 0.5) * 10;

    setCurrentTemp(temp);
    setTempConfig(prev => ({ ...prev, batteryLevel: battery }));

    try {
      const { error } = await supabase.functions.invoke('ingest-readings', {
        body: {
          type: 'sensor_reading',
          data: {
            device_serial: tempConfig.deviceSerial,
            temperature: Math.round(temp * 10) / 10,
            humidity: Math.round(humidity * 10) / 10,
            battery_level: Math.round(battery),
            signal_strength: Math.round(signal),
            unit_id: tempConfig.unitId,
            reading_type: 'scheduled',
          },
        },
      });

      if (error) throw error;

      setReadingCount(prev => prev + 1);
      addLog('temp', `📡 Temp: ${temp.toFixed(1)}°F, Humidity: ${humidity.toFixed(1)}%, Battery: ${battery.toFixed(0)}%`);
    } catch (err: any) {
      addLog('error', `❌ Failed to send temp reading: ${err.message}`);
      toast({
        title: 'Error sending reading',
        description: err.message,
        variant: 'destructive',
      });
    }
  }, [tempConfig, addLog]);

  const sendDoorEvent = useCallback(async (status?: 'open' | 'closed') => {
    if (!doorConfig.enabled) return;

    const doorStatus = status ?? (doorConfig.doorOpen ? 'open' : 'closed');
    const battery = Math.max(0, doorConfig.batteryLevel - Math.random() * 0.05);
    const signal = doorConfig.signalStrength + (Math.random() - 0.5) * 10;

    setDoorConfig(prev => ({ ...prev, batteryLevel: battery }));

    try {
      const { error } = await supabase.functions.invoke('ingest-readings', {
        body: {
          type: 'door_event',
          data: {
            device_serial: doorConfig.deviceSerial,
            door_status: doorStatus,
            battery_level: Math.round(battery),
            signal_strength: Math.round(signal),
            unit_id: doorConfig.unitId,
          },
        },
      });

      if (error) throw error;

      addLog('door', `🚪 Door ${doorStatus === 'open' ? 'OPENED' : 'CLOSED'} - Battery: ${battery.toFixed(0)}%`);
    } catch (err: any) {
      addLog('error', `❌ Failed to send door event: ${err.message}`);
      toast({
        title: 'Error sending door event',
        description: err.message,
        variant: 'destructive',
      });
    }
  }, [doorConfig, addLog]);

  const toggleDoor = useCallback(() => {
    const newStatus = !doorConfig.doorOpen;
    setDoorConfig(prev => ({ ...prev, doorOpen: newStatus }));
    sendDoorEvent(newStatus ? 'open' : 'closed');
  }, [doorConfig.doorOpen, sendDoorEvent]);

  const startEmulation = useCallback(() => {
    setIsRunning(true);
    addLog('info', '▶️ Emulation started');

    // Send initial readings
    sendTempReading();
    if (doorConfig.enabled) {
      sendDoorEvent();
    }

    // Set up intervals
    tempIntervalRef.current = setInterval(sendTempReading, tempConfig.intervalSeconds * 1000);
    
    if (doorConfig.enabled) {
      doorIntervalRef.current = setInterval(() => sendDoorEvent(), doorConfig.intervalSeconds * 1000);
    }
  }, [tempConfig.intervalSeconds, doorConfig, sendTempReading, sendDoorEvent, addLog]);

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

  const applyPreset = (preset: 'freezer' | 'fridge' | 'alert') => {
    const presets = {
      freezer: { minTemp: -10, maxTemp: 0, humidity: 30 },
      fridge: { minTemp: 32, maxTemp: 40, humidity: 45 },
      alert: { minTemp: 50, maxTemp: 60, humidity: 70 },
    };
    setTempConfig(prev => ({ ...prev, ...presets[preset] }));
    addLog('info', `🎛️ Applied ${preset} preset`);
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" />
              LoRaWAN Device Emulator
            </CardTitle>
            <CardDescription>Simulate refrigerator/freezer monitoring sensors</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isRunning ? 'default' : 'secondary'}>
              {isRunning ? 'Running' : 'Stopped'}
            </Badge>
            <Badge variant="outline">{readingCount} readings</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="temp">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="temp" className="flex items-center gap-1">
              <Thermometer className="h-4 w-4" />
              Temp Sensor
            </TabsTrigger>
            <TabsTrigger value="door" className="flex items-center gap-1">
              <DoorOpen className="h-4 w-4" />
              Door Sensor
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

          <TabsContent value="temp" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tempSerial">Device Serial</Label>
                <Input
                  id="tempSerial"
                  value={tempConfig.deviceSerial}
                  onChange={e => setTempConfig(prev => ({ ...prev, deviceSerial: e.target.value }))}
                  disabled={isRunning}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tempUnitId">Unit ID</Label>
                <Input
                  id="tempUnitId"
                  value={tempConfig.unitId}
                  onChange={e => setTempConfig(prev => ({ ...prev, unitId: e.target.value }))}
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Temperature Range: {tempConfig.minTemp}°F - {tempConfig.maxTemp}°F</Label>
              <div className="flex gap-4">
                <Input
                  type="number"
                  value={tempConfig.minTemp}
                  onChange={e => setTempConfig(prev => ({ ...prev, minTemp: Number(e.target.value) }))}
                  disabled={isRunning}
                  className="w-24"
                />
                <Slider
                  value={[tempConfig.minTemp, tempConfig.maxTemp]}
                  min={-20}
                  max={80}
                  step={1}
                  onValueChange={([min, max]) => setTempConfig(prev => ({ ...prev, minTemp: min, maxTemp: max }))}
                  disabled={isRunning}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={tempConfig.maxTemp}
                  onChange={e => setTempConfig(prev => ({ ...prev, maxTemp: Number(e.target.value) }))}
                  disabled={isRunning}
                  className="w-24"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Humidity: {tempConfig.humidity}%</Label>
                <Slider
                  value={[tempConfig.humidity]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) => setTempConfig(prev => ({ ...prev, humidity: v }))}
                  disabled={isRunning}
                />
              </div>
              <div className="space-y-2">
                <Label>Interval: {tempConfig.intervalSeconds}s</Label>
                <Slider
                  value={[tempConfig.intervalSeconds]}
                  min={5}
                  max={300}
                  step={5}
                  onValueChange={([v]) => setTempConfig(prev => ({ ...prev, intervalSeconds: v }))}
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset('freezer')} disabled={isRunning}>
                🧊 Freezer
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset('fridge')} disabled={isRunning}>
                🥶 Refrigerator
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset('alert')} disabled={isRunning}>
                🔥 Alert Test
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="door" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="doorEnabled">Enable Door Sensor</Label>
              <Switch
                id="doorEnabled"
                checked={doorConfig.enabled}
                onCheckedChange={enabled => setDoorConfig(prev => ({ ...prev, enabled }))}
                disabled={isRunning}
              />
            </div>

            {doorConfig.enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="doorSerial">Device Serial</Label>
                    <Input
                      id="doorSerial"
                      value={doorConfig.deviceSerial}
                      onChange={e => setDoorConfig(prev => ({ ...prev, deviceSerial: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doorUnitId">Unit ID</Label>
                    <Input
                      id="doorUnitId"
                      value={doorConfig.unitId}
                      onChange={e => setDoorConfig(prev => ({ ...prev, unitId: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Status Interval: {doorConfig.intervalSeconds}s</Label>
                  <Slider
                    value={[doorConfig.intervalSeconds]}
                    min={30}
                    max={600}
                    step={30}
                    onValueChange={([v]) => setDoorConfig(prev => ({ ...prev, intervalSeconds: v }))}
                    disabled={isRunning}
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Button
                    variant={doorConfig.doorOpen ? 'destructive' : 'outline'}
                    onClick={toggleDoor}
                    className="flex items-center gap-2"
                  >
                    {doorConfig.doorOpen ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
                    {doorConfig.doorOpen ? 'Close Door' : 'Open Door'}
                  </Button>
                  <Badge variant={doorConfig.doorOpen ? 'destructive' : 'secondary'}>
                    Door is {doorConfig.doorOpen ? 'OPEN' : 'CLOSED'}
                  </Badge>
                </div>
              </>
            )}
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
                      {tempConfig.batteryLevel.toFixed(0)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <Signal className="h-3 w-3" />
                      {tempConfig.signalStrength}dBm
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Serial: {tempConfig.deviceSerial}
                  </div>
                </CardContent>
              </Card>

              {doorConfig.enabled && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {doorConfig.doorOpen ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
                      Door Sensor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${doorConfig.doorOpen ? 'text-destructive' : 'text-green-500'}`}>
                      {doorConfig.doorOpen ? 'OPEN' : 'CLOSED'}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Battery className="h-3 w-3" />
                        {doorConfig.batteryLevel.toFixed(0)}%
                      </span>
                      <span className="flex items-center gap-1">
                        <Signal className="h-3 w-3" />
                        {doorConfig.signalStrength}dBm
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Serial: {doorConfig.deviceSerial}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
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
                      <span className={log.type === 'error' ? 'text-destructive' : ''}>
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
  );
}
