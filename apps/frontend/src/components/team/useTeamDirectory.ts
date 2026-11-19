import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/** A team read whose answer was not `ok`. Thrown so the query keeps its last successful data. */
export class TeamReadError extends Error {
  readonly result: Exclude<TeamAccessResult<unknown>, { kind: 'ok' }>;

  constructor(result: Exclude<TeamAccessResult<unknown>, { kind: 'ok' }>) {
    super(result.message ?? `Team read failed with status ${result.status}.`);
    this.result = result;
  }
}

async function readOk<T>(read: Promise<TeamAccessResult<T>>): Promise<T> {
  const result = await read;
  if (result.kind !== 'ok') throw new TeamReadError(result);
  return result.value;
}

/** The one members query key for a scope and company; every reader of the members list shares it. */
export function teamMembersQueryKey(scope: ApiQueryScope, companyId: string | null) {
  return scopeQueryKey(scope, [
    'team-members',
    ...api.api.members.index.queryKey({ params: { companyId: companyId ?? '' } }),
  ]);
}

/** Reads the members list for the shared members query. */
export function readTeamMembers(companyId: string, signal: AbortSignal): Promise<TeamDirectory> {
  return readOk(teamAccessClient.listMembers(companyId, signal));
}

const isAccessRefusal = (error: unknown): boolean =>
  error instanceof TeamReadError && error.result.kind === 'rejected' && error.result.status === 403;

function resolveFailureMessage(error: unknown, fallback: (status: number) => string): string {
  if (!(error instanceof TeamReadError)) {
    return m.settings_err_server({ error: resolveErrorMessage(error) });
  }
  const { result } = error;
  return result.kind === 'rejected' && result.message ? result.message : fallback(result.status);
}

function toSnapshot(directory: TeamDirectory, invites: TeamInvitation[]): DirectorySnapshot {
  return {
    members: directory.members,
    signInTrackingEnabled: directory.signInTrackingEnabled,
    resourceCandidates: directory.resourceCandidates,
    invites,
  };
}

/** The directory as the members and invitations queries hold it; nothing is copied out of them. */
function deriveDirectory(
  companyId: string | null,
  members: { data: TeamDirectory | undefined; error: unknown },
  invites: TeamInvitation[] | undefined,
): DirectoryState {
  if (companyId === null) return { kind: 'loading', companyId };
  const snapshot = members.data ? toSnapshot(members.data, invites ?? []) : null;
  if (members.error) {
    if (isAccessRefusal(members.error)) {
      // A refusal after a successful read in this scope means access changed while the page was open.
      return snapshot
        ? { kind: 'error', companyId, content: { kind: 'unavailable' } }
        : { kind: 'hidden', companyId };
    }
    return {
      kind: 'error',
      companyId,
      content: snapshot ? { kind: 'authorized', snapshot } : { kind: 'unavailable' },
    };
  }
  return snapshot ? { kind: 'ready', companyId, snapshot } : { kind: 'loading', companyId };
}

function useDirectoryQueries(options: TeamDirectoryOptions, scope: ApiQueryScope) {
  const { enabled, activeCompanyId } = options;
  const companyId = activeCompanyId ?? '';
  const { principalId, masqueradeGeneration } = scope;
  // Stable keys, so the reload and replace callbacks keep their identity between renders.
  const { membersKey, invitesKey } = useMemo(() => {
    const keyScope = { principalId, companyId: activeCompanyId, masqueradeGeneration };
    return {
      membersKey: teamMembersQueryKey(keyScope, activeCompanyId),
      invitesKey: scopeQueryKey(keyScope, [
        'team-invitations',
        ...api.api.invites.index.queryKey({ params: { companyId } }),
      ]),
    };
  }, [principalId, activeCompanyId, masqueradeGeneration, companyId]);
  const membersQuery = useQuery<TeamDirectory>({
    queryKey: membersKey,
    enabled: enabled && !!activeCompanyId,
    refetchOnWindowFocus: false,
    // An answer is final: a refusal or failure shows at once rather than after retries.
    retry: false,
    queryFn: ({ signal }) => readTeamMembers(companyId, signal),
  });
  const invitationsQuery = useQuery<TeamInvitation[]>({
    queryKey: invitesKey,
    enabled: enabled && !!activeCompanyId && membersQuery.isSuccess,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => readOk(teamAccessClient.listInvitations(companyId, signal)),
  });
  return { membersKey, membersQuery, invitesKey, invitationsQuery };
}

