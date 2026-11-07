import { useState } from 'react';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import type { CompanyAccess, PermissionKey } from '@capacitylens/shared/account/permissions';
import type { Role } from '@capacitylens/shared/domain/access';
import { useAuth } from '@/auth/authContext';
import { useCompanyAccess, usePermissionStatus, useRole } from '@/auth/permissionContext';
import { resolveAccessLabel, resolveAccessSummary } from '@/lib/accessCopy';
import { resolveAccessExperience } from '@/lib/resolveAccessExperience';
import { MembersSection } from './MembersSection';
import { AdmissionRequestsPanel } from './AdmissionRequestsPanel';
import { useStore } from '@/store/useStore';
import { OwnershipTransferCard } from './OwnershipTransferCard';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { m } from '@/i18n';

interface Capability {
  label: string;
  allowed: boolean;
}

interface CurrentAccessCardProps {
  accessLabel: string;
  accessSummary: string;
  accessWarning: string | null;
  effectiveRole: Role | null;
  access: CompanyAccess | null;
}

interface AccessManagementProps {
  authenticated: boolean;
  mayManage: boolean;
  permissionStatus: ReturnType<typeof usePermissionStatus>;
}

interface ResolveAccessWarningInput {
  accessExperience: ReturnType<typeof resolveAccessExperience>;
}

// Server-derived permissions decide the capability card; during view-as the snapshot is read-only,
// so even an Owner projection advertises no writes. Field visibility keeps the role predicates.
function listCapabilities(access: CompanyAccess | null, role: Role): Capability[] {
  const has = (key: PermissionKey) => access?.permissions.includes(key) ?? false;
  return [
    { label: m.access_cap_view_schedule(), allowed: has('planning:read') },
    { label: m.access_cap_edit_schedule(), allowed: has('planning:write') },
    { label: m.access_cap_manage_team(), allowed: has('members:manage') },
    { label: m.access_cap_timeoff_notes(), allowed: canSeeTimeOffNote(role) },
    { label: m.access_cap_private_names(), allowed: canSeePrivateNames(role) },
    { label: m.access_cap_transfer_owner(), allowed: has('ownership:transfer') },
  ];
}

function resolveAccessWarning({ accessExperience }: ResolveAccessWarningInput) {
  if (accessExperience === 'demo') return m.access_demo_warning();
  return null;
}

function CapabilityList({ access, role }: { access: CompanyAccess | null; role: Role }) {
  return (
    <ul
      id="access-capabilities"
      className="mt-3 grid gap-2 sm:grid-cols-2"
      aria-label={m.access_capabilities_label()}
    >
      {listCapabilities(access, role).map((capability) => (
        <li key={capability.label} className="flex items-center gap-2 text-sm text-ink">
          {capability.allowed ? (
            <Check className="text-brand" />
          ) : (
            <X className="text-muted-foreground" />
          )}
          <span className="sr-only">
            {capability.allowed ? m.access_cap_allowed() : m.access_cap_not_allowed()}
          </span>
          <span className={capability.allowed ? undefined : 'text-muted-foreground'}>
            {capability.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CurrentAccessCard({
  accessLabel,
  accessSummary,
  accessWarning,
  effectiveRole,
  access,
}: CurrentAccessCardProps) {
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  let accessDetails = null;

  if (effectiveRole) {
    // Collapse the capability reference by default so member administration remains easy to reach.
    accessDetails = (
      <>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-2 hover:underline"
          aria-expanded={capabilitiesOpen}
          aria-controls="access-capabilities"
          data-testid="capabilities-toggle"
          onClick={() => setCapabilitiesOpen((open) => !open)}
        >
          {capabilitiesOpen ? (
            <ChevronDown data-icon="inline-start" />
          ) : (
            <ChevronRight data-icon="inline-start" />
          )}
          {capabilitiesOpen ? m.access_capabilities_hide() : m.access_capabilities_show()}
        </button>
        {capabilitiesOpen && <CapabilityList access={access} role={effectiveRole} />}
      </>
    );
  } else if (accessWarning) {
    accessDetails = (
      <Alert>
        <AlertDescription>{accessWarning}</AlertDescription>
      </Alert>
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

function AccessManagement({ authenticated, mayManage, permissionStatus }: AccessManagementProps) {
  if (!authenticated) {
    return (
      <Alert>
        <AlertDescription>{m.access_members_demo_note()}</AlertDescription>
      </Alert>
    );
  }
  if (mayManage) return <MembersSection />;
  if (permissionStatus !== 'resolved') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{m.access_management_heading()}</h2>
        </CardTitle>
        <CardDescription>{m.access_management_restricted()}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Coordinates member management, invitations, admission approval, and ownership. */
export function TeamAccessView() {
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { user } = useAuth();
  const role = useRole();
  const access = useCompanyAccess();
  const permissionStatus = usePermissionStatus();
  const masqueradeActive = useStore((state) => state.masquerade.kind !== 'inactive');
  const accessExperience = resolveAccessExperience();
  const authenticated = accessExperience === 'authenticated';
  const resolvedRole = authenticated && permissionStatus === 'resolved' ? role : null;
  const effectiveRole: Role | null = resolvedRole;
  const resolvedAccess = resolvedRole !== null ? access : null;
  const mayManage = resolvedAccess?.permissions.includes('members:manage') ?? false;
  const accessCopyInput = {
    experience: accessExperience,
    permissionStatus,
    role: resolvedRole,
  };
  const accessLabel = resolveAccessLabel(accessCopyInput);
  const accessSummary = resolveAccessSummary(accessCopyInput);
  const accessWarning = resolveAccessWarning({
    accessExperience,
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">{m.access_title()}</h1>
      </header>

      <CurrentAccessCard
        accessLabel={accessLabel}
        accessSummary={accessSummary}
        accessWarning={accessWarning}
        effectiveRole={effectiveRole}
        access={resolvedAccess}
      />

      {/* Resolve permission before mounting: lower roles must not issue privileged directory reads
          merely by visiting this page. */}
      <AccessManagement
        authenticated={authenticated}
        mayManage={mayManage}
        permissionStatus={permissionStatus}
      />

      {authenticated &&
        !masqueradeActive &&
        (resolvedRole === 'owner' || resolvedRole === 'admin') && (
          <AdmissionRequestsPanel key={JSON.stringify([activeAccountId, user?.id])} />
        )}

      {/* Ownership changes remain an online action of the real Owner, never the masqueraded target. */}
      {authenticated && !masqueradeActive && resolvedRole === 'owner' && <OwnershipTransferCard />}
    </div>
  );
}
