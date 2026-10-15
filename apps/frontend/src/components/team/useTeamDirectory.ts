import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { teamAccessClient } from "@/account/teamAccessClient";
import type { TeamAccessResult, TeamDirectory, TeamInvitation, TeamMember } from "@/account/teamAccessClient";
import type { FieldError } from "@/hooks/useFieldError";
import { api, scopeQueryKey } from "@/api/queryClient";
import type { ApiQueryScope } from "@/api/queryClient";
import { useAuth } from "@/auth/authContext";
import { useStore } from "@/store/useStore";

interface TeamDirectoryOptions {
  enabled: boolean;
  activeAccountId: string | null;
  offlineReadOnly: boolean;
  fail: FieldError["fail"];
  onInvitesLoaded?: (invites: TeamInvitation[]) => void;
}

interface DirectorySnapshot {
  members: TeamMember[];
  invites: TeamInvitation[];
  signInTrackingEnabled: boolean;
  resourceCandidates: { resourceId: string; label: string }[];
}

type DirectoryState =
  | { kind: "hidden"; accountId: string | null }
  | { kind: "loading"; accountId: string | null }
  | { kind: "ready"; accountId: string; snapshot: DirectorySnapshot }
  | {
      kind: "error";
      accountId: string;
      content: { kind: "authorized"; snapshot: DirectorySnapshot } | { kind: "unavailable" };
    };

type SetDirectory = Dispatch<SetStateAction<DirectoryState>>;

function directorySnapshot(state: DirectoryState, accountId: string): DirectorySnapshot | null {
  if (state.accountId !== accountId) return null;
  if (state.kind === "ready") return state.snapshot;
  return state.kind === "error" && state.content.kind === "authorized" ? state.content.snapshot : null;
}

function errorDirectory(state: DirectoryState, accountId: string): DirectoryState {
  const snapshot = directorySnapshot(state, accountId);
  return {
    kind: "error",
    accountId,
    content: snapshot === null ? { kind: "unavailable" } : { kind: "authorized", snapshot },
  };
}

function replaceInvites(state: DirectoryState, accountId: string, invites: TeamInvitation[]): DirectoryState {
  const snapshot = directorySnapshot(state, accountId);
  if (snapshot === null) return state;
  const nextSnapshot = { ...snapshot, invites };
  if (state.kind === "ready") return { ...state, snapshot: nextSnapshot };
  if (state.kind === "error" && state.content.kind === "authorized") {
    return { ...state, content: { kind: "authorized", snapshot: nextSnapshot } };
  }
  return state;
}

function failureMessage<T>(result: TeamAccessResult<T>, fallback: string): string {
  return result.kind === "rejected" && result.message ? result.message : fallback;
}

function useScopedDirectoryQueries({
  options,
  reloadKey,
  inviteReloadKey,
  scope,
}: {
  options: TeamDirectoryOptions;
  reloadKey: number;
  inviteReloadKey: number;
  scope: ApiQueryScope;
}) {
  const { enabled, activeAccountId, offlineReadOnly } = options;
  const scopeId = JSON.stringify([scope.principalId, scope.accountId, scope.masqueradeGeneration]);
  const memberRouteKey = api.api.members.index.queryKey({ params: { accountId: activeAccountId ?? "" } });
  const membersQuery = useQuery<TeamAccessResult<TeamDirectory>>({
    queryKey: scopeQueryKey(scope, ["team-members", reloadKey, ...memberRouteKey]),
    enabled: enabled && !!activeAccountId && !offlineReadOnly,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => teamAccessClient.listMembers(activeAccountId ?? "", signal),
  });
  const inviteRouteKey = api.api.invites.index.queryKey({ params: { accountId: activeAccountId ?? "" } });
  const invitationsQuery = useQuery<TeamAccessResult<TeamInvitation[]>>({
    queryKey: scopeQueryKey(scope, ["team-invitations", inviteReloadKey, ...inviteRouteKey]),
    enabled: enabled && !!activeAccountId && !offlineReadOnly && membersQuery.data?.kind === "ok",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => teamAccessClient.listInvitations(activeAccountId ?? "", signal),
  });
  return { membersQuery, invitationsQuery, scopeId };
}

