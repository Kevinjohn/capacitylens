import { useState } from "react";
import { can, canSeePrivateNames, canSeeTimeOffNote } from "@capacitylens/shared/domain/access";
import type { Role } from "@capacitylens/shared/domain/access";
import { usePermissionStatus, useRole } from "@/auth/permissionContext";
import { useAuth } from "@/auth/authContext";
import { resolveAccessLabel, resolveAccessSummary } from "@/lib/accessCopy";
import { resolveAccessExperience } from "@/lib/resolveAccessExperience";
import { MembersSection } from "./MembersSection";
import { JoiningPolicyPanel } from "./JoiningPolicyPanel";
import { useStore } from "@/store/useStore";
import { OwnershipTransferCard } from "./OwnershipTransferCard";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n";

interface Capability {
  label: string;
  allowed: boolean;
}

interface CurrentAccessCardProps {
  accessLabel: string;
  accessSummary: string;
  accessWarning: string | null;
  effectiveRole: Role | null;
}

interface AccessManagementProps {
  authenticated: boolean;
  mayManage: boolean;
  permissionStatus: ReturnType<typeof usePermissionStatus>;
}

interface ResolveAccessWarningInput {
  accessExperience: ReturnType<typeof resolveAccessExperience>;
}

function listCapabilities(role: Role): Capability[] {
  return [
    { label: m.access_cap_view_schedule(), allowed: can(role, "read") },
    { label: m.access_cap_edit_schedule(), allowed: can(role, "write") },
    { label: m.access_cap_manage_team(), allowed: can(role, "manageMembers") },
    { label: m.access_cap_timeoff_notes(), allowed: canSeeTimeOffNote(role) },
    { label: m.access_cap_private_names(), allowed: canSeePrivateNames(role) },
    { label: m.access_cap_transfer_owner(), allowed: can(role, "transferOwnership") },
  ];
}

function resolveAccessWarning({ accessExperience }: ResolveAccessWarningInput) {
  if (accessExperience === "demo") return m.access_demo_warning();
  if (accessExperience === "open") return m.access_open_warning();
  return null;
}

function CapabilityList({ role }: { role: Role }) {
  return (
    <ul id="access-capabilities" className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={m.access_capabilities_label()}>
      {listCapabilities(role).map((capability) => (
        <li key={capability.label} className="flex items-center gap-2 text-sm text-ink">
          {capability.allowed ? <Check className="text-brand" /> : <X className="text-muted-foreground" />}
          <span className="sr-only">{capability.allowed ? m.access_cap_allowed() : m.access_cap_not_allowed()}</span>
          <span className={capability.allowed ? undefined : "text-muted-foreground"}>{capability.label}</span>
        </li>
      ))}
    </ul>
  );
}

function CurrentAccessCard({ accessLabel, accessSummary, accessWarning, effectiveRole }: CurrentAccessCardProps) {
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
          {capabilitiesOpen ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
          {capabilitiesOpen ? m.access_capabilities_hide() : m.access_capabilities_show()}
        </button>
        {capabilitiesOpen && <CapabilityList role={effectiveRole} />}
      </>
    );
  } else if (accessWarning) {
    accessDetails = (
      <Alert>
        <AlertDescription>{accessWarning}</AlertDescription>
      </Alert>
    );
  }

  const badgeVariant = effectiveRole === "viewer" || !effectiveRole ? "outline" : "default";
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
  if (permissionStatus !== "resolved") return null;

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

function PolicyManagement({
  accountId,
  role,
  enabled,
}: {
  accountId: string | null;
  role: Role | null;
  enabled: boolean;
}) {
  if (!enabled || !accountId || (role !== "owner" && role !== "admin")) return null;
  return <JoiningPolicyPanel key={accountId} accountId={accountId} role={role} />;
}

/** Coordinates member management, invitations, joining policy, and ownership. */
export function TeamAccessView() {
  const activeAccountId = useStore((state) => state.activeAccountId);
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const { authMode } = useAuth();
  const masqueradeActive = useStore((state) => state.masquerade.kind !== "inactive");
  const accessExperience = resolveAccessExperience(authMode);
  const authenticated = accessExperience === "authenticated";
  const resolvedRole = authenticated && permissionStatus === "resolved" ? role : null;
  const effectiveRole: Role | null = resolvedRole;
  const mayManage = resolvedRole !== null && can(resolvedRole, "manageMembers");
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
      />

      {/* Resolve permission before mounting: lower roles must not issue privileged directory reads
          merely by visiting this page. */}
      <AccessManagement authenticated={authenticated} mayManage={mayManage} permissionStatus={permissionStatus} />

      <PolicyManagement accountId={activeAccountId} role={resolvedRole} enabled={authenticated && mayManage} />

      {/* Ownership changes remain an online action of the real Owner, never the masqueraded target. */}
      {authenticated && !masqueradeActive && resolvedRole === "owner" && <OwnershipTransferCard />}
    </div>
  );
}
