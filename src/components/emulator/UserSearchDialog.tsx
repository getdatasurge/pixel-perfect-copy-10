import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, User, Building2, MapPin, Box, AlertCircle, Star, Radio, Bug, Copy, CheckCircle2, ChevronDown, ChevronUp, Database, Wifi } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';
import { syncDebug, getSupabaseEnvInfo, createDebugReport, copyDebugReport } from '@/lib/debug';
import { validateSearchUsersResponse } from '@/lib/schemas';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
  organization_id: string;
  site_id?: string;
  unit_id?: string;
  default_site_id?: string;
  user_sites?: UserSite[];
  ttn?: TTNConnection;
}

interface DiagnosticsState {
  lastRequestAt: string | null;
  lastStatus: 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'schema_mismatch';
  responseTimeMs: number | null;
  userCount: number | null;
  source: string | null;
  rawResponse: unknown | null;
  sessionUserId: string | null;
  envInfo: ReturnType<typeof getSupabaseEnvInfo> | null;
  dbCheckResult: 'not_run' | 'success' | 'failed' | null;
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
  const [lastError, setLastError] = useState<{ code: string; message: string; details?: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({
    lastRequestAt: null,
    lastStatus: 'idle',
    responseTimeMs: null,
    userCount: null,
    source: null,
    rawResponse: null,
    sessionUserId: null,
    envInfo: null,
    dbCheckResult: null,
  });
  const [copied, setCopied] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testResponse, setTestResponse] = useState<string | null>(null);

  // Check environment on mount
  useEffect(() => {
    const envInfo = getSupabaseEnvInfo();
    setDiagnostics(prev => ({ ...prev, envInfo }));
    syncDebug.log('Environment info:', envInfo);
  }, []);

  const runDirectDbCheck = async (): Promise<'success' | 'failed'> => {
    try {
      syncDebug.log('Running direct DB sanity check...');
      const { data, error } = await supabase.from('synced_users').select('id').limit(1);
      if (error) {
        syncDebug.error('Direct DB check failed:', error);
        return 'failed';
      }
      syncDebug.log('Direct DB check passed, found:', data?.length || 0, 'rows');
      return 'success';
    } catch (err) {
      syncDebug.error('Direct DB check error:', err);
      return 'failed';
    }
  };

