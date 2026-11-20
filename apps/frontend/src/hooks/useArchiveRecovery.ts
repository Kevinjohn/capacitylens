import { useCallback, useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import { client, buildScopeQueryKey } from '@/api/queryClient';
import { useAuth } from '@/auth/authContext';
import { useCan, useRole, usePermissionStatus } from '@/auth/permissionContext';
import { subscribeToInactiveDataChanges } from '@/data/inactiveDataEvents';
import { getMasqueradeContextToken } from '@/api/masqueradeContext';
import { buildAuthorityKey } from '@/data/planning/planningAuthority';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { resolveErrorMessage } from '@/lib/errorMessage';

/** Reads recovery identities with a fresh cache fence for every principal/access transition. */
export function useArchiveRecovery() {
  const { user } = useAuth();
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const mayWrite = useCan('planning:write');
  const companyId = useStore((state) => state.activeCompanyId);
  const planning = useStore((state) => state.planning);
  const masquerade = useStore((state) => state.masquerade);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  useEffect(
    () =>
      subscribeToInactiveDataChanges((changedCompanyId) => {
        if (changedCompanyId === useStore.getState().activeCompanyId) reload();
      }),
    [reload],
  );
  const authorityKey = buildAuthorityKey(planning.authority);
  const enabled =
    mayWrite &&
    !!companyId &&
    !!user &&
    permissionStatus === 'resolved' &&
    planning.authority !== null &&
    planning.authority.actorId === user.id &&
    planning.authority.effectiveActorId === user.id &&
    planning.authority.role === role &&
    planning.authority.canWrite &&
    planning.context?.companyId === companyId &&
    planning.phase.kind === 'ready';
  const scope = {
    principalId: user?.id ?? null,
    companyId,
    masqueradeGeneration: masquerade.kind === 'inactive' ? 0 : masquerade.generation,
  };
  const signature = JSON.stringify([
    scope,
    role,
    permissionStatus,
    enabled,
    authorityKey,
    planning.revision,
    reloadKey,
  ]);
  const [fence, setFence] = useState({ signature, context: planning.context, epoch: 0 });
  const transitioned = fence.signature !== signature || fence.context !== planning.context;
  const epoch = transitioned ? fence.epoch + 1 : fence.epoch;
  if (transitioned) setFence({ signature, context: planning.context, epoch });
  const instance = useId();
  const contextToken = getMasqueradeContextToken();
  const query = useQuery<ArchiveRecovery>({
    queryKey: buildScopeQueryKey(scope, [
      'archive-recovery',
      instance,
      epoch,
      role,
      authorityKey,
      planning.revision,
      reloadKey,
    ]),
    enabled,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await client.request('api.planning.archive', {
        params: { companyId: companyId ?? '' },
        signal,
        headers: { 'X-Masquerade-Context': contextToken ?? '' },
      });
      if (response.companyId !== companyId) {
        throw new Error(m.settings_archived_err_incomplete());
      }
      return response;
    },
  });
  if (!enabled) return { data: null, error: null, reload };
  return {
    data: query.isError ? null : (query.data ?? null),
    error: query.error ? resolveErrorMessage(query.error) : null,
    reload,
  };
}
