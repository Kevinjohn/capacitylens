import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { isServerConfigured } from "../data/apiConfig";
import { useStore } from "../store/useStore";
import { useAuth } from "./authContext";
import { PermissionContext } from "./permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import { useOfflineState } from "../data/useOfflineState";
import { readOfflineStateEpisode } from "../data/offlineCache";
import { refreshAccountSummaries } from "./useAccountSummaries";
import { masqueradeApi } from "./masqueradeApi";
import { masqueradeController } from "./masqueradeController";

type PermissionStatus = "not-applicable" | "pending" | "resolved" | "unavailable";

interface FetchedPermission {
  accountId: string;
  membershipRevision: number;
  offlineEpisode: number;
  status: "resolved" | "unavailable";
  role?: Role;
}

interface PermissionRefresh {
  accountId: string;
  membershipRevision: number;
  offlineEpisode: number;
  isCurrent: () => boolean;
  setFetched: Dispatch<SetStateAction<FetchedPermission | null>>;
  setActiveRole: (role: Role | null, status?: PermissionStatus) => void;
}

interface PermissionValueInput {
  offlineReadOnly: boolean;
  enabled: boolean;
  activeAccountId: string | null;
  fetched: FetchedPermission | null;
}

interface PermissionValue {
  role: Role | null;
  status: PermissionStatus;
}

function publishUnavailable(refresh: PermissionRefresh) {
  if (!refresh.isCurrent()) return;
  refresh.setActiveRole("viewer", "unavailable");
  refresh.setFetched({
    accountId: refresh.accountId,
    membershipRevision: refresh.membershipRevision,
    offlineEpisode: refresh.offlineEpisode,
    status: "unavailable",
  });
}

async function refreshPermission(refresh: PermissionRefresh) {
  // Reset the store role before the first await so a prior tenant's role cannot leak while the new
  // fetch is in flight. The provider value is independently keyed and already projects Viewer.
  refresh.setActiveRole("viewer", "pending");
  try {
    // Adopt masquerade status before publishing an effective role so reloads never render one
    // writable frame under a masqueraded session.
    const masquerade = await masqueradeApi.status();
    if (!refresh.isCurrent()) return;
    masqueradeController.adoptStatus(masquerade);
    // One validated request drives the picker list and permission projection while retaining their
    // distinct failure postures.
    const summaries = await refreshAccountSummaries({
      acceptEffects: refresh.isCurrent,
      allowCachedFallback: false,
    });
    if (summaries === null) {
      publishUnavailable(refresh);
      return;
    }
    // A malformed role remains selectable only as an unavailable Viewer summary and never grants
    // access.
    const entry = summaries.find((account) => account.id === refresh.accountId);
    if (!entry || entry.roleStatus === "unavailable") {
      publishUnavailable(refresh);
      return;
    }
    if (!refresh.isCurrent()) return;
    refresh.setFetched({
      accountId: refresh.accountId,
      membershipRevision: refresh.membershipRevision,
      offlineEpisode: refresh.offlineEpisode,
      status: "resolved",
      role: entry.role,
    });
    refresh.setActiveRole(entry.role, "resolved");
  } catch (error) {
    // Keep the fail-closed Viewer projection until a later successful lookup.
    console.warn("PermissionProvider: the active account role could not be resolved", error);
    publishUnavailable(refresh);
  }
}

function getPermissionValue(input: PermissionValueInput): PermissionValue {
  if (input.offlineReadOnly) return { role: "viewer", status: "unavailable" };
  if (!input.enabled || !input.activeAccountId) return { role: null, status: "not-applicable" };
  if (input.fetched?.status === "resolved" && input.fetched.role) {
    return { role: input.fetched.role, status: "resolved" };
  }
  return { role: "viewer", status: input.fetched?.status ?? "pending" };
}

// Client permission boundary (production plan P1.12). It resolves the caller's ROLE for the ACTIVE
// account and provides it to the pure-`can`-driven affordance hooks (useRole / useCanEdit) so a
// Viewer sees a read-only UI. It mounts INSIDE AppShell, around the app body subtree, AFTER the
// tenant/intro gates — so `activeAccountId` is already set when this runs.
//
// REGRESSION GUARD (load-bearing): in OFF mode OR the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through — `role: null`, ZERO fetches, ever (mirrors AuthProvider's demo-mode
// discipline). That is the shipped/default path and MUST stay byte-identical to today's app, which
// `role: null` → fully editable (see permissionContext.ts) guarantees.
//
// FAIL-CLOSED: in the auth-on + server path, pending/failed/missing role resolution is projected as
// viewer for affordance safety and separately labelled pending/unavailable for explanatory UI.
// This prevents an optimistic edit window after every account switch and prevents local UI
// divergence while the permission endpoint is unavailable. OFF/demo still use null (editable).

