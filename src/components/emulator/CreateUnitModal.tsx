import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Box, AlertCircle } from 'lucide-react';
import { OrgStateUnit } from '@/lib/frostguardOrgSync';
import { log } from '@/lib/debugLogger';

interface CreateUnitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  siteId: string;
  siteName?: string;
  existingUnits: OrgStateUnit[];
  onSuccess: (unit: OrgStateUnit) => void;
  onCreateUnit: (data: { name: string; description?: string; location?: string }) => Promise<OrgStateUnit>;
}

export default function CreateUnitModal({
  open,
  onOpenChange,
  orgId,
  siteId,
  siteName,
  existingUnits,
  onSuccess,
  onCreateUnit,
}: CreateUnitModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for duplicate names in the same site
  const isDuplicate = existingUnits.some(
    u => u.site_id === siteId && u.name.toLowerCase() === name.trim().toLowerCase()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Unit name is required');
      return;
    }
    
    if (isDuplicate) {
      setError('A unit with this name already exists in this site');
      return;
    }

    setIsCreating(true);
    setError(null);

    log('context', 'info', 'UNIT_CREATE_REQUEST', {
      org_id: orgId,
      site_id: siteId,
      name: name.trim(),
    });

    try {
      const unit = await onCreateUnit({
        name: name.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      });

      log('context', 'info', 'UNIT_CREATE_SUCCESS', {
        unit_id: unit.id,
        name: unit.name,
      });

      // Reset form
      setName('');
      setDescription('');
      setLocation('');
      
      onSuccess(unit);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create unit';
      log('context', 'error', 'UNIT_CREATE_ERROR', { error: message });
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setName('');
      setDescription('');
      setLocation('');
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-primary" />
            Create New Unit
          </DialogTitle>
          <DialogDescription>
            Add a new unit (freezer, storage area, etc.) to{' '}
            <span className="font-medium">{siteName || 'this site'}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Unit Name - Required */}
          <div className="space-y-2">
            <Label htmlFor="unit-name">
              Unit Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="unit-name"
              placeholder="e.g., Walk-in Freezer, Cooler 1"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              disabled={isCreating}
              autoFocus
            />
            {isDuplicate && name.trim() && (
              <p className="text-xs text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                A unit with this name already exists
              </p>
            )}
          </div>

          {/* Description - Optional */}
          <div className="space-y-2">
            <Label htmlFor="unit-description">
              Description <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              id="unit-description"
              placeholder="What is this unit used for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isCreating}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Location - Optional */}
          <div className="space-y-2">
            <Label htmlFor="unit-location">
              Location <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Input
              id="unit-location"
              placeholder="e.g., Back of kitchen, Loading dock"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={isCreating}
            />
          </div>

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !name.trim() || isDuplicate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Unit'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
