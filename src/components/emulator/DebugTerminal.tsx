import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ChevronDown, ChevronUp, X, Search, Trash2, Pause, Play, 
  Download, Copy, User, Building2, Hash, Clock, Radio,
  Network, RefreshCw, AlertTriangle, Bug, Cpu
} from 'lucide-react';
import { 
  DebugEntry, DebugCategory, DebugLevel,
  getEntries, getDebugContext, subscribe, clearEntries, 
  exportEntries, setPaused, getIsPaused, isDebugEnabled
} from '@/lib/debugLogger';
import { toast } from '@/hooks/use-toast';

const CATEGORY_ICONS: Record<DebugCategory, React.ReactNode> = {
  'context': <User className="h-3 w-3" />,
  'network': <Network className="h-3 w-3" />,
  'org-sync': <RefreshCw className="h-3 w-3" />,
  'ttn': <Radio className="h-3 w-3" />,
  'provisioning': <Cpu className="h-3 w-3" />,
  'error': <AlertTriangle className="h-3 w-3" />,
};

const LEVEL_COLORS: Record<DebugLevel, string> = {
  'debug': 'text-muted-foreground',
  'info': 'text-foreground',
  'warn': 'text-yellow-600 dark:text-yellow-400',
  'error': 'text-red-600 dark:text-red-400',
};

const CATEGORY_LABELS: Record<DebugCategory, string> = {
  'context': 'Context',
  'network': 'Network',
  'org-sync': 'Org Sync',
  'ttn': 'TTN',
  'provisioning': 'Provisioning',
  'error': 'Errors',
};

interface DebugTerminalProps {
  className?: string;
}