function useMemberQueryEffects({
  activeAccountId,
  fail,
  authorizedAccountRef,
  setDirectory,
  membersQuery,
  scopeId,
}: {
  activeAccountId: string | null;
  fail: FieldError["fail"];
  authorizedAccountRef: { current: { scopeId: string; accountId: string } | null };
  setDirectory: SetDirectory;
  membersQuery: ReturnType<typeof useScopedDirectoryQueries>["membersQuery"];
  scopeId: string;
}) {
  useEffect(() => {
    if (!activeAccountId || !membersQuery.data) return;
    const result = membersQuery.data;
    if (result.kind === "rejected" && result.status === 403) {
      if (
        authorizedAccountRef.current?.scopeId === scopeId &&
        authorizedAccountRef.current.accountId === activeAccountId
      ) {
        setDirectory({ kind: "error", accountId: activeAccountId, content: { kind: "unavailable" } });
        fail(null, m.settings_members_err_access_changed());
      } else {
        setDirectory({ kind: "hidden", accountId: activeAccountId });
      }
      return;
    }
    if (result.kind === "invalid") {
      setDirectory((previous) => errorDirectory(previous, activeAccountId));
      fail(null, "The server returned an invalid members response.");
      return;
    }
    if (result.kind !== "ok") {
      setDirectory((previous) => errorDirectory(previous, activeAccountId));
      fail(null, failureMessage(result, m.settings_members_err_load({ status: result.status })));
      return;
    }
    authorizedAccountRef.current = { scopeId, accountId: activeAccountId };
    setDirectory((previous) => ({
      kind: "ready",
      accountId: activeAccountId,
      snapshot: {
        members: result.value.members,
        signInTrackingEnabled: result.value.signInTrackingEnabled,
        resourceCandidates: result.value.resourceCandidates,
        invites: directorySnapshot(previous, activeAccountId)?.invites ?? [],
      },
    }));
  }, [activeAccountId, membersQuery.data, fail, authorizedAccountRef, setDirectory, scopeId]);
  useEffect(() => {
    if (membersQuery.error && activeAccountId) {
      setDirectory((previous) => errorDirectory(previous, activeAccountId));
      fail(null, m.settings_err_server({ error: resolveErrorMessage(membersQuery.error) }));
    }
  }, [activeAccountId, membersQuery.error, fail, setDirectory]);
}

function useInvitationQueryEffects({
  activeAccountId,
  fail,
  onInvitesLoaded,
  membersQuery,
  invitationsQuery,
  setDirectory,
}: {
  activeAccountId: string | null;
  fail: FieldError["fail"];
  onInvitesLoaded: TeamDirectoryOptions["onInvitesLoaded"];
  membersQuery: ReturnType<typeof useScopedDirectoryQueries>["membersQuery"];
  invitationsQuery: ReturnType<typeof useScopedDirectoryQueries>["invitationsQuery"];
  setDirectory: SetDirectory;
}) {
  useEffect(() => {
    if (!activeAccountId || membersQuery.data?.kind !== "ok" || !invitationsQuery.data) return;
    const result = invitationsQuery.data;
    if (result.kind === "invalid") {
      fail(null, "The server returned an invalid invites response.");
      return;
    }
    if (result.kind !== "ok") {
      fail(null, failureMessage(result, m.settings_invites_err_load({ status: result.status })));
      return;
    }
    setDirectory((previous) => replaceInvites(previous, activeAccountId, result.value));
    onInvitesLoaded?.(result.value);
  }, [activeAccountId, membersQuery.data, invitationsQuery.data, fail, onInvitesLoaded, setDirectory]);
  useEffect(() => {
    if (membersQuery.data?.kind === "ok" && invitationsQuery.error)
      fail(null, m.settings_err_server({ error: resolveErrorMessage(invitationsQuery.error) }));
  }, [invitationsQuery.error, membersQuery.data, fail]);
}