/**
 * Resolve and provide the caller's role for the active account (P1.12).
 *
 * - OFF mode OR the demo build (no server): `role: null`, no fetch — the must-stay-editable path.
 * - auth-on + server + an active account: own the shared `GET /api/accounts` refresh for this
 *   generation, publish its validated summaries for the picker, and resolve the active role from
 *   that same result. Pending/failure/absence is viewer.
 *
 * The resolved role is ALSO pushed to the store (`setActiveRole`) so the store's defense-in-depth
 * mutation guard (P1.12) can no-op a viewer's optimistic local write — see useStore.assertCanWrite.
 */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { authMode } = useAuth();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setActiveRole = useStore((state) => state.setActiveRole);
  const membershipRevision = useStore((state) => state.membershipRevision);
  const offline = useOfflineState();
  const offlineEpisode = readOfflineStateEpisode();
  // The FETCHED role TAGGED with the account it was resolved for. Only ever set behind an `await` in
  // the effect's async IIFE (the MembersSection / AuthProvider idiom) — never synchronously in the
  // effect body — so there's no cascading-render setState-in-effect. Tagging with `accountId` is what
  // lets the value computation below DISCARD a prior tenant's role the instant the active account
  // changes (without a synchronous reset that the set-state-in-effect lint forbids): a stale entry
  // whose accountId/revision no longer matches reads as pending with a fail-closed Viewer projection
  // until the new fetch lands.
  const [fetched, setFetched] = useState<FetchedPermission | null>(null);

  // Enabled ONLY in an auth-on, server-backed deploy. OFF / demo provides null and fetches nothing.
  const enabled = authMode !== "off" && isServerConfigured();

  useEffect(() => {
    if (offline.readOnly) {
      setActiveRole("viewer", "unavailable");
      return;
    }
    // OFF / demo / no active account: there is no membership role to enforce. Make NO request — the
    // shipped default path stays byte-identical to today. The provided role is null either way (the
    // value computation below short-circuits to null when not enabled), so no local reset is needed.
    if (!enabled || !activeAccountId) {
      setActiveRole(null, "not-applicable"); // keep the STORE guard in sync (a plain store write, not a React setState)
      return;
    }
    let cancelled = false;
    void refreshPermission({
      accountId: activeAccountId,
      membershipRevision,
      offlineEpisode,
      isCurrent: () => !cancelled,
      setFetched,
      setActiveRole,
    });
    return () => {
      cancelled = true;
    };
    // activeAccountId in the deps re-keys the fetch per tenant; an account switch re-runs the effect
    // (resetting the store role above) and the stale `fetched` is discarded by the accountId tag check
    // in the value computation below until the new fetch lands.
  }, [enabled, activeAccountId, membershipRevision, offline.readOnly, offlineEpisode, setActiveRole]);

  // OFF / demo / no active account → null (editable). Otherwise use the fetched role ONLY when it was
  // resolved for the CURRENTLY active account (the accountId tag) — a prior tenant's role can't leak
  // across a switch. This computation is what lets the OFF/demo branch above avoid a synchronous
  // setState (the set-state-in-effect lint).
  const currentFetched =
    fetched?.accountId === activeAccountId &&
    fetched.membershipRevision === membershipRevision &&
    fetched.offlineEpisode === offlineEpisode
      ? fetched
      : null;
  // Offline read-only is a safe capability projection, not a resolved membership fact. Keep the
  // status unavailable so explanatory consumers cannot present Viewer as the authoritative role.
  const { role, status } = getPermissionValue({
    offlineReadOnly: offline.readOnly,
    enabled,
    activeAccountId,
    fetched: currentFetched,
  });

  // Memoise the context value on `role` so a re-render that doesn't change the role keeps the SAME
  // value reference — otherwise every consumer (the affordance hubs across the app) re-renders on any
  // parent re-render (e.g. AppShell re-rendering on a dirty-form keystroke), needless churn.
  const value = useMemo(() => ({ role, status }), [role, status]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
