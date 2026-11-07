import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { isServerConfigured } from '@/data/apiConfig';
import { useStore } from '@/store/useStore';
import type { StoreState } from '@/store/useStore';
import { useAuth } from './authContext';
import { PermissionContext } from './permissionContext';
import type { AuthorityKey, PermissionContextValue } from './permissionContext';
import type { Role } from '@capacitylens/shared/domain/access';
import type { CompanyAccess } from '@capacitylens/shared/account/permissions';
import { refreshAccountSummaries } from './useAccountSummaries';
import { masqueradeApi } from './masqueradeApi';
import { adoptMasqueradeStatus, captureMasqueradeStatusGuard } from './accountTransition';

interface FetchedPermission {
  principalId: string | null;
  accountId: string;
  membershipRevision: number;
  masqueradeGeneration: number;
  status: 'resolved' | 'unavailable';
  role?: Role;
  access: CompanyAccess | null;
}

interface PermissionRefresh {
  principalId: string | null;
  accountId: string;
  membershipRevision: number;
  masqueradeGeneration: number;
  isCurrent: () => boolean;
  setFetched: Dispatch<SetStateAction<FetchedPermission | null>>;
  setActiveAuthority: StoreState['setActiveAuthority'];
}

interface PermissionValueInput {
  enabled: boolean;
  activeAccountId: string | null;
  fetched: FetchedPermission | null;
  masqueradeActive: boolean;
  masqueradeRole: Role | null;
}

/** The masquerade generation used to key authority snapshots; zero while inactive. */
function readMasqueradeGeneration(masquerade: StoreState['masquerade']): number {
  return masquerade.kind === 'inactive' ? 0 : masquerade.generation;
}

/** View-as is a read-only projection: the effective role reads, nothing else. */
function masqueradeAccess(accountId: string, role: Role): CompanyAccess {
  return { scopeId: accountId, role, permissions: ['planning:read'], assignableRoles: [] };
}

function publishUnavailable(refresh: PermissionRefresh) {
  if (!refresh.isCurrent()) return;
  refresh.setActiveAuthority({ role: 'viewer', status: 'unavailable', access: null });
  refresh.setFetched({
    principalId: refresh.principalId,
    accountId: refresh.accountId,
    membershipRevision: refresh.membershipRevision,
    masqueradeGeneration: refresh.masqueradeGeneration,
    status: 'unavailable',
    access: null,
  });
}

async function refreshPermission(refresh: PermissionRefresh) {
  // Reset the store authority before the first await so a prior tenant's or principal's capabilities
  // cannot leak while the new fetch is in flight. The provider value is independently keyed.
  refresh.setActiveAuthority({ role: 'viewer', status: 'pending', access: null });
  try {
    // Adopt masquerade status before publishing an effective role so reloads never render one
    // writable frame under a masqueraded session.
    const projectionIsCurrent = await captureMasqueradeStatusGuard();
    const isCurrent = () => refresh.isCurrent() && projectionIsCurrent();
    if (!isCurrent()) return;
    const masquerade = await masqueradeApi.status(refresh.accountId);
    if (!isCurrent()) return;
    if (!(await adoptMasqueradeStatus(masquerade, isCurrent))) return;
    if (!refresh.isCurrent()) return;
    // One validated request drives the picker list and permission projection while retaining their
    // distinct failure postures.
    const summaries = await refreshAccountSummaries({
      acceptEffects: refresh.isCurrent,
    });
    if (summaries === null) {
      publishUnavailable(refresh);
      return;
    }
    // A malformed role or missing/invalid access remains selectable only as an unavailable summary
    // and never grants access.
    const entry = summaries.find((account) => account.id === refresh.accountId);
    if (!entry || entry.roleStatus === 'unavailable' || !entry.access) {
      publishUnavailable(refresh);
      return;
    }
    if (!refresh.isCurrent()) return;
    refresh.setFetched({
      principalId: refresh.principalId,
      accountId: refresh.accountId,
      membershipRevision: refresh.membershipRevision,
      masqueradeGeneration: refresh.masqueradeGeneration,
      status: 'resolved',
      role: entry.role,
      access: entry.access,
    });
    refresh.setActiveAuthority({ role: entry.role, status: 'resolved', access: entry.access });
  } catch (error) {
    // Keep the fail-closed Viewer projection until a later successful lookup.
    console.warn('PermissionProvider: the active account role could not be resolved', error);
    publishUnavailable(refresh);
  }
}