function useReadFailureNotices(
  fail: FieldError['fail'],
  queries: ReturnType<typeof useDirectoryQueries>,
) {
  const { membersQuery, invitationsQuery } = queries;
  const hadMembers = membersQuery.data !== undefined;
  useEffect(() => {
    const error = membersQuery.error;
    if (!error) return;
    if (isAccessRefusal(error)) {
      if (hadMembers) fail(null, m.settings_members_err_access_changed());
      return;
    }
    if (error instanceof TeamReadError && error.result.kind === 'invalid') {
      fail(null, 'The server returned an invalid members response.');
      return;
    }
    fail(
      null,
      resolveFailureMessage(error, (status) => m.settings_members_err_load({ status })),
    );
    // Report each failed read once: a new failure has a new error time.
  }, [membersQuery.error, membersQuery.errorUpdatedAt, hadMembers, fail]);
  const membersOk = membersQuery.isSuccess;
  useEffect(() => {
    const error = invitationsQuery.error;
    if (!error || !membersOk) return;
    if (error instanceof TeamReadError && error.result.kind === 'invalid') {
      fail(null, 'The server returned an invalid invites response.');
      return;
    }
    fail(
      null,
      resolveFailureMessage(error, (status) => m.settings_invites_err_load({ status })),
    );
  }, [invitationsQuery.error, invitationsQuery.errorUpdatedAt, membersOk, fail]);
}

/** Owns authoritative directory reads, self-gating and reload generations. */
export function useTeamDirectory(options: TeamDirectoryOptions) {
  const { activeCompanyId, fail } = options;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const masqueradeGeneration = useStore((state) =>
    state.masquerade.kind === 'inactive' ? 0 : state.masquerade.generation,
  );
  const masqueradeActive = useStore((state) => state.masquerade.kind !== 'inactive');
  const scope: ApiQueryScope = {
    principalId: user?.id ?? null,
    companyId: activeCompanyId,
    masqueradeGeneration,
  };
  const queries = useDirectoryQueries(
    { ...options, enabled: options.enabled && !masqueradeActive },
    scope,
  );
  const { membersKey, membersQuery, invitesKey, invitationsQuery } = queries;
  useReadFailureNotices(fail, queries);

  // Each reload requests a new read generation. A generation is accepted once the members read it
  // started settles successfully; failures leave it unaccepted.
  const requestedGeneration = useRef(0);
  const [acceptedReadGeneration, setAcceptedReadGeneration] = useState(0);
  const reload = useCallback((): number => {
    const generation = ++requestedGeneration.current;
    void queryClient.invalidateQueries({ queryKey: membersKey, exact: true }).then(() => {
      const state = queryClient.getQueryState(membersKey);
      if (state?.status === 'success') {
        setAcceptedReadGeneration((accepted) => Math.max(accepted, generation));
      }
    });
    return generation;
  }, [queryClient, membersKey]);
  const reloadInvites = useCallback(
    () => queryClient.invalidateQueries({ queryKey: invitesKey, exact: true }),
    [queryClient, invitesKey],
  );
  const replaceAuthorizedDirectory = useCallback(
    (next: TeamDirectory, invites: TeamInvitation[]) => {
      if (queryClient.getQueryData(membersKey) === undefined) return;
      queryClient.setQueryData(membersKey, next);
      queryClient.setQueryData(invitesKey, invites);
    },
    [queryClient, membersKey, invitesKey],
  );

  const directory = useMemo(
    () =>
      deriveDirectory(
        activeCompanyId,
        { data: membersQuery.data, error: membersQuery.error },
        invitationsQuery.data,
      ),
    [activeCompanyId, membersQuery.data, membersQuery.error, invitationsQuery.data],
  );

  return {
    directory,
    replaceAuthorizedDirectory,
    reload,
    acceptedReadGeneration,
    reloadInvites,
  };
}
