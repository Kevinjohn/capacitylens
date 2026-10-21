import { useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { isServerConfigured } from "@/data/apiConfig";
import { useStore } from "@/store/useStore";
import { useAuth } from "./authContext";
import { PermissionContext } from "./permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import { useOfflineState } from "@/data/useOfflineState";
import { readOfflineStateEpisode } from "@/data/offlineCache";
import { refreshAccountSummaries } from "./useAccountSummaries";
import { masqueradeApi } from "./masqueradeApi";
import { adoptMasqueradeStatus } from "./accountTransition";

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
    if (!(await adoptMasqueradeStatus(masquerade, refresh.isCurrent))) return;
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

function resolvePermissionValue(input: PermissionValueInput): PermissionValue {
  if (input.offlineReadOnly) return { role: "viewer", status: "unavailable" };
  if (!input.enabled || !input.activeAccountId) return { role: null, status: "not-applicable" };
  if (input.fetched?.status === "resolved" && input.fetched.role) {
    return { role: input.fetched.role, status: "resolved" };
  }
  return { role: "viewer", status: input.fetched?.status ?? "pending" };
}

/** Publishes the active company role from the shared validated directory. Authenticated lookups project unresolved membership to Viewer; off/demo uses no membership role. The store independently applies the same read-only guard. */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { authMode } = useAuth();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setActiveRole = useStore((state) => state.setActiveRole);
  const membershipRevision = useStore((state) => state.membershipRevision);
  const offline = useOfflineState();
  const offlineEpisode = readOfflineStateEpisode();
  // Tag resolved roles with accountId and membership revision so switching company immediately discards the previous role and projects Viewer until the new lookup succeeds.
  const [fetched, setFetched] = useState<FetchedPermission | null>(null);

  const enabled = authMode !== "off" && isServerConfigured();

  useEffect(() => {
    if (offline.readOnly) {
      setActiveRole("viewer", "unavailable");
      return;
    }

    if (!enabled || !activeAccountId) {
      setActiveRole(null, "not-applicable");
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
  }, [enabled, activeAccountId, membershipRevision, offline.readOnly, offlineEpisode, setActiveRole]);

  const currentFetched =
    fetched?.accountId === activeAccountId &&
    fetched.membershipRevision === membershipRevision &&
    fetched.offlineEpisode === offlineEpisode
      ? fetched
      : null;
  // Offline read-only is a safe capability projection, not a resolved membership fact. Keep the
  // status unavailable so explanatory consumers cannot present Viewer as the authoritative role.
  const { role, status } = resolvePermissionValue({
    offlineReadOnly: offline.readOnly,
    enabled,
    activeAccountId,
    fetched: currentFetched,
  });

  const value = useMemo(() => ({ role, status }), [role, status]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
