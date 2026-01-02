import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { MapPin, Search, AlertCircle } from 'lucide-react';
import { log } from '@/lib/debugLogger';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Site {
  site_id: string;
  site_name: string | null;
}

interface SiteSelectProps {
  sites: Site[];
  selectedSiteId: string | undefined;
  onSelect: (siteId: string | undefined) => void;
  disabled?: boolean;
}

export default function SiteSelect({
  sites,
  selectedSiteId,
  onSelect,
  disabled = false,
}: SiteSelectProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter sites by search query
  const filteredSites = sites.filter(site => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        site.site_name?.toLowerCase().includes(query) ||
        site.site_id.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const selectedSite = sites.find(s => s.site_id === selectedSiteId);
  const showSearch = sites.length > 5;

  const handleValueChange = (value: string) => {
    if (value === '__none__') {
      log('context', 'info', 'SITE_SELECTED', { site_id: null, site_name: null });
      onSelect(undefined);
    } else {
      const site = sites.find(s => s.site_id === value);
      log('context', 'info', 'SITE_SELECTED', { 
        site_id: value, 
        site_name: site?.site_name,
      });
      onSelect(value);
    }
  };

  const getPlaceholder = () => {
    if (sites.length === 0) return 'No sites available';
    return 'Select site...';
  };

  // Show warning if no sites available
  if (sites.length === 0) {
    return (
      <Alert variant="default" className="py-2">
        <AlertCircle className="h-3 w-3" />
        <AlertDescription className="text-xs">
          No sites available from FrostGuard. Pull org state again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Select
      value={selectedSiteId || '__none__'}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={getPlaceholder()}>
          {selectedSiteId === '__none__' || !selectedSiteId ? (
            <span className="text-muted-foreground">None / Unassigned</span>
          ) : selectedSite ? (
            <span className="flex items-center gap-2">
              <MapPin className="h-3 w-3 text-primary" />
              {selectedSite.site_name || selectedSite.site_id.slice(0, 8)}
            </span>
          ) : (
            <span className="text-muted-foreground">Select site...</span>
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
                placeholder="Search sites..."
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

        {/* Site options */}
        {filteredSites.map(site => (
          <SelectItem key={site.site_id} value={site.site_id}>
            <span className="flex items-center gap-2">
              <MapPin className="h-3 w-3 text-primary" />
              <span>{site.site_name || site.site_id.slice(0, 8)}</span>
            </span>
          </SelectItem>
        ))}

        {/* Empty state with search */}
        {filteredSites.length === 0 && searchQuery && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No sites match "{searchQuery}"
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
