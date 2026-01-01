import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { User, X } from 'lucide-react';
import { WebhookConfig } from '@/lib/ttn-payload';
import UserSearchDialog, { UserProfile } from './UserSearchDialog';

interface UserContextSelectorProps {
  config: WebhookConfig;
  onConfigChange: (config: WebhookConfig) => void;
  disabled?: boolean;
}

export default function UserContextSelector({
  config,
  onConfigChange,
  disabled
}: UserContextSelectorProps) {
  const [showUserSearch, setShowUserSearch] = useState(false);

  const handleUserSelect = (user: UserProfile) => {
    const selectTime = new Date().toISOString();
    const ttn = user.ttn || null;

    // Determine site to use
    let siteToSelect: string | undefined = undefined;
    const sites = user.user_sites || [];

    if (user.default_site_id) {
      siteToSelect = user.default_site_id;
    } else if (sites.length > 0) {
      siteToSelect = sites[0].site_id;
    } else if (user.site_id) {
      siteToSelect = user.site_id;
    }

    // Build TTN config from user data
    const ttnConfig = ttn ? {
      enabled: ttn.enabled || false,
      applicationId: ttn.application_id || '',
      cluster: ttn.cluster || 'eu1',
      api_key_last4: ttn.api_key_last4 || null,
      webhook_secret_last4: ttn.webhook_secret_last4 || null,
    } : undefined;

    onConfigChange({
      ...config,
      testOrgId: user.organization_id,
      testSiteId: siteToSelect,
      testUnitId: user.unit_id || undefined,
      selectedUserId: user.id,
      selectedUserDisplayName: user.full_name || user.email || user.id,
      selectedUserSites: sites.map(s => ({
        site_id: s.site_id,
        site_name: s.site_name || null,
        is_default: s.site_id === user.default_site_id || s.is_default || false,
      })),
      contextSetAt: selectTime,
      ttnConfig,
    });

    setShowUserSearch(false);
  };

  const handleClearUser = () => {
    const { selectedUserId, selectedUserDisplayName, selectedUserSites, ttnConfig, ...restConfig } = config;
    onConfigChange(restConfig);
  };

  return (
    <>
      <Card className="mb-4">
        <div className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1">
              <User className="h-4 w-4 text-muted-foreground" />
              {config.selectedUserId ? (
                <div className="flex items-center gap-2 flex-1">
                  <Badge variant="secondary" className="font-normal">
                    {config.selectedUserDisplayName}
                  </Badge>
                  {config.testOrgId && (
                    <span className="text-xs text-muted-foreground">
                      Org: {config.testOrgId.slice(0, 8)}...
                    </span>
                  )}
                  {config.testSiteId && (
                    <span className="text-xs text-muted-foreground">
                      Site: {config.testSiteId.slice(0, 8)}...
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearUser}
                    disabled={disabled}
                    className="ml-auto"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-muted-foreground">No user selected</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUserSearch(true)}
                    disabled={disabled}
                    className="ml-auto"
                  >
                    <User className="h-4 w-4 mr-2" />
                    Select User
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <UserSearchDialog
        open={showUserSearch}
        onClose={() => setShowUserSearch(false)}
        onUserSelect={handleUserSelect}
        disabled={disabled || false}
        cachedUserCount={null}
      />
    </>
  );
}
