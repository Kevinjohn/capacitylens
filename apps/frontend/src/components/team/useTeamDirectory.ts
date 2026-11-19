import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { m } from '@/i18n';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { teamAccessClient } from '@/account/teamAccessClient';
import type {
  TeamAccessResult,
  TeamDirectory,
  TeamInvitation,
  TeamMember,
} from '@/account/teamAccessClient';
import type { FieldError } from '@/hooks/useFieldError';
import { api, scopeQueryKey } from '@/api/queryClient';
import type { ApiQueryScope } from '@/api/queryClient';
import { useAuth } from '@/auth/authContext';
import { useStore } from '@/store/useStore';

interface TeamDirectoryOptions {
  enabled: boolean;
  activeCompanyId: string | null;
  fail: FieldError['fail'];
}

interface DirectorySnapshot {
  members: TeamMember[];
  invites: TeamInvitation[];
  signInTrackingEnabled: boolean;
  resourceCandidates: { resourceId: string; label: string }[];
}

type DirectoryState =
  | { kind: 'hidden'; companyId: string | null }
  | { kind: 'loading'; companyId: string | null }
  | { kind: 'ready'; companyId: string; snapshot: DirectorySnapshot }
  | {
      kind: 'error';
      companyId: string;
      content: { kind: 'authorized'; snapshot: DirectorySnapshot } | { kind: 'unavailable' };
    };

type SetDirectory = Dispatch<SetStateAction<DirectoryState>>;

// Reload generations are part of the members query key, so they stay unique for the life of the
// query cache: a later mount must not reuse a key whose cached read predates its write. Every mount
// still starts on generation 0, so a revisit shows the cached directory while it refetches.
let lastRequestedReadGeneration = 0;

function getDirectorySnapshot(state: DirectoryState, companyId: string): DirectorySnapshot | null {
  if (state.companyId !== companyId) return null;
  if (state.kind === 'ready') return state.snapshot;
  return state.kind === 'error' && state.content.kind === 'authorized'
    ? state.content.snapshot
    : null;
}

function markDirectoryError(state: DirectoryState, companyId: string): DirectoryState {
  const snapshot = getDirectorySnapshot(state, companyId);
  return {
    kind: 'error',
    companyId,
    content: snapshot === null ? { kind: 'unavailable' } : { kind: 'authorized', snapshot },
  };
}

function replaceInvites(
  state: DirectoryState,
  companyId: string,
  invites: TeamInvitation[],
): DirectoryState {
  const snapshot = getDirectorySnapshot(state, companyId);
  if (snapshot === null) return state;
  const nextSnapshot = { ...snapshot, invites };
  if (state.kind === 'ready') return { ...state, snapshot: nextSnapshot };
  if (state.kind === 'error' && state.content.kind === 'authorized') {
    return { ...state, content: { kind: 'authorized', snapshot: nextSnapshot } };
  }
  return state;
}

function getFailureMessage<T>(result: TeamAccessResult<T>, fallback: string): string {
  return result.kind === 'rejected' && result.message ? result.message : fallback;
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
  const { enabled, activeCompanyId } = options;
  const scopeId = JSON.stringify([scope.principalId, scope.companyId, scope.masqueradeGeneration]);
  const memberRouteKey = api.api.members.index.queryKey({
    params: { companyId: activeCompanyId ?? '' },
  });
  const membersQuery = useQuery<TeamAccessResult<TeamDirectory>>({
    queryKey: scopeQueryKey(scope, ['team-members', reloadKey, ...memberRouteKey]),
    enabled: enabled && !!activeCompanyId,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => teamAccessClient.listMembers(activeCompanyId ?? '', signal),
  });
  const inviteRouteKey = api.api.invites.index.queryKey({
    params: { companyId: activeCompanyId ?? '' },
  });
  const invitationsQuery = useQuery<TeamAccessResult<TeamInvitation[]>>({
    queryKey: scopeQueryKey(scope, ['team-invitations', inviteReloadKey, ...inviteRouteKey]),
    enabled: enabled && !!activeCompanyId && membersQuery.data?.kind === 'ok',
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => teamAccessClient.listInvitations(activeCompanyId ?? '', signal),
  });
  return { membersQuery, invitationsQuery, scopeId };
}

