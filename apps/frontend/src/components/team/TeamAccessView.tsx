import { useState } from 'react';
import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { AccessGrant, Role } from '@capacitylens/shared/domain/access';
import { useAuth } from '@/auth/authContext';
import { useAccessGrant, useCan, usePermissionStatus, useRole } from '@/auth/permissionContext';
import { resolveAccessLabel, resolveAccessSummary } from '@/lib/accessCopy';
import { MembersSection } from './MembersSection';
import { AdmissionRequestsPanel } from './AdmissionRequestsPanel';
import { useStore } from '@/store/useStore';
import { OwnershipTransferCard } from './OwnershipTransferCard';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { m } from '@/i18n';

interface PermissionRow {
  label: string;
  allowed: boolean;
}

interface CurrentAccessCardProps {
  accessLabel: string;
  accessSummary: string;
  effectiveRole: Role | null;
  grant: AccessGrant;
}

interface AccessManagementProps {
  masqueradeActive: boolean;
  mayManage: boolean;
  permissionStatus: ReturnType<typeof usePermissionStatus>;
}

// Rendered from the server's grant, so a view-as lists only what the read-only view allows.
function listPermissions(grant: AccessGrant): PermissionRow[] {
  const hasPermission = (key: AccessGrant['permissions'][number]) =>
    grant.permissions.includes(key);
  return [
    { label: m.access_cap_view_schedule(), allowed: hasPermission('planning:read') },
    { label: m.access_cap_edit_schedule(), allowed: hasPermission('planning:write') },
    { label: m.access_cap_manage_team(), allowed: hasPermission('members:manage') },
    { label: m.access_cap_time_off_notes(), allowed: grant.canSeeTimeOffNote },
    { label: m.access_cap_private_names(), allowed: grant.canSeePrivateNames },
    { label: m.access_cap_transfer_owner(), allowed: hasPermission('ownership:transfer') },
  ];
}

function PermissionList({ grant }: { grant: AccessGrant }) {
  return (
    <ul
      id="access-permissions"
      className="mt-3 grid gap-2 sm:grid-cols-2"
      aria-label={m.access_permissions_label()}
    >
      {listPermissions(grant).map((permission) => (
        <li key={permission.label} className="flex items-center gap-2 text-sm text-ink">
          {permission.allowed ? (
            <Check className="text-brand" />
          ) : (
            <X className="text-muted-foreground" />
          )}
          <span className="sr-only">
            {permission.allowed ? m.access_cap_allowed() : m.access_cap_not_allowed()}
          </span>
          <span className={permission.allowed ? undefined : 'text-muted-foreground'}>
            {permission.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CurrentAccessCard({
  accessLabel,
  accessSummary,
  effectiveRole,
  grant,
}: CurrentAccessCardProps) {
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  let accessDetails = null;

  if (effectiveRole) {
    // Collapse the permission reference by default so member administration remains easy to reach.
    accessDetails = (
      <>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-2 hover:underline"
          aria-expanded={permissionsOpen}
          aria-controls="access-permissions"
          data-testid="permissions-toggle"
          onClick={() => setPermissionsOpen((open) => !open)}
        >
          {permissionsOpen ? (
            <ChevronDown data-icon="inline-start" />
          ) : (
            <ChevronRight data-icon="inline-start" />
          )}
          {permissionsOpen ? m.access_permissions_hide() : m.access_permissions_show()}
        </button>
        {permissionsOpen && <PermissionList grant={grant} />}
      </>
    );
  }

  const badgeVariant = effectiveRole === 'viewer' || !effectiveRole ? 'outline' : 'default';
  return (
    <Card data-testid="current-access">
      <CardHeader>
        <CardTitle>
          <h2>{m.access_current_heading()}</h2>
        </CardTitle>
        <CardDescription>{accessSummary}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{accessLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>{accessDetails}</CardContent>
    </Card>
  );
}

function AccessManagement({
  masqueradeActive,
  mayManage,
  permissionStatus,
}: AccessManagementProps) {
  if (mayManage) return <MembersSection />;
  if (permissionStatus !== 'resolved') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{m.access_management_heading()}</h2>
        </CardTitle>
        <CardDescription>
          {masqueradeActive ? m.access_management_masquerade() : m.access_management_restricted()}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Coordinates member management, invitations, admission approval, and ownership. */
export function TeamAccessView() {
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const { user } = useAuth();
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const masqueradeActive = useStore((state) => state.masquerade.kind !== 'inactive');
  const resolvedRole = permissionStatus === 'resolved' ? role : null;
  const effectiveRole: Role | null = resolvedRole;
  const grant = useAccessGrant();
  const mayManage = useCan('members:manage');
  const mayTransferOwnership = useCan('ownership:transfer');
  const accessCopyInput = {
    permissionStatus,
    role: resolvedRole,
  };
  const accessLabel = resolveAccessLabel(accessCopyInput);
  // A view-as is read-only whatever the viewed member's role, so the role summary would overclaim.
  const accessSummary = masqueradeActive
    ? m.notice_masquerade_read_only()
    : resolveAccessSummary(accessCopyInput);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">{m.access_title()}</h1>
      </header>

      <CurrentAccessCard
        accessLabel={accessLabel}
        accessSummary={accessSummary}
        effectiveRole={effectiveRole}
        grant={grant}
      />

      {/* Resolve permission before mounting: lower roles must not issue privileged directory reads
          merely by visiting this page. */}
      <AccessManagement
        masqueradeActive={masqueradeActive}
        mayManage={mayManage}
        permissionStatus={permissionStatus}
      />

      {!masqueradeActive && isOwnerOrAdmin(resolvedRole) && (
        <AdmissionRequestsPanel key={JSON.stringify([activeCompanyId, user?.id])} />
      )}

      {/* Ownership changes remain an online action of the real Owner, never the masqueraded target. */}
      {!masqueradeActive && mayTransferOwnership && <OwnershipTransferCard />}
    </div>
  );
}