export default function DebugTerminal({ className }: DebugTerminalProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [context, setContext] = useState(getDebugContext());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<DebugCategory | 'all'>('all');
  const [isPaused, setIsPausedState] = useState(getIsPaused());
  const [levelFilter, setLevelFilter] = useState<DebugLevel | 'all'>('all');

  // Subscribe to log changes
  useEffect(() => {
    const updateState = () => {
      setEntries(getEntries());
      setContext(getDebugContext());
    };
    
    updateState();
    return subscribe(updateState);
  }, []);

  // Keyboard shortcut (Ctrl+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsExpanded(prev => !prev);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter entries
  const filteredEntries = useMemo(() => {
    let filtered = entries;
    
    // Filter by category
    if (activeTab !== 'all') {
      filtered = filtered.filter(e => e.category === activeTab);
    }
    
    // Filter by level
    if (levelFilter !== 'all') {
      filtered = filtered.filter(e => e.level === levelFilter);
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.message.toLowerCase().includes(query) ||
        JSON.stringify(e.data || {}).toLowerCase().includes(query)
      );
    }
    
    return filtered.slice().reverse(); // Newest first
  }, [entries, activeTab, levelFilter, searchQuery]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const category of Object.keys(CATEGORY_LABELS) as DebugCategory[]) {
      counts[category] = entries.filter(e => e.category === category).length;
    }
    return counts;
  }, [entries]);

  // Error count for badge
  const errorCount = useMemo(() => 
    entries.filter(e => e.level === 'error').length
  , [entries]);

  const handlePauseToggle = useCallback(() => {
    const newPaused = !isPaused;
    setPaused(newPaused);
    setIsPausedState(newPaused);
  }, [isPaused]);

  const handleClear = useCallback(() => {
    clearEntries();
    toast({ title: 'Logs cleared' });
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(exportEntries());
    toast({ title: 'Logs copied to clipboard' });
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([exportEntries()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emulator-debug-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Logs exported' });
  }, []);

  // Don't render if debug mode is disabled
  if (!isDebugEnabled()) {
    return null;
  }

  // Collapsed bar
  if (!isExpanded) {
    return (
      <div className={`fixed bottom-0 left-0 right-0 z-50 ${className}`}>
        <Card className="rounded-none border-x-0 border-b-0 bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(true)}
                className="gap-2"
              >
                <Bug className="h-4 w-4" />
                <span className="text-xs font-mono">Debug Terminal</span>
                <ChevronUp className="h-4 w-4" />
              </Button>
              
              {errorCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {errorCount} errors
                </Badge>
              )}
              
              <span className="text-xs text-muted-foreground">
                {entries.length} entries
              </span>
            </div>

            {/* Mini context display */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {context.userEmail && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {context.userEmail}
                </span>
              )}
              {context.syncVersion !== undefined && (
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  v{context.syncVersion}
                </span>
              )}
              <span className="opacity-50">Ctrl+Shift+D</span>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Expanded terminal
  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 ${className}`}>
      <Card className="rounded-none border-x-0 border-b-0 bg-background/95 backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium flex items-center gap-2">
              <Bug className="h-4 w-4" />
              Debug Terminal
            </span>
            {isPaused && (
              <Badge variant="secondary" className="text-xs">PAUSED</Badge>
            )}
          </div>

          {/* Context bar */}
          <div className="flex items-center gap-4 text-xs">
            {context.userEmail && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <User className="h-3 w-3" />
                {context.userEmail}
              </span>
            )}
            {context.orgName && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {context.orgName}
              </span>
            )}
            {context.syncVersion !== undefined && (
              <Badge variant="outline" className="text-xs font-mono">
                <Hash className="h-3 w-3 mr-1" />
                v{context.syncVersion}
              </Badge>
            )}
            {context.lastSyncAt && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(context.lastSyncAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePauseToggle}>
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClear}>
              <Trash2 className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
              <Copy className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}>
              <Download className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Tabs and filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DebugCategory | 'all')}>
            <TabsList className="h-7">
              <TabsTrigger value="all" className="text-xs px-2 h-6">
                All ({categoryCounts.all})
              </TabsTrigger>
              {(Object.keys(CATEGORY_LABELS) as DebugCategory[]).map(cat => (
                <TabsTrigger key={cat} value={cat} className="text-xs px-2 h-6 gap-1">
                  {CATEGORY_ICONS[cat]}
                  {CATEGORY_LABELS[cat]}
                  {categoryCounts[cat] > 0 && (
                    <span className="opacity-60">({categoryCounts[cat]})</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex-1" />

          {/* Level filter */}
          <div className="flex items-center gap-1">
            {(['all', 'debug', 'info', 'warn', 'error'] as const).map(level => (
              <Button
                key={level}
                variant={levelFilter === level ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setLevelFilter(level)}
              >
                {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
              </Button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="h-7 w-48 pl-7 text-xs"
            />
          </div>
        </div>

        {/* Log entries */}
        <ScrollArea className="h-64">
          <div className="p-2 font-mono text-xs space-y-1">
            {filteredEntries.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No log entries {searchQuery && `matching "${searchQuery}"`}
              </div>
            ) : (
              filteredEntries.map(entry => (
                <LogEntryRow key={entry.id} entry={entry} />
              ))
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

function LogEntryRow({ entry }: { entry: DebugEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasData = entry.data && Object.keys(entry.data).length > 0;

  return (
    <div 
      className={`rounded px-2 py-1 hover:bg-muted/50 cursor-pointer ${
        entry.level === 'error' ? 'bg-red-500/10' : 
        entry.level === 'warn' ? 'bg-yellow-500/10' : ''
      }`}
      onClick={() => hasData && setIsExpanded(!isExpanded)}
    >
      <div className="flex items-start gap-2">
        {/* Timestamp */}
        <span className="text-muted-foreground shrink-0">
          {entry.timestamp.toLocaleTimeString()}.{String(entry.timestamp.getMilliseconds()).padStart(3, '0')}
        </span>
        
        {/* Category */}
        <span className="shrink-0 opacity-60">
          {CATEGORY_ICONS[entry.category]}
        </span>
        
        {/* Level badge */}
        <span className={`shrink-0 uppercase text-[10px] font-bold ${LEVEL_COLORS[entry.level]}`}>
          {entry.level}
        </span>
        
        {/* Message */}
        <span className={LEVEL_COLORS[entry.level]}>
          {entry.message}
        </span>
        
        {/* Duration if present */}
        {entry.duration !== undefined && (
          <span className="text-muted-foreground ml-auto shrink-0">
            {entry.duration}ms
          </span>
        )}
        
        {/* Expand indicator */}
        {hasData && (
          <span className="text-muted-foreground ml-auto shrink-0">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
      </div>
      
      {/* Expanded data */}
      {isExpanded && hasData && (
        <pre className="mt-1 ml-6 p-2 bg-muted/50 rounded text-[10px] overflow-x-auto">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