function resolvePermissionValue(
  input: PermissionValueInput,
): Required<Pick<PermissionContextValue, 'role' | 'status' | 'access'>> {
  if (input.masqueradeActive) {
    return input.masqueradeRole && input.activeAccountId
      ? {
          role: input.masqueradeRole,
          status: 'resolved',
          access: masqueradeAccess(input.activeAccountId, input.masqueradeRole),
        }
      : { role: 'viewer', status: 'pending', access: null };
  }
  if (!input.enabled || !input.activeAccountId) {
    return { role: null, status: 'not-applicable', access: null };
  }
  if (input.fetched?.status === 'resolved' && input.fetched.role && input.fetched.access) {
    return { role: input.fetched.role, status: 'resolved', access: input.fetched.access };
  }
  return { role: 'viewer', status: input.fetched?.status ?? 'pending', access: null };
}

/** Publishes the active company authority from the shared validated directory. Authenticated lookups project unresolved membership to Viewer with no capabilities; off/demo uses no membership role. The store independently applies the same read-only guard. */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { authMode, user } = useAuth();
  const principalId = user?.id ?? null;
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setActiveAuthority = useStore((state) => state.setActiveAuthority);
  const membershipRevision = useStore((state) => state.membershipRevision);
  const masquerade = useStore((state) => state.masquerade);
  const masqueradeGeneration = readMasqueradeGeneration(masquerade);
  // Tag resolved authority with principal, account, membership revision and masquerade generation so
  // any change immediately discards the previous snapshot until the new lookup succeeds.
  const [fetched, setFetched] = useState<FetchedPermission | null>(null);
  const principalRef = useRef(principalId);

  const enabled = authMode !== 'off' && isServerConfigured();

  useEffect(() => {
    principalRef.current = principalId;
  }, [principalId]);

  useEffect(() => {
    if (masquerade.kind !== 'inactive') {
      const state = masquerade.state;
      if (state && state.accountId === activeAccountId) {
        setActiveAuthority({
          role: state.effectiveRole,
          status: 'resolved',
          access: masqueradeAccess(state.accountId, state.effectiveRole),
        });
      } else {
        setActiveAuthority({ role: 'viewer', status: 'pending', access: null });
      }
      return;
    }

    if (!enabled || !activeAccountId) {
      setActiveAuthority({ role: null, status: 'not-applicable', access: null });
      return;
    }
    let cancelled = false;
    void refreshPermission({
      principalId,
      accountId: activeAccountId,
      membershipRevision,
      masqueradeGeneration,
      isCurrent: () =>
        !cancelled &&
        principalRef.current === principalId &&
        readMasqueradeGeneration(useStore.getState().masquerade) === masqueradeGeneration,
      setFetched,
      setActiveAuthority,
    });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    principalId,
    activeAccountId,
    membershipRevision,
    masquerade,
    masqueradeGeneration,
    setActiveAuthority,
  ]);

  const currentFetched =
    fetched?.principalId === principalId &&
    fetched.accountId === activeAccountId &&
    fetched.membershipRevision === membershipRevision &&
    fetched.masqueradeGeneration === masqueradeGeneration
      ? fetched
      : null;
  const masqueradeActive = masquerade.kind !== 'inactive';
  const masqueradeRole =
    masquerade.kind !== 'inactive' && masquerade.state?.accountId === activeAccountId
      ? masquerade.state.effectiveRole
      : null;

  const value = useMemo((): PermissionContextValue => {
    const authorityKey: AuthorityKey = {
      principalId,
      accountId: activeAccountId,
      membershipRevision,
      masqueradeGeneration,
    };
    const resolved = resolvePermissionValue({
      enabled,
      activeAccountId,
      fetched: currentFetched,
      masqueradeActive,
      masqueradeRole,
    });
    return { ...resolved, authorityKey };
  }, [
    enabled,
    principalId,
    activeAccountId,
    membershipRevision,
    masqueradeGeneration,
    currentFetched,
    masqueradeActive,
    masqueradeRole,
  ]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