function useDirectoryRead(options: TeamDirectoryOptions) {
  const { activeAccountId, fail, onInvitesLoaded } = options;
  const { user } = useAuth();
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === "inactive" ? 0 : state.masquerade.generation,
  );
  const masqueradeActive = useStore((state) => state.masquerade.kind !== "inactive");
  const scope: ApiQueryScope = { principalId: user?.id ?? null, accountId: activeAccountId, masqueradeGeneration };
  const scopeId = JSON.stringify([scope.principalId, scope.accountId, scope.masqueradeGeneration]);
  const [directoryState, setDirectoryState] = useState({
    scopeId,
    directory: { kind: "loading", accountId: activeAccountId } as DirectoryState,
  });
  const setDirectory = useCallback<SetDirectory>(
    (next) =>
      setDirectoryState((current) => {
        const previous: DirectoryState =
          current.scopeId === scopeId ? current.directory : { kind: "loading", accountId: activeAccountId };
        return { scopeId, directory: typeof next === "function" ? next(previous) : next };
      }),
    [activeAccountId, scopeId],
  );
  // Remember which principal projection returned an authorized company directory.
  const authorizedAccountRef = useRef<{ scopeId: string; accountId: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inviteReloadKey, setInviteReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const reloadInvites = useCallback(async () => setInviteReloadKey((key) => key + 1), []);
  const { membersQuery, invitationsQuery } = useScopedDirectoryQueries({
    options: { ...options, enabled: options.enabled && !masqueradeActive },
    reloadKey,
    inviteReloadKey,
    scope,
  });
  useMemberQueryEffects({ activeAccountId, fail, authorizedAccountRef, setDirectory, membersQuery, scopeId });
  useInvitationQueryEffects({ activeAccountId, fail, onInvitesLoaded, membersQuery, invitationsQuery, setDirectory });

  return {
    directory:
      directoryState.scopeId === scopeId
        ? directoryState.directory
        : ({ kind: "loading", accountId: activeAccountId } satisfies DirectoryState),
    setDirectory,
    reload,
    reloadInvites,
  };
}

// Invitation-only writes refresh the independently authorized invite read. Apply its response only while both its account and authorizing member-load generation remain current.
function useActionState() {
  const actionLock = useRef<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const beginAction = useCallback((key: string): boolean => {
    if (actionLock.current !== null) return false;
    actionLock.current = key;
    setBusyAction(key);
    return true;
  }, []);
  const endAction = useCallback(() => {
    actionLock.current = null;
    setBusyAction(null);
  }, []);
  return { busyAction, beginAction, endAction };
}

/** Owns authoritative directory reads, self-gating, reload generations and action exclusion. */
export function useTeamDirectory(options: TeamDirectoryOptions) {
  const { activeAccountId } = options;
  const { directory, setDirectory, reload, reloadInvites } = useDirectoryRead(options);
  const { busyAction, beginAction, endAction } = useActionState();
  const currentAccountLoaded = directory.accountId === activeAccountId;
  const replaceAuthorizedDirectory = useCallback(
    (next: TeamDirectory, invites: TeamInvitation[]) => {
      setDirectory((previous) => {
        if (previous.kind !== "ready" && previous.kind !== "error") return previous;
        const snapshot = {
          members: next.members,
          signInTrackingEnabled: next.signInTrackingEnabled,
          resourceCandidates: next.resourceCandidates,
          invites,
        };
        return previous.kind === "ready"
          ? { ...previous, snapshot }
          : { ...previous, content: { kind: "authorized", snapshot } };
      });
    },
    [setDirectory],
  );

  return {
    directory:
      currentAccountLoaded && directory.accountId !== null
        ? directory
        : ({ kind: "loading", accountId: activeAccountId } satisfies DirectoryState),
    replaceAuthorizedDirectory,
    reload,
    reloadInvites,
    busyAction,
    beginAction,
    endAction,
  };
}
