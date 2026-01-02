import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bug, Settings, Terminal } from 'lucide-react';
import { isDebugEnabled, setDebugEnabled, initErrorHandlers } from '@/lib/debugLogger';

interface DebugModeToggleProps {
  variant?: 'button' | 'switch' | 'menu-item';
  showLabel?: boolean;
}

export default function DebugModeToggle({ 
  variant = 'button',
  showLabel = true 
}: DebugModeToggleProps) {
  const [enabled, setEnabled] = useState(false);

  // Initialize on mount
  useEffect(() => {
    setEnabled(isDebugEnabled());
    if (isDebugEnabled()) {
      initErrorHandlers();
    }
  }, []);

  // Keyboard shortcut (Ctrl+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        handleToggle();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  const handleToggle = useCallback(() => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    setDebugEnabled(newEnabled);
    if (newEnabled) {
      initErrorHandlers();
    }
  }, [enabled]);

  if (variant === 'switch') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          id="debug-mode"
          checked={enabled}
          onCheckedChange={handleToggle}
        />
        {showLabel && (
          <Label htmlFor="debug-mode" className="text-sm cursor-pointer">
            Debug Mode
          </Label>
        )}
      </div>
    );
  }

  if (variant === 'menu-item') {
    return (
      <DropdownMenuItem onClick={handleToggle} className="gap-2">
        <Bug className="h-4 w-4" />
        <span>Debug Mode</span>
        <span className={`ml-auto text-xs ${enabled ? 'text-green-600' : 'text-muted-foreground'}`}>
          {enabled ? 'ON' : 'OFF'}
        </span>
      </DropdownMenuItem>
    );
  }

  // Default: button variant
  return (
    <Button
      variant={enabled ? 'secondary' : 'ghost'}
      size="sm"
      onClick={handleToggle}
      className="gap-2"
      title="Toggle Debug Mode (Ctrl+Shift+D)"
    >
      <Bug className={`h-4 w-4 ${enabled ? 'text-green-600' : ''}`} />
      {showLabel && <span className="text-xs">Debug</span>}
    </Button>
  );
}

// Developer menu with debug toggle and other options
export function DeveloperMenu() {
  const [debugEnabled, setDebugEnabledState] = useState(false);

  useEffect(() => {
    setDebugEnabledState(isDebugEnabled());
  }, []);

  const handleDebugToggle = useCallback(() => {
    const newEnabled = !debugEnabled;
    setDebugEnabledState(newEnabled);
    setDebugEnabled(newEnabled);
    if (newEnabled) {
      initErrorHandlers();
    }
  }, [debugEnabled]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          <span className="text-xs">Developer</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleDebugToggle} className="gap-2">
          <Bug className="h-4 w-4" />
          <span>Debug Mode</span>
          <span className={`ml-auto text-xs ${debugEnabled ? 'text-green-600' : 'text-muted-foreground'}`}>
            {debugEnabled ? 'ON' : 'OFF'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          <Terminal className="h-4 w-4 mr-2" />
          Ctrl+Shift+D
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
