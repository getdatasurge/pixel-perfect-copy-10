import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, User, Building2, MapPin, Box, AlertCircle, Star, Radio } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';

export interface UserSite {
  site_id: string;
  site_name?: string | null;
  is_default?: boolean;
}

export interface TTNConnection {
  enabled: boolean;
  provisioning_status?: string | null;
  cluster?: string | null;
  application_id?: string | null;
  webhook_id?: string | null;
  webhook_url?: string | null;
  api_key_last4?: string | null;
  webhook_secret_last4?: string | null;
  updated_at?: string | null;
}

export interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  organization_id: string; // Required - always present from sync
  site_id?: string;        // Legacy single site
  unit_id?: string;
  default_site_id?: string;
  user_sites?: UserSite[];
  ttn?: TTNConnection; // NEW: TTN data from sync payload
}

interface UserSearchDialogProps {
  onSelectUser: (user: UserProfile) => void;
  disabled?: boolean;
  cachedUserCount?: number | null;
}

export default function UserSearchDialog({ onSelectUser, disabled, cachedUserCount }: UserSearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const searchUsers = useCallback(async (term?: string) => {
    const searchValue = term ?? searchTerm;

    setIsLoading(true);
    setHasSearched(true);
    setLastError(null);

    try {
      // Use local search-users function that queries users_cache table
      const { data, error } = await supabase.functions.invoke('search-users', {
        body: {
          searchTerm: searchValue.trim() || undefined,
        },
      });

      if (error) {
        // Parse the actual error from edge function
        let errorMessage = 'Unknown error';
        let errorDetails = '';

        if (error instanceof FunctionsHttpError) {
          try {
            const errorData = await error.context.json();
            errorMessage = errorData.error || 'Request failed';
            errorDetails = errorData.details || '';
          } catch {
            errorMessage = error.message;
          }
        } else if (error instanceof FunctionsRelayError) {
          errorMessage = 'Network relay error - check your connection';
        } else if (error instanceof FunctionsFetchError) {
          errorMessage = 'Failed to connect to backend';
        } else {
          errorMessage = error.message;
        }

        const fullError = errorDetails ? `${errorMessage}: ${errorDetails}` : errorMessage;
        setLastError(fullError);
        toast({
          title: 'Search Failed',
          description: fullError,
          variant: 'destructive',
        });
        setUsers([]);
        return;
      }

      if (!data.success) {
        const fullError = data.details ? `${data.error}: ${data.details}` : data.error;
        setLastError(fullError);
        toast({
          title: 'Search Failed',
          description: fullError,
          variant: 'destructive',
        });
        setUsers([]);
        return;
      }

      setUsers(data.users || []);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      toast({
        title: 'Search Failed',
        description: message,
        variant: 'destructive',
      });
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm]);

  // Auto-search with debounce when typing
  useEffect(() => {
    if (!open) return;

    const debounceTimer = setTimeout(() => {
      searchUsers(searchTerm);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, open]);

  // Load users when dialog opens
  useEffect(() => {
    if (open && !hasSearched) {
      searchUsers('');
    }
  }, [open, hasSearched]);

  const handleSelect = (user: UserProfile) => {
    onSelectUser(user);
    setOpen(false);
    setSearchTerm('');
    setUsers([]);
    setHasSearched(false);
    toast({
      title: 'Context Applied',
      description: `Loaded context from ${user.full_name || user.email || user.id}`,
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchTerm('');
      setUsers([]);
      setHasSearched(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          className="flex items-center w-full h-10 px-3 py-2 border rounded-md bg-background text-left text-muted-foreground hover:bg-accent cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={disabled}
        >
          <Search className="h-4 w-4 mr-2 flex-shrink-0" />
          <span className="flex-1 truncate">Search users to auto-fill context...</span>
          {cachedUserCount !== null && cachedUserCount > 0 && (
            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded flex-shrink-0">
              {cachedUserCount} users
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Search Users
          </DialogTitle>
          <DialogDescription>
            Search for users to auto-fill organization context
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers(searchTerm)}
            />
            <Button onClick={() => searchUsers(searchTerm)} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            ) : users.length > 0 ? (
              users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelect(user)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  <div className="font-medium">
                    {user.full_name || user.email || user.id}
                  </div>
                  {user.email && user.full_name && (
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 text-xs">
                    {user.organization_id && (
                      <span className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded">
                        <Building2 className="h-3 w-3" />
                        {user.organization_id.slice(0, 8)}...
                      </span>
                    )}
                    {/* Show site count or default site */}
                    {user.user_sites && user.user_sites.length > 0 ? (
                      <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                        <MapPin className="h-3 w-3" />
                        {user.user_sites.length} site{user.user_sites.length !== 1 ? 's' : ''}
                        {user.default_site_id && (
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        )}
                      </span>
                    ) : user.site_id ? (
                      <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                        <MapPin className="h-3 w-3" />
                        {user.site_id.slice(0, 8)}...
                      </span>
                    ) : null}
                    {user.unit_id && (
                      <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                        <Box className="h-3 w-3" />
                        {user.unit_id}
                      </span>
                    )}
                    {/* TTN status indicator */}
                    {user.ttn?.enabled && (
                      <span className="flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                        <Radio className="h-3 w-3" />
                        TTN Connected
                      </span>
                    )}
                  </div>
                </button>
              ))
            ) : lastError ? (
              <div className="text-center py-4 space-y-2">
                <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                <div className="text-sm text-destructive font-medium">Search failed</div>
                <div className="text-xs text-muted-foreground px-4">{lastError}</div>
              </div>
            ) : hasSearched ? (
              <div className="text-center text-muted-foreground py-4">
                No users found. Try a different search term.
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4">
                Click search or press Enter to find users
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
