import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AppData } from '@capacitylens/shared/types/entities';
import { buildScopeQueryKey } from '@/api/queryClient';
import { useAuth } from '@/auth/authContext';
import { useCan, useRole } from '@/auth/permissionContext';
import {
  fetchInactiveRecords,
  InactiveRecordsHttpError,
  InactiveRecordsShapeError,
} from '@/data/fetchInactiveRecords';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { buildAccessKey } from '@/data/planning/planningAccess';

/** Keeps inactive data outside the active planning store. */
export function useInactiveCompanyData(): {
  data: AppData | null;
  mayViewInactive: boolean;
} {
  // The server serves inactive rows only to `members:manage` (company_state_controller.ts).
  const mayViewInactive = useCan('members:manage');
  const role = useRole();
  const { user } = useAuth();
  const planning = useStore((state) => state.planning);
  const masquerade = useStore((state) => state.masquerade);
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const setNotice = useStore((state) => state.setNotice);
  const enabled = mayViewInactive && !!activeCompanyId;
  const query = useQuery<AppData>({
    queryKey: buildScopeQueryKey(
      {
        userId: user?.id ?? null,
        companyId: activeCompanyId,
        masqueradeGeneration: masquerade.kind === 'inactive' ? 0 : masquerade.generation,
      },
      ['inactive-company-data', role, buildAccessKey(planning.access), planning.revision],
    ),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => fetchInactiveRecords(activeCompanyId ?? '', signal),
  });

  const { error } = query;
  useEffect(() => {
    if (!error) return;
    if (error instanceof InactiveRecordsHttpError && error.status === 403) return;
    if (error instanceof InactiveRecordsHttpError) {
      setNotice(
        error.serverMessage ?? m.settings_archived_err_load({ status: error.status }),
        'error',
      );
    } else if (error instanceof InactiveRecordsShapeError) {
      setNotice(m.settings_archived_err_incomplete(), 'error');
    } else setNotice(m.settings_err_server({ error: resolveErrorMessage(error) }), 'error');
  }, [error, setNotice]);

  return { data: enabled && !query.isError ? (query.data ?? null) : null, mayViewInactive };
}