  const searchUsers = useCallback(async (term?: string) => {
    const searchValue = term ?? searchTerm;
    const startTime = Date.now();

    // Get current session
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id || null;

    syncDebug.group('searchUsers');
    syncDebug.log('Inputs:', { searchValue, sessionUserId: sessionUserId ? `${sessionUserId.slice(0, 8)}...` : 'none' });
    syncDebug.log('Function: search-users');

    setIsLoading(true);
    setHasSearched(true);
    setLastError(null);
    setDiagnostics(prev => ({
      ...prev,
      lastRequestAt: new Date().toISOString(),
      lastStatus: 'loading',
      sessionUserId,
    }));

    try {
      syncDebug.log('Invoking supabase.functions.invoke("search-users")...');
      
      const { data, error } = await supabase.functions.invoke('search-users', {
        body: { searchTerm: searchValue.trim() || undefined },
      });

      const responseTimeMs = Date.now() - startTime;
      syncDebug.log('Response received in', responseTimeMs, 'ms');

      if (error) {
        syncDebug.error('Edge function error:', error);
        
        let errorCode = 'EDGE_FUNCTION_ERROR';
        let errorMessage = 'Unknown error';
        let errorDetails = '';

        if (error instanceof FunctionsHttpError) {
          errorCode = `HTTP_${error.context?.status || 'UNKNOWN'}`;
          try {
            const errorData = await error.context.json();
            errorMessage = errorData.error || 'Request failed';
            errorDetails = errorData.details || '';
            syncDebug.log('Error response body:', errorData);
          } catch {
            errorMessage = error.message;
          }
        } else if (error instanceof FunctionsRelayError) {
          errorCode = 'RELAY_ERROR';
          errorMessage = 'Network relay error - check your connection';
        } else if (error instanceof FunctionsFetchError) {
          errorCode = 'FETCH_ERROR';
          errorMessage = 'Failed to connect to backend';
        } else {
          errorMessage = error.message;
        }

        // Run direct DB check to distinguish issues
        const dbCheckResult = await runDirectDbCheck();

        setLastError({ code: errorCode, message: errorMessage, details: errorDetails });
        setDiagnostics(prev => ({
          ...prev,
          lastStatus: 'error',
          responseTimeMs,
          userCount: 0,
          rawResponse: { error: errorMessage },
          dbCheckResult,
        }));

        toast({
          title: `Search Failed (${errorCode})`,
          description: errorDetails ? `${errorMessage}: ${errorDetails}` : errorMessage,
          variant: 'destructive',
        });
        setUsers([]);
        syncDebug.groupEnd();
        return;
      }

      syncDebug.log('Raw response:', data);

      // Validate response schema
      const validation = validateSearchUsersResponse(data);
      if (!validation.valid) {
        syncDebug.error('Schema validation failed:', validation.errors?.format());
        setLastError({ 
          code: 'SCHEMA_MISMATCH', 
          message: 'Data format mismatch', 
          details: 'Response structure does not match expected schema' 
        });
        setDiagnostics(prev => ({
          ...prev,
          lastStatus: 'schema_mismatch',
          responseTimeMs,
          rawResponse: data,
        }));
        toast({
          title: 'Data Format Mismatch (SchemaMismatch)',
          description: 'Open diagnostics for details',
          variant: 'destructive',
        });
        setUsers([]);
        syncDebug.groupEnd();
        return;
      }

      if (!data.success) {
        syncDebug.warn('API returned success=false:', data.error);
        const dbCheckResult = await runDirectDbCheck();
        setLastError({ code: 'API_ERROR', message: data.error || 'Unknown', details: data.details });
        setDiagnostics(prev => ({
          ...prev,
          lastStatus: 'error',
          responseTimeMs,
          userCount: 0,
          source: data.source,
          rawResponse: data,
          dbCheckResult,
        }));
        toast({
          title: 'Search Failed',
          description: data.details ? `${data.error}: ${data.details}` : data.error,
          variant: 'destructive',
        });
        setUsers([]);
        syncDebug.groupEnd();
        return;
      }

      const userList = data.users || [];
      syncDebug.log('Users found:', userList.length);
      
      // Log per-user summary
      userList.forEach((u: UserProfile, i: number) => {
        syncDebug.log(`  User ${i + 1}:`, {
          id: u.id.slice(0, 8) + '...',
          email: u.email,
          siteCount: u.user_sites?.length || 0,
          hasTTN: !!u.ttn?.enabled,
        });
      });

      setUsers(userList);
      setDiagnostics(prev => ({
        ...prev,
        lastStatus: userList.length > 0 ? 'success' : 'empty',
        responseTimeMs,
        userCount: userList.length,
        source: data.source || 'synced_users',
        rawResponse: data,
      }));

      if (userList.length === 0) {
        syncDebug.warn('Empty user list returned');
      }

      syncDebug.groupEnd();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      syncDebug.error('Unexpected error:', err);
      const dbCheckResult = await runDirectDbCheck();
      
      setLastError({ code: 'EXCEPTION', message });
      setDiagnostics(prev => ({
        ...prev,
        lastStatus: 'error',
        responseTimeMs: Date.now() - startTime,
        rawResponse: { exception: message },
        dbCheckResult,
      }));
      toast({
        title: 'Search Failed (Exception)',
        description: message,
        variant: 'destructive',
      });
      setUsers([]);
      syncDebug.groupEnd();
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm]);

  // Auto-search with debounce
  useEffect(() => {
    if (!open) return;
    const debounceTimer = setTimeout(() => {
      searchUsers(searchTerm);
    }, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchTerm, open, searchUsers]);

  // Load users when dialog opens
  useEffect(() => {
    if (open && !hasSearched) {
      searchUsers('');
    }
  }, [open, hasSearched, searchUsers]);

  const handleSelect = (user: UserProfile) => {
    syncDebug.log('User selected:', {
      id: user.id,
      email: user.email,
      siteCount: user.user_sites?.length || 0,
      sites: user.user_sites?.map(s => ({ id: s.site_id.slice(0, 8), name: s.site_name, default: s.is_default })),
    });
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
      setShowDiagnostics(false);
    }
  };

  const handleCopyDebugReport = async () => {
    const report = createDebugReport({
      component: 'UserSearchDialog',
      action: 'searchUsers',
      sessionUserId: diagnostics.sessionUserId,
      requestDetails: {
        functionName: 'search-users',
        status: diagnostics.lastStatus,
        responseTimeMs: diagnostics.responseTimeMs || undefined,
      },
      error: lastError || undefined,
      extra: {
        userCount: diagnostics.userCount,
        source: diagnostics.source,
        dbCheckResult: diagnostics.dbCheckResult,
      },
    });
    
    const success = await copyDebugReport(report);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Debug report copied to clipboard' });
    }
  };

