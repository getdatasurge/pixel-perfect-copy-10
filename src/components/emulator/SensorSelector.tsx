import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Thermometer, DoorOpen, Search, CheckSquare, Square,
  Radio, Clock, Battery, Signal
} from 'lucide-react';
import { LoRaWANDevice } from '@/lib/ttn-payload';
import { SensorState, getSensorSummary } from '@/lib/emulatorSensorState';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SensorSelectorProps {
  devices: LoRaWANDevice[];
  sensorStates: Record<string, SensorState>;
  selectedSensorIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

export default function SensorSelector({
  devices,
  sensorStates,
  selectedSensorIds,
  onSelectionChange,
  disabled,
}: SensorSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // If only 1 sensor exists, auto-select and hide selector
  if (devices.length <= 1) {
    return null;
  }

  // Filter devices by search
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return devices;
    const query = searchQuery.toLowerCase();
    return devices.filter(d => 
      d.name.toLowerCase().includes(query) ||
      d.devEui.toLowerCase().includes(query) ||
      d.type.toLowerCase().includes(query)
    );
  }, [devices, searchQuery]);

  const handleToggle = (deviceId: string) => {
    if (disabled) return;
    
    const isSelected = selectedSensorIds.includes(deviceId);
    if (isSelected) {
      // Don't allow deselecting the last sensor
      if (selectedSensorIds.length === 1) return;
      onSelectionChange(selectedSensorIds.filter(id => id !== deviceId));
    } else {
      onSelectionChange([...selectedSensorIds, deviceId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onSelectionChange(devices.map(d => d.id));
  };

  const handleClearSelection = () => {
    if (disabled) return;
    // Keep at least one selected
    if (devices.length > 0) {
      onSelectionChange([devices[0].id]);
    }
  };

  const getDeviceIcon = (type: 'temperature' | 'door') => {
    return type === 'temperature' 
      ? <Thermometer className="h-4 w-4 text-blue-500" />
      : <DoorOpen className="h-4 w-4 text-orange-500" />;
  };

  const getTypeBadge = (type: 'temperature' | 'door') => {
    return type === 'temperature' 
      ? <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">Temp</Badge>
      : <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">Door</Badge>;
  };

  const getStatusBadge = (sensor: SensorState | undefined) => {
    if (!sensor) return null;
    return sensor.isOnline
      ? <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">Online</Badge>
      : <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">Offline</Badge>;
  };

  return (
    <Card className={cn(disabled && 'opacity-60')}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Selected Sensors
            <Badge variant="secondary" className="ml-2">
              {selectedSensorIds.length} / {devices.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleSelectAll}
              disabled={disabled || selectedSensorIds.length === devices.length}
              className="h-8 text-xs"
            >
              <CheckSquare className="h-3 w-3 mr-1" />
              Select All
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleClearSelection}
              disabled={disabled || selectedSensorIds.length === 1}
              className="h-8 text-xs"
            >
              <Square className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sensors..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            disabled={disabled}
          />
        </div>

        {/* Sensor List */}
        <ScrollArea className="h-[200px] rounded-md border">
          <div className="p-2 space-y-1">
            {filteredDevices.map(device => {
              const sensor = sensorStates[device.id];
              const isSelected = selectedSensorIds.includes(device.id);
              
              return (
                <div
                  key={device.id}
                  className={cn(
                    'flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors',
                    isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50',
                    disabled && 'cursor-not-allowed'
                  )}
                  onClick={() => handleToggle(device.id)}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={disabled || (isSelected && selectedSensorIds.length === 1)}
                    className="pointer-events-none"
                  />
                  
                  <div className="flex-shrink-0">
                    {getDeviceIcon(device.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{device.name}</span>
                      {getTypeBadge(device.type)}
                      {getStatusBadge(sensor)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{device.devEui.slice(0, 8)}...</span>
                      {sensor && (
                        <>
                          <span className="flex items-center gap-1">
                            <Battery className="h-3 w-3" />
                            {sensor.batteryPct}%
                          </span>
                          <span className="flex items-center gap-1">
                            <Signal className="h-3 w-3" />
                            {sensor.signalStrength} dBm
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-shrink-0 text-right">
                    {sensor?.lastSentAt ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(sensor.lastSentAt, { addSuffix: true })}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No data</span>
                    )}
                    {sensor && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {device.type === 'temperature' 
                          ? `${sensor.minTempF}°F - ${sensor.maxTempF}°F`
                          : sensor.doorOpen ? 'Open' : 'Closed'
                        }
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {filteredDevices.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No sensors match your search
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Selection Summary */}
        {selectedSensorIds.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Selected:</span>{' '}
            {selectedSensorIds.map(id => {
              const device = devices.find(d => d.id === id);
              return device?.name;
            }).filter(Boolean).join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
