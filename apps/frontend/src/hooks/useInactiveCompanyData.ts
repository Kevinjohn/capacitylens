import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from '@capacitylens/shared/types/entities';
import { useAuth } from '@/auth/authContext';
import { useCan, useRole } from '@/auth/permissionContext';
import {
  fetchInactiveSlice,
  InactiveSliceHttpError,
  InactiveSliceShapeError,
} from '@/data/fetchInactiveSlice';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { subscribeToInactiveDataChanges } from '@/data/inactiveDataEvents';
import { buildAuthorityKey } from '@/data/planning/planningAuthority';

/** Keeps inactive data outside the active planning store. */
export function useInactiveCompanyData(): {
  data: AppData | null;
  mayViewInactive: boolean;
  reload: () => void;
} {
  // The server serves inactive rows only to `members:manage` (exports_controller.ts).
  const mayViewInactive = useCan('members:manage');
  const role = useRole();
  const { user } = useAuth();
  const planning = useStore((state) => state.planning);
  const masquerade = useStore((state) => state.masquerade);
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const setNotice = useStore((state) => state.setNotice);
  const authorityKey = buildAuthorityKey(planning.authority);
  const [serverData, setServerData] = useState<{
    companyId: string;
    reloadKey: number;
    requestIdentity: object;
    data: AppData;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  // A fresh object on any request-key transition prevents an A → B → A render from resurfacing A's prior response.
  const requestIdentity = useMemo(
    () => ({
      activeCompanyId,
      mayViewInactive,
      reloadKey,
      role,
      principalId: user?.id,
      context: planning.context,
      authorityKey,
      revision: planning.revision,
      masquerade,
    }),
    [
      activeCompanyId,
      mayViewInactive,
      reloadKey,
      role,
      user?.id,
      planning.context,
      authorityKey,
      planning.revision,
      masquerade,
    ],
  );
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(
    () =>
      subscribeToInactiveDataChanges((companyId) => {
        if (companyId === useStore.getState().activeCompanyId) reload();
      }),
    [reload],
  );

  useEffect(() => {
    if (!mayViewInactive || !activeCompanyId) {
      generation.current += 1;
      return;
    }
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    void fetchInactiveSlice(activeCompanyId, controller.signal)
      .then((data) => {
        if (
          generation.current === requestGeneration &&
          useStore.getState().activeCompanyId === activeCompanyId
        ) {
          setServerData({ companyId: activeCompanyId, reloadKey, requestIdentity, data });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        setServerData(null);
        if (error instanceof InactiveSliceHttpError && error.status === 403) return;
        if (error instanceof InactiveSliceHttpError) {
          setNotice(
            error.serverMessage ?? m.settings_archived_err_load({ status: error.status }),
            'error',
          );
        } else if (error instanceof InactiveSliceShapeError) {
          setNotice(m.settings_archived_err_incomplete(), 'error');
        } else setNotice(m.settings_err_server({ error: resolveErrorMessage(error) }), 'error');
      });
    return () => controller.abort();
  }, [activeCompanyId, mayViewInactive, reloadKey, requestIdentity, setNotice]);

  if (!mayViewInactive) return { data: null, mayViewInactive, reload };
  if (serverData?.companyId !== activeCompanyId || serverData.requestIdentity !== requestIdentity) {
    return { data: null, mayViewInactive, reload };
  }
  return { data: serverData.data, mayViewInactive, reload };
}
