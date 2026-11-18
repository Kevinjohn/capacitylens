import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useStore } from '@/store/useStore';
import { useAuth } from './authContext';
import { NO_ACCESS, PermissionContext } from './permissionContext';
import type { AccessGrant, PermissionKey, Role } from '@capacitylens/shared/domain/access';
import { refreshAccountSummaries } from './useAccountSummaries';
import { masqueradeApi } from './masqueradeApi';
import { adoptMasqueradeStatus, captureMasqueradeStatusGuard } from './accountTransition';
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
  setActiveRole: (
    role: Role | null,
    status?: AccessPermissionStatus,
    permissions?: PermissionKey[],
  ) => void;
}

interface PermissionValueInput {
  enabled: boolean;
  activeAccountId: string | null;
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
  refresh.setActiveRole('viewer', 'unavailable');
  refresh.setFetched({
    companyId: refresh.companyId,
    membershipRevision: refresh.membershipRevision,
    status: 'unavailable',
  });
}

async function refreshPermission(refresh: PermissionRefresh) {
  // Reset the store role before the first await so a prior tenant's role cannot leak while the new
  // fetch is in flight. The provider value is independently keyed and already projects Viewer.
  refresh.setActiveRole('viewer', 'pending');
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
    const summaries = await refreshAccountSummaries({
      acceptEffects: refresh.isCurrent,
    });
    if (summaries === null) {
      publishUnavailable(refresh);
      return;
    }
    // A malformed role or grant remains selectable only as an unavailable Viewer summary and never
    // grants access.
    const entry = summaries.find((account) => account.id === refresh.companyId);
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
    refresh.setActiveRole(entry.role, 'resolved', entry.grant.permissions);
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
  if (!input.enabled || !input.activeAccountId) {
    return { role: null, status: 'not-applicable', grant: NO_ACCESS };
  }
  if (input.fetched?.status === 'resolved' && input.fetched.role && input.fetched.grant) {
    return { role: input.fetched.role, status: 'resolved', grant: input.fetched.grant };
  }
  return { role: 'viewer', status: input.fetched?.status ?? 'pending', grant: NO_ACCESS };
}

/** Publishes the active company role and the server's grant from the shared validated directory. Unresolved membership projects to Viewer with no keys; the store independently applies the same read-only guard. */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setActiveRole = useStore((state) => state.setActiveRole);
  const membershipRevision = useStore((state) => state.membershipRevision);
  const masquerade = useStore((state) => state.masquerade);
  // Tag resolved roles with companyId and membership revision so switching company immediately discards the previous role and projects Viewer until the new lookup succeeds.
  const [fetched, setFetched] = useState<FetchedPermission | null>(null);

  const enabled = user !== null;

  useEffect(() => {
    if (masquerade.kind !== 'inactive') {
      const state = masquerade.state;
      if (state && state.companyId === activeAccountId) {
        setActiveRole(state.effectiveRole, 'resolved', state.permissions);
      } else {
        setActiveRole('viewer', 'pending');
      }
      return;
    }

    if (!enabled || !activeAccountId) {
      setActiveRole(null, 'not-applicable');
      return;
    }
    let cancelled = false;
    void refreshPermission({
      companyId: activeAccountId,
      membershipRevision,
      isCurrent: () => !cancelled,
      setFetched,
      setActiveRole,
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeAccountId, membershipRevision, masquerade, setActiveRole]);

  const currentFetched =
    fetched?.companyId === activeAccountId && fetched.membershipRevision === membershipRevision
      ? fetched
      : null;
  const masqueradeState =
    masquerade.kind !== 'inactive' && masquerade.state?.companyId === activeAccountId
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
    activeAccountId,
    fetched: currentFetched,
    masqueradeActive: masquerade.kind !== 'inactive',
    masqueradeRole: masqueradeState?.effectiveRole ?? null,
    masqueradeGrant,
  });

  const value = useMemo(() => ({ role, status, grant }), [role, status, grant]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