function useMemberQueryEffects({
  activeCompanyId,
  fail,
  authorizedAccountRef,
  setDirectory,
  membersQuery,
  scopeId,
  readGeneration,
  acceptReadGeneration,
}: {
  activeCompanyId: string | null;
  fail: FieldError['fail'];
  authorizedAccountRef: { current: { scopeId: string; companyId: string } | null };
  setDirectory: SetDirectory;
  membersQuery: ReturnType<typeof useScopedDirectoryQueries>['membersQuery'];
  scopeId: string;
  /** The reload generation whose members query produced `membersQuery.data`. */
  readGeneration: number;
  acceptReadGeneration(generation: number): void;
}) {
  useEffect(() => {
    if (!activeCompanyId || !membersQuery.data) return;
    const result = membersQuery.data;
    if (result.kind === 'rejected' && result.status === 403) {
      if (
        authorizedAccountRef.current?.scopeId === scopeId &&
        authorizedAccountRef.current.companyId === activeCompanyId
      ) {
        setDirectory({
          kind: 'error',
          companyId: activeCompanyId,
          content: { kind: 'unavailable' },
        });
        fail(null, m.settings_members_err_access_changed());
      } else {
        setDirectory({ kind: 'hidden', companyId: activeCompanyId });
      }
      return;
    }
    if (result.kind === 'invalid') {
      setDirectory((previous) => markDirectoryError(previous, activeCompanyId));
      fail(null, 'The server returned an invalid members response.');
      return;
    }
    if (result.kind !== 'ok') {
      setDirectory((previous) => markDirectoryError(previous, activeCompanyId));
      fail(null, getFailureMessage(result, m.settings_members_err_load({ status: result.status })));
      return;
    }
    authorizedAccountRef.current = { scopeId, companyId: activeCompanyId };
    setDirectory((previous) => ({
      kind: 'ready',
      companyId: activeCompanyId,
      snapshot: {
        members: result.value.members,
        signInTrackingEnabled: result.value.signInTrackingEnabled,
        resourceCandidates: result.value.resourceCandidates,
        invites: getDirectorySnapshot(previous, activeCompanyId)?.invites ?? [],
      },
    }));
    acceptReadGeneration(readGeneration);
  }, [
    activeCompanyId,
    membersQuery.data,
    fail,
    authorizedAccountRef,
    setDirectory,
    scopeId,
    readGeneration,
    acceptReadGeneration,
  ]);
  useEffect(() => {
    if (membersQuery.error && activeCompanyId) {
      setDirectory((previous) => markDirectoryError(previous, activeCompanyId));
      fail(null, m.settings_err_server({ error: resolveErrorMessage(membersQuery.error) }));
    }
  }, [activeCompanyId, membersQuery.error, fail, setDirectory]);
}

function useInvitationQueryEffects({
  activeCompanyId,
  fail,
  membersQuery,
  invitationsQuery,
  setDirectory,
}: {
  activeCompanyId: string | null;
  fail: FieldError['fail'];
  membersQuery: ReturnType<typeof useScopedDirectoryQueries>['membersQuery'];
  invitationsQuery: ReturnType<typeof useScopedDirectoryQueries>['invitationsQuery'];
  setDirectory: SetDirectory;
}) {
  useEffect(() => {
    if (!activeCompanyId || membersQuery.data?.kind !== 'ok' || !invitationsQuery.data) return;
    const result = invitationsQuery.data;
    if (result.kind === 'invalid') {
      fail(null, 'The server returned an invalid invites response.');
      return;
    }
    if (result.kind !== 'ok') {
      fail(null, getFailureMessage(result, m.settings_invites_err_load({ status: result.status })));
      return;
    }
    setDirectory((previous) => replaceInvites(previous, activeCompanyId, result.value));
  }, [activeCompanyId, membersQuery.data, invitationsQuery.data, fail, setDirectory]);
  useEffect(() => {
    if (membersQuery.data?.kind === 'ok' && invitationsQuery.error) {
      fail(null, m.settings_err_server({ error: resolveErrorMessage(invitationsQuery.error) }));
    }
  }, [invitationsQuery.error, membersQuery.data, fail]);
}

