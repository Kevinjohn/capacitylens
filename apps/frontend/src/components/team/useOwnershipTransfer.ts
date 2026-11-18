import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { m } from '@/i18n';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { TeamMember } from '@/account/teamAccessClient';
import { resolveRejectionMessage } from '@/account/accessResult';
import type { TeamAccessResult } from '@/account/accessResult';
import { api, queryClient, scopeQueryKey } from '@/api/queryClient';
import type { ApiQueryScope } from '@/api/queryClient';
import { useAuth } from '@/auth/authContext';
import { useCan, usePermissionStatus } from '@/auth/permissionContext';
import { reprojectAccess } from '@/auth/reprojectAccess';
import { useStore } from '@/store/useStore';

interface OwnershipTransferState {
  available: boolean;
  loading: boolean;
  directoryLoaded: boolean;
  candidates: readonly TeamMember[];
  busy: boolean;
  error: string | null;
}

export interface OwnershipTransferController extends OwnershipTransferState {
  refresh(): Promise<void>;
  transfer(targetPrincipalId: string, confirmationId: string): Promise<void>;
}

const EMPTY_MEMBERS: readonly TeamMember[] = [];
type OwnershipTransferResult = Awaited<ReturnType<typeof teamAccessClient.transferOwnership>>;

function useOwnerDirectory({
  companyId,
  available,
  scope,
  principalId,
}: {
  companyId: string | null;
  available: boolean;
  scope: ApiQueryScope;
  principalId: string | null;
}) {
  const routeKey = api.api.members.index.queryKey({ params: { companyId: companyId ?? '' } });
  const query = useQuery({
    queryKey: scopeQueryKey(scope, ['team-members', 0, ...routeKey]),
    enabled: available && companyId !== null,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => teamAccessClient.listMembers(companyId ?? '', signal),
  });
  const members = query.data?.kind === 'ok' ? query.data.value.members : EMPTY_MEMBERS;
  const candidates = useMemo(
    () =>
      members.filter(
        (member) =>
          member.role === 'admin' && member.status === 'active' && member.userId !== principalId,
      ),
    [members, principalId],
  );
  const error = readDirectoryError(query.data, query.error);
  const refresh = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    candidates,
    error,
    loading: query.isPending,
    loaded: query.data?.kind === 'ok',
    refresh,
  };
}

function readDirectoryError(
  result: TeamAccessResult<unknown> | undefined,
  error: Error | null,
): string | null {
  if (result?.kind === 'ok') return null;
  if (result) return resolveRejectionMessage(result, m.ownership_transfer_read_failed());
  return error ? m.ownership_transfer_read_failed() : null;
}

async function reconcileCallerAccess(
  companyId: string,
  refreshAuth: () => Promise<void>,
): Promise<boolean> {
  queryClient.clear();
  try {
    await refreshAuth();
  } catch (cause) {
    console.error('OwnershipTransferCard: authentication refresh failed', cause);
  }
  if (useStore.getState().activeAccountId !== companyId) return true;
  try {
    if (await reprojectAccess(companyId)) return true;
  } catch (cause) {
    console.error('OwnershipTransferCard: access refresh failed', cause);
  }
  if (useStore.getState().activeAccountId === companyId) {
    useStore.getState().setActiveAccount(null);
    useStore.getState().setNotice(m.settings_members_access_refresh_failed(), 'error');
  }
  return false;
}

async function sendTransfer(
  companyId: string,
  targetPrincipalId: string,
  confirmationId: string,
): Promise<OwnershipTransferResult | null> {
  try {
    return await teamAccessClient.transferOwnership({
      companyId,
      targetPrincipalId,
      confirmationId,
    });
  } catch (cause) {
    console.error('OwnershipTransferCard: transfer response was not received', cause);
    return null;
  }
}

async function settleTransfer({
  result,
  companyId,
  refreshAuth,
  setError,
}: {
  result: OwnershipTransferResult | null;
  companyId: string;
  refreshAuth: () => Promise<void>;
  setError: (message: string | null) => void;
}): Promise<void> {
  if (result?.kind === 'ok') {
    if (await reconcileCallerAccess(companyId, refreshAuth)) {
      useStore.getState().setNotice(m.ownership_transfer_success());
    }
    return;
  }
  if (result === null || result.kind === 'unknown' || result.kind === 'invalid') {
    setError(m.ownership_transfer_uncertain());
    await reconcileCallerAccess(companyId, refreshAuth);
    return;
  }
  setError(resolveRejectionMessage(result, m.ownership_transfer_command_failed()));
}

function useTransferCommand({
  companyId,
  available,
  refreshAuth,
}: {
  companyId: string | null;
  available: boolean;
  refreshAuth: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const transfer = useCallback(
    async (targetPrincipalId: string, confirmationId: string): Promise<void> => {
      if (!available || companyId === null || targetPrincipalId === '' || lock.current) return;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await sendTransfer(companyId, targetPrincipalId, confirmationId);
        await settleTransfer({ result, companyId, refreshAuth, setError });
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [companyId, available, refreshAuth],
  );
  return { busy, error, transfer };
}

/** Reads current eligible Admins and performs one immediate ownership transfer. */
export function useOwnershipTransfer(
  companyId: string | null,
  refreshAuth: () => Promise<void>,
): OwnershipTransferController {
  const { user } = useAuth();
  const mayTransfer = useCan('ownership:transfer');
  const permissionStatus = usePermissionStatus();
  const masquerade = useStore((state) => state.masquerade);
  const scope: ApiQueryScope = {
    principalId: user?.id ?? null,
    companyId,
    masqueradeGeneration: masquerade.kind === 'inactive' ? 0 : masquerade.generation,
  };
  const available =
    user !== null &&
    mayTransfer &&
    permissionStatus === 'resolved' &&
    masquerade.kind === 'inactive';
  const directory = useOwnerDirectory({
    companyId,
    available,
    scope,
    principalId: user?.id ?? null,
  });
  const command = useTransferCommand({ companyId, available, refreshAuth });

  return {
    available,
    loading: directory.loading,
    directoryLoaded: directory.loaded,
    candidates: directory.candidates,
    busy: command.busy,
    error: command.error ?? directory.error,
    refresh: directory.refresh,
    transfer: command.transfer,
  };
}
