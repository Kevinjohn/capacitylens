import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useStore } from '@/store/useStore';
import { useAuth } from './authContext';
import { NO_ACCESS, PermissionContext } from './permissionContext';
import type { AccessGrant, Role } from '@capacitylens/shared/domain/access';
import { refreshCompanySummaries } from './useCompanySummaries';
import { masqueradeApi } from './masqueradeApi';
import { adoptMasqueradeStatus, captureMasqueradeStatusGuard } from './companyTransition';
import type { AccessPermissionStatus } from '@/lib/accessCopy';

interface FetchedPermission {
  companyId: string;
  membershipRevision: number;
  status: 'resolved' | 'unavailable';
  role?: Role;
  grant?: AccessGrant;
}

interface PermissionRefresh {
  companyId: string;
  membershipRevision: number;
  isCurrent: () => boolean;
  setFetched: Dispatch<SetStateAction<FetchedPermission | null>>;
}

interface PermissionValueInput {
  enabled: boolean;
  activeCompanyId: string | null;
  fetched: FetchedPermission | null;
  masqueradeActive: boolean;
  masqueradeRole: Role | null;
  masqueradeGrant: AccessGrant | null;
}

interface PermissionValue {
  role: Role | null;
  status: AccessPermissionStatus;
  grant: AccessGrant;
}

function publishUnavailable(refresh: PermissionRefresh) {
  if (!refresh.isCurrent()) return;
  refresh.setFetched({
    companyId: refresh.companyId,
    membershipRevision: refresh.membershipRevision,
    status: 'unavailable',
  });
}

async function refreshPermission(refresh: PermissionRefresh) {
  try {
    // Adopt masquerade status before publishing an effective role so reloads never render one
    // writable frame under a masqueraded session.
    const projectionIsCurrent = await captureMasqueradeStatusGuard();
    const isCurrent = () => refresh.isCurrent() && projectionIsCurrent();
    if (!isCurrent()) return;
    const masquerade = await masqueradeApi.status(refresh.companyId);
    if (!isCurrent()) return;
    if (!(await adoptMasqueradeStatus(masquerade, isCurrent))) return;
    if (!refresh.isCurrent()) return;
    // One validated request drives the company directory and permission projection while retaining their
    // distinct failure postures.
    const summaries = await refreshCompanySummaries({
      acceptEffects: refresh.isCurrent,
    });
    if (summaries === null) {
      publishUnavailable(refresh);
      return;
    }
    // A malformed role or grant remains selectable only as an unavailable Viewer summary and never
    // grants access.
    const entry = summaries.find((company) => company.id === refresh.companyId);
    if (!entry || entry.roleStatus === 'unavailable' || !entry.grant) {
      publishUnavailable(refresh);
      return;
    }
    if (!refresh.isCurrent()) return;
    refresh.setFetched({
      companyId: refresh.companyId,
      membershipRevision: refresh.membershipRevision,
      status: 'resolved',
      role: entry.role,
      grant: entry.grant,
    });
  } catch (error) {
    // Keep the fail-closed Viewer projection until a later successful lookup.
    console.warn('PermissionProvider: the active account role could not be resolved', error);
    publishUnavailable(refresh);
  }
}

function resolvePermissionValue(input: PermissionValueInput): PermissionValue {
  if (input.masqueradeActive) {
    return input.masqueradeRole && input.masqueradeGrant
      ? { role: input.masqueradeRole, status: 'resolved', grant: input.masqueradeGrant }
      : { role: 'viewer', status: 'pending', grant: NO_ACCESS };
  }
  if (!input.enabled || !input.activeCompanyId) {
    return { role: null, status: 'not-applicable', grant: NO_ACCESS };
  }
  if (input.fetched?.status === 'resolved' && input.fetched.role && input.fetched.grant) {
    return { role: input.fetched.role, status: 'resolved', grant: input.fetched.grant };
  }
  return { role: 'viewer', status: input.fetched?.status ?? 'pending', grant: NO_ACCESS };
}

/** Publishes the active company role and the server's grant from the shared validated directory. Unresolved membership projects to Viewer with no keys. */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const membershipRevision = useStore((state) => state.membershipRevision);
  const masquerade = useStore((state) => state.masquerade);
  // Tag resolved roles with companyId and membership revision so switching company immediately discards the previous role and projects Viewer until the new lookup succeeds.
  const [fetched, setFetched] = useState<FetchedPermission | null>(null);

  const enabled = user !== null;

  useEffect(() => {
    if (masquerade.kind !== 'inactive' || !enabled || !activeCompanyId) return;
    let cancelled = false;
    void refreshPermission({
      companyId: activeCompanyId,
      membershipRevision,
      isCurrent: () => !cancelled,
      setFetched,
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeCompanyId, membershipRevision, masquerade]);

  const currentFetched =
    fetched?.companyId === activeCompanyId && fetched.membershipRevision === membershipRevision
      ? fetched
      : null;
  const masqueradeState =
    masquerade.kind !== 'inactive' && masquerade.state?.companyId === activeCompanyId
      ? masquerade.state
      : null;
  // Keyed on the state object so the grant, and the context value, keep their identity per state.
  const masqueradeGrant = useMemo(
    () =>
      masqueradeState
        ? {
            permissions: masqueradeState.permissions,
            canSeePrivateNames: masqueradeState.canSeePrivateNames,
            canSeeTimeOffNote: masqueradeState.canSeeTimeOffNote,
          }
        : null,
    [masqueradeState],
  );
  const { role, status, grant } = resolvePermissionValue({
    enabled,
    activeCompanyId,
    fetched: currentFetched,
    masqueradeActive: masquerade.kind !== 'inactive',
    masqueradeRole: masqueradeState?.effectiveRole ?? null,
    masqueradeGrant,
  });

  const value = useMemo(() => ({ role, status, grant }), [role, status, grant]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