function useDirectoryRead(options: TeamDirectoryOptions) {
  const { activeCompanyId, fail } = options;
  const { user } = useAuth();
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === 'inactive' ? 0 : state.masquerade.generation,
  );
  const masqueradeActive = useStore((state) => state.masquerade.kind !== 'inactive');
  const scope: ApiQueryScope = {
    principalId: user?.id ?? null,
    companyId: activeCompanyId,
    masqueradeGeneration,
  };
  const scopeId = JSON.stringify([scope.principalId, scope.companyId, scope.masqueradeGeneration]);
  const [directoryState, setDirectoryState] = useState({
    scopeId,
    directory: { kind: 'loading', companyId: activeCompanyId } as DirectoryState,
  });
  const setDirectory = useCallback<SetDirectory>(
    (next) =>
      setDirectoryState((current) => {
        const previous: DirectoryState =
          current.scopeId === scopeId
            ? current.directory
            : { kind: 'loading', companyId: activeCompanyId };
        return { scopeId, directory: typeof next === 'function' ? next(previous) : next };
      }),
    [activeCompanyId, scopeId],
  );
  // Remember which principal projection returned an authorized company directory.
  const authorizedAccountRef = useRef<{ scopeId: string; companyId: string } | null>(null);
  // Each reload requests a new read generation. Only a successful members read applied for that
  // generation accepts it; failures and other snapshot replacements leave it unaccepted.
  const [reloadKey, setReloadKey] = useState(0);
  const [acceptedReadGeneration, setAcceptedReadGeneration] = useState(0);
  const [inviteReloadKey, setInviteReloadKey] = useState(0);
  const reload = useCallback((): number => {
    lastRequestedReadGeneration += 1;
    setReloadKey(lastRequestedReadGeneration);
    return lastRequestedReadGeneration;
  }, []);
  // Invitation-only writes refresh the independently authorized invite read. Apply its response
  // only while both its account and authorizing member-load generation remain current.
  const reloadInvites = useCallback(async () => setInviteReloadKey((key) => key + 1), []);
  const { membersQuery, invitationsQuery } = useScopedDirectoryQueries({
    options: { ...options, enabled: options.enabled && !masqueradeActive },
    reloadKey,
    inviteReloadKey,
    scope,
  });
  useMemberQueryEffects({
    activeCompanyId,
    fail,
    authorizedAccountRef,
    setDirectory,
    membersQuery,
    scopeId,
    readGeneration: reloadKey,
    acceptReadGeneration: setAcceptedReadGeneration,
  });
  useInvitationQueryEffects({
    activeCompanyId,
    fail,
    membersQuery,
    invitationsQuery,
    setDirectory,
  });

  return {
    directory:
      directoryState.scopeId === scopeId
        ? directoryState.directory
        : ({ kind: 'loading', companyId: activeCompanyId } satisfies DirectoryState),
    setDirectory,
    reload,
    acceptedReadGeneration,
    reloadInvites,
  };
}

/** Owns authoritative directory reads, self-gating and reload generations. */
export function useTeamDirectory(options: TeamDirectoryOptions) {
  const { activeCompanyId } = options;
  const { directory, setDirectory, reload, acceptedReadGeneration, reloadInvites } =
    useDirectoryRead(options);
  const currentAccountLoaded = directory.companyId === activeCompanyId;
  const replaceAuthorizedDirectory = useCallback(
    (next: TeamDirectory, invites: TeamInvitation[]) => {
      setDirectory((previous) => {
        if (previous.kind !== 'ready' && previous.kind !== 'error') return previous;
        const snapshot = {
          members: next.members,
          signInTrackingEnabled: next.signInTrackingEnabled,
          resourceCandidates: next.resourceCandidates,
          invites,
        };
        return previous.kind === 'ready'
          ? { ...previous, snapshot }
          : { ...previous, content: { kind: 'authorized', snapshot } };
      });
    },
    [setDirectory],
  );

  return {
    directory:
      currentAccountLoaded && directory.companyId !== null
        ? directory
        : ({ kind: 'loading', companyId: activeCompanyId } satisfies DirectoryState),
    replaceAuthorizedDirectory,
    reload,
    acceptedReadGeneration,
    reloadInvites,
  };
}