  const handleTestFunction = async () => {
    setTestModalOpen(true);
    setTestResponse('Loading...');
    try {
      const { data, error } = await supabase.functions.invoke('search-users', {
        body: { searchTerm: '' },
      });
      if (error) {
        setTestResponse(JSON.stringify({ error: error.message }, null, 2));
      } else {
        setTestResponse(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      setTestResponse(JSON.stringify({ exception: String(err) }, null, 2));
    }
  };

  const envWarning = diagnostics.envInfo && (!diagnostics.envInfo.urlConfigured || !diagnostics.envInfo.anonKeyConfigured);

  return (
    <>
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

          {/* Environment Warning */}
          {envWarning && (
            <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>Supabase environment not configured properly</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers(searchTerm)}
              />
              <Button onClick={() => searchUsers(searchTerm)} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Loading users...</span>
                  <span className="text-xs">Started {diagnostics.lastRequestAt ? new Date(diagnostics.lastRequestAt).toLocaleTimeString() : ''}</span>
                </div>
              ) : users.length > 0 ? (
                users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleSelect(user)}
                    className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                  >
                    <div className="font-medium">{user.full_name || user.email || user.id}</div>
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
                      {user.user_sites && user.user_sites.length > 0 ? (
                        <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded">
                          <MapPin className="h-3 w-3" />
                          {user.user_sites.length} site{user.user_sites.length !== 1 ? 's' : ''}
                          {user.default_site_id && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
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
                <div className="text-center py-4 space-y-3">
                  <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                  <div className="text-sm text-destructive font-medium">Failed to load users ({lastError.code})</div>
                  <div className="text-xs text-muted-foreground px-4">{lastError.message}</div>
                  {lastError.details && <div className="text-xs text-muted-foreground px-4">{lastError.details}</div>}
                  
                  {/* DB Check Result */}
                  {diagnostics.dbCheckResult && (
                    <div className={`text-xs flex items-center justify-center gap-1 ${diagnostics.dbCheckResult === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                      {diagnostics.dbCheckResult === 'success' ? (
                        <><Database className="h-3 w-3" /> Direct DB: OK (Edge function issue)</>
                      ) : (
                        <><Wifi className="h-3 w-3" /> Direct DB: Failed (Connectivity issue)</>
                      )}
                    </div>
                  )}
                </div>
              ) : hasSearched ? (
                <div className="text-center py-4 space-y-2">
                  <div className="text-muted-foreground">No users returned</div>
                  <div className="text-xs text-muted-foreground">
                    {diagnostics.responseTimeMs && `Response in ${diagnostics.responseTimeMs}ms`}
                    {diagnostics.source && ` • Source: ${diagnostics.source}`}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-4">
                  Click search or press Enter to find users
                </div>
              )}
            </div>

            {/* Diagnostics Panel */}
            {hasSearched && (
              <Collapsible open={showDiagnostics} onOpenChange={setShowDiagnostics}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full flex items-center gap-2 text-xs">
                    <Bug className="h-3 w-3" />
                    {showDiagnostics ? 'Hide' : 'View'} Diagnostics
                    {showDiagnostics ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="p-3 rounded bg-muted text-xs font-mono space-y-1">
                    <div><span className="text-muted-foreground">Status:</span> {diagnostics.lastStatus}</div>
                    <div><span className="text-muted-foreground">Request at:</span> {diagnostics.lastRequestAt || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Response time:</span> {diagnostics.responseTimeMs ?? 'N/A'}ms</div>
                    <div><span className="text-muted-foreground">Users:</span> {diagnostics.userCount ?? 'N/A'}</div>
                    <div><span className="text-muted-foreground">Source:</span> {diagnostics.source || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Session:</span> {diagnostics.sessionUserId ? `${diagnostics.sessionUserId.slice(0, 8)}...` : 'none'}</div>
                    <div><span className="text-muted-foreground">Project:</span> {diagnostics.envInfo?.projectRef || 'unknown'}</div>
                    {diagnostics.dbCheckResult && (
                      <div><span className="text-muted-foreground">DB Check:</span> {diagnostics.dbCheckResult}</div>
                    )}
                    
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={handleCopyDebugReport} className="flex-1">
                        {copied ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                        {copied ? 'Copied!' : 'Copy Debug Report'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleTestFunction}>
                        Test Function
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Function Modal */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Raw Function Response</DialogTitle>
            <DialogDescription>Direct response from search-users edge function</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="p-4 bg-muted rounded text-xs font-mono whitespace-pre-wrap">
              {testResponse}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
