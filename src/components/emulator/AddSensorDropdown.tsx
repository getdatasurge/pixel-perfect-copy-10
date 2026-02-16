/**
 * Add Sensor Dropdown - Device Library Search
 * 
 * Queries the Device Library with debounced search, displays results grouped by category,
 * and allows users to select a library device model to create a new emulator device.
 */

import * as React from 'react';
import { Check, ChevronsUpDown, Plus, Thermometer, DoorOpen, Droplet, Wind, Gauge, MapPin, Activity, Zap } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  listDevices,
  isLibraryLoaded,
  initializeDeviceLibrary,
  type DeviceDefinition,
  type DeviceCategory,
} from '@/lib/deviceLibrary';

// ============================================
// Debounce Hook
// ============================================

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  
  return debounced;
}

// ============================================
// Category Helpers
// ============================================

const CATEGORY_ICONS: Record<DeviceCategory, React.ComponentType<{ className?: string }>> = {
  temperature: Thermometer,
  temperature_humidity: Thermometer,
  door: DoorOpen,
  contact: DoorOpen,
  co2: Wind,
  leak: Droplet,
  motion: Activity,
  air_quality: Wind,
  gps: MapPin,
  meter: Gauge,
  combo: Zap,
  multi_sensor: Zap,
};

const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  temperature: 'Temperature',
  temperature_humidity: 'Temp + Humidity',
  door: 'Door/Contact',
  contact: 'Contact',
  co2: 'CO2',
  leak: 'Leak Detection',
  motion: 'Motion',
  air_quality: 'Air Quality',
  gps: 'GPS/Location',
  meter: 'Metering',
  combo: 'Multi-Sensor',
  multi_sensor: 'Multi-Sensor',
};

function getCategoryLabel(category: DeviceCategory): string {
  return CATEGORY_LABELS[category] || category;
}

function getCategoryIcon(category: DeviceCategory): React.ComponentType<{ className?: string }> {
  return CATEGORY_ICONS[category] || Thermometer;
}

// ============================================
// Group by Category
// ============================================

function groupByCategory(devices: DeviceDefinition[]): Map<DeviceCategory, DeviceDefinition[]> {
  // Sort devices by category then name
  const sorted = [...devices].sort((a, b) => {
    const catCompare = a.category.localeCompare(b.category);
    return catCompare !== 0 ? catCompare : a.name.localeCompare(b.name);
  });

  const grouped = new Map<DeviceCategory, DeviceDefinition[]>();
  for (const device of sorted) {
    const existing = grouped.get(device.category) || [];
    existing.push(device);
    grouped.set(device.category, existing);
  }
  
  return grouped;
}

// ============================================
// Component Props
// ============================================

interface AddSensorDropdownProps {
  onAddFromLibrary: (libraryDeviceId: string) => void;
  disabled?: boolean;
}

// ============================================
// Main Component
// ============================================

export default function AddSensorDropdown({
  onAddFromLibrary,
  disabled,
}: AddSensorDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string>('');
  const [query, setQuery] = React.useState('');
  
  const debouncedQuery = useDebouncedValue(query, 150);

  // Ensure library is loaded when dropdown opens
  React.useEffect(() => {
    if (open && !isLibraryLoaded()) {
      initializeDeviceLibrary();
    }
  }, [open]);

  // Search results (synchronous - library is in-memory)
  const results = React.useMemo(() => {
    if (!open) return [];
    
    // Initialize library if needed
    if (!isLibraryLoaded()) {
      initializeDeviceLibrary();
    }
    
    // Get filtered devices
    const searchTerm = debouncedQuery.trim();
    return listDevices(searchTerm ? { search: searchTerm } : {});
  }, [open, debouncedQuery]);

  // Group results by category
  const grouped = React.useMemo(() => groupByCategory(results), [results]);

  const handleSelect = (deviceId: string) => {
    // Defensive: ensure library is loaded before proceeding
    if (!isLibraryLoaded()) {
      console.log('[AddSensorDropdown] Library not loaded, initializing before selection');
      initializeDeviceLibrary();
    }
    
    setSelectedId(deviceId);
    setOpen(false);
    setQuery('');
    onAddFromLibrary(deviceId);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add Sensor
          <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search devices..."
            value={query}
            onValueChange={setQuery}
          />
          
          <CommandList>
            {results.length === 0 ? (
              <CommandEmpty>
                {debouncedQuery ? 'No devices found.' : 'Loading library...'}
              </CommandEmpty>
            ) : (
              <ScrollArea className="h-72">
                {[...grouped.entries()].map(([category, devices]) => {
                  const Icon = getCategoryIcon(category);
                  return (
                    <CommandGroup
                      key={category}
                      heading={
                        <span className="flex items-center gap-2">
                          <Icon className="h-3 w-3" />
                          {getCategoryLabel(category)}
                        </span>
                      }
                    >
                      {devices.map((device) => (
                        <CommandItem
                          key={device.id}
                          value={device.id}
                          onSelect={() => handleSelect(device.id)}
                          className="flex items-start gap-2 py-2"
                        >
                          <Check
                            className={cn(
                              'h-4 w-4 mt-0.5 shrink-0',
                              selectedId === device.id ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{device.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {device.manufacturer}
                              </span>
                            </div>
                            {device.description && (
                              <span className="text-xs text-muted-foreground line-clamp-1">
                                {device.description}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
              </ScrollArea>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
