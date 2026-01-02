import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Box, Plus, Search } from 'lucide-react';
import { OrgStateUnit } from '@/lib/frostguardOrgSync';
import { log } from '@/lib/debugLogger';

interface UnitSelectProps {
  units: OrgStateUnit[];
  siteId: string | undefined;
  selectedUnitId: string | undefined;
  onSelect: (unitId: string | undefined, unit?: OrgStateUnit) => void;
  onCreate: () => void;
  disabled?: boolean;
}

export default function UnitSelect({
  units,
  siteId,
  selectedUnitId,
  onSelect,
  onCreate,
  disabled = false,
}: UnitSelectProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter units by site and search query
  const filteredUnits = units.filter(unit => {
    // Only show units for the selected site
    if (siteId && unit.site_id !== siteId) return false;
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        unit.name.toLowerCase().includes(query) ||
        (unit.description?.toLowerCase().includes(query)) ||
        (unit.location?.toLowerCase().includes(query))
      );
    }
    return true;
  });

  const selectedUnit = units.find(u => u.id === selectedUnitId);
  const showSearch = units.filter(u => !siteId || u.site_id === siteId).length > 5;

  const handleValueChange = (value: string) => {
    if (value === '__none__') {
      log('context', 'info', 'UNIT_SELECTED', { unit_id: null, unit_name: null });
      onSelect(undefined);
    } else if (value === '__create__') {
      onCreate();
    } else {
      const unit = units.find(u => u.id === value);
      log('context', 'info', 'UNIT_SELECTED', { 
        unit_id: value, 
        unit_name: unit?.name,
        site_id: unit?.site_id,
      });
      onSelect(value, unit);
    }
  };

  const getPlaceholder = () => {
    if (!siteId) return 'Select site first';
    if (filteredUnits.length === 0 && !searchQuery) return 'No units in site';
    return 'Select unit...';
  };

  return (
    <Select
      value={selectedUnitId || '__none__'}
      onValueChange={handleValueChange}
      disabled={disabled || !siteId}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={getPlaceholder()}>
          {selectedUnitId === '__none__' || !selectedUnitId ? (
            <span className="text-muted-foreground">None / Unassigned</span>
          ) : selectedUnit ? (
            <span className="flex items-center gap-2">
              <Box className="h-3 w-3 text-primary" />
              {selectedUnit.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Select unit...</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Search filter for long lists */}
        {showSearch && (
          <div className="px-2 pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search units..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-7 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        {/* None option */}
        <SelectItem value="__none__">
          <span className="text-muted-foreground">None / Unassigned</span>
        </SelectItem>

        {/* Unit options */}
        {filteredUnits.map(unit => (
          <SelectItem key={unit.id} value={unit.id}>
            <span className="flex items-center gap-2">
              <Box className="h-3 w-3 text-primary" />
              <span>{unit.name}</span>
              {unit.location && (
                <span className="text-xs text-muted-foreground">({unit.location})</span>
              )}
            </span>
          </SelectItem>
        ))}

        {/* Empty state with search */}
        {filteredUnits.length === 0 && searchQuery && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No units match "{searchQuery}"
          </div>
        )}

        {/* Create new unit option */}
        <div className="border-t mt-1 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-primary hover:text-primary hover:bg-primary/10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCreate();
            }}
          >
            <Plus className="h-3 w-3 mr-2" />
            Create Unit
          </Button>
        </div>
      </SelectContent>
    </Select>
  );
}
