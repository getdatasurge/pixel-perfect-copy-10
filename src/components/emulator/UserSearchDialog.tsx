import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, User, Building2, MapPin, Box } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  organization_id?: string;
  site_id?: string;
  unit_id?: string;
}

interface UserSearchDialogProps {
  frostguardApiUrl?: string;
  onSelectUser: (user: UserProfile) => void;
  disabled?: boolean;
}

export default function UserSearchDialog({ frostguardApiUrl, onSelectUser, disabled }: UserSearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const searchUsers = useCallback(async (term?: string) => {
    const searchValue = term ?? searchTerm;
    if (!frostguardApiUrl) {
      toast({
        title: 'Missing URL',
        description: 'Set the FrostGuard Supabase URL first',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      const { data, error } = await supabase.functions.invoke('frostguard-search-users', {
        body: {
          frostguardApiUrl,
          searchTerm: searchValue.trim() || undefined,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to search users');
      }

      setUsers(data.users || []);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Search Failed',
        description: message,
        variant: 'destructive',
      });
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [frostguardApiUrl, searchTerm]);

  // Auto-search with debounce when typing
  useEffect(() => {
    if (!open || !frostguardApiUrl) return;
    
    const debounceTimer = setTimeout(() => {
      searchUsers(searchTerm);
    }, 300);
    
    return () => clearTimeout(debounceTimer);
  }, [searchTerm, open, frostguardApiUrl]);

  // Load users when dialog opens
  useEffect(() => {
    if (open && frostguardApiUrl && !hasSearched) {
      searchUsers('');
    }
  }, [open, frostguardApiUrl, hasSearched]);

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
        <Button
          variant="outline"
          size="icon"
          disabled={disabled || !frostguardApiUrl}
          title={frostguardApiUrl ? 'Search FrostGuard users' : 'Set FrostGuard URL first'}
        >
          <Search className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Search FrostGuard Users
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
            {users.length > 0 ? (
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
                        {user.organization_id}
                      </span>
                    )}
                    {user.site_id && (
                      <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                        <MapPin className="h-3 w-3" />
                        {user.site_id}
                      </span>
                    )}
                    {user.unit_id && (
                      <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                        <Box className="h-3 w-3" />
                        {user.unit_id}
                      </span>
                    )}
                  </div>
                </button>
              ))
            ) : hasSearched && !isLoading ? (
              <div className="text-center text-muted-foreground py-4">
                No users found. Try a different search term.
              </div>
            ) : !hasSearched ? (
              <div className="text-center text-muted-foreground py-4">
                Click search or press Enter to find users
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
