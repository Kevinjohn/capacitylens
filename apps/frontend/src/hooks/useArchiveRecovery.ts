import { useQuery } from '@tanstack/react-query';
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import { client, buildScopeQueryKey } from '@/api/queryClient';
import { useQueryScope } from '@/api/useQueryScope';
import { useAuth } from '@/auth/authContext';
import { useCan, useRole, usePermissionStatus } from '@/auth/permissionContext';
import { getMasqueradeToken } from '@/api/masqueradeToken';
import { buildAccessKey } from '@/data/planning/planningAccess';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { resolveErrorMessage } from '@/lib/errorMessage';

/** Reads recovery identities; the scoped query key and the cache lifecycle keep one projection's rows from another. */
export function useArchiveRecovery() {
  const { user } = useAuth();
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const mayWrite = useCan('planning:write');
  const companyId = useStore((state) => state.activeCompanyId);
  const planning = useStore((state) => state.planning);
  const accessKey = buildAccessKey(planning.access);
  const enabled =
    mayWrite &&
    !!companyId &&
    !!user &&
    permissionStatus === 'resolved' &&
    planning.access !== null &&
    planning.access.actorId === user.id &&
    planning.access.effectiveActorId === user.id &&
    planning.access.role === role &&
    planning.access.canWrite &&
    planning.context?.companyId === companyId &&
    planning.phase.kind === 'ready';
  const scope = useQueryScope();
  const masqueradeToken = getMasqueradeToken();
  const query = useQuery<ArchiveRecovery>({
    queryKey: buildScopeQueryKey(scope, ['archive-recovery', role, accessKey, planning.revision]),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const { data: recovery } = await client.request('api.planning_archive.show', {
        params: { companyId: companyId ?? '' },
        signal,
        headers: { 'X-Masquerade-Context': masqueradeToken ?? '' },
      });
      if (recovery.companyId !== companyId) {
        throw new Error(m.settings_archived_err_incomplete());
      }
      return recovery;
    },
  });
  if (!enabled) return { data: null, error: null };
  return {
    data: query.isError ? null : (query.data ?? null),
    error: query.error ? resolveErrorMessage(query.error) : null,
  };
}
