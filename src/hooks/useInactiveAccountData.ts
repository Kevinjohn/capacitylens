import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData } from "@capacitylens/shared/types/entities";
import { useCan } from "../auth/permissionContext";
import { isServerConfigured } from "../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../data/fetchInactiveSlice";
import { resolveErrorMessage } from "../lib/errorMessage";
import { useInactiveScopedData } from "../store/useScopedData";
import { useStore } from "../store/useStore";
import { m } from "@/i18n";
import { subscribeToInactiveDataChanges } from "../data/inactiveDataEvents";

/** Keeps inactive data outside the ordinary hydrated store in server mode. */
export function useInactiveAccountData(): {
  data: AppData | null;
  mayViewInactive: boolean;
  reload: () => void;
} {
  const server = isServerConfigured();
  const mayViewInactive = useCan("purge");
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const localData = useInactiveScopedData();
  const [serverData, setServerData] = useState<{
    accountId: string;
    reloadKey: number;
    requestIdentity: object;
    data: AppData;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  // A fresh object on any request-key transition prevents an A → B → A render from resurfacing A's prior response.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- these values intentionally define the request identity
  const requestIdentity = useMemo(() => ({}), [activeAccountId, mayViewInactive, reloadKey]);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(
    () =>
      subscribeToInactiveDataChanges((accountId) => {
        if (accountId === useStore.getState().activeAccountId) reload();
      }),
    [reload],
  );

  useEffect(() => {
    if (!server || !mayViewInactive || !activeAccountId) {
      generation.current += 1;
      return;
    }
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    void fetchInactiveSlice(activeAccountId, controller.signal)
      .then((data) => {
        if (generation.current === requestGeneration && useStore.getState().activeAccountId === activeAccountId)
          setServerData({ accountId: activeAccountId, reloadKey, requestIdentity, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        setServerData(null);
        if (error instanceof InactiveSliceHttpError && error.status === 403) return;
        if (error instanceof InactiveSliceHttpError)
          setNotice(error.serverMessage ?? m.settings_archived_err_load({ status: error.status }), "error");
        else if (error instanceof InactiveSliceShapeError) setNotice(m.settings_archived_err_incomplete(), "error");
        else setNotice(m.settings_err_server({ error: resolveErrorMessage(error) }), "error");
      });
    return () => controller.abort();
  }, [activeAccountId, mayViewInactive, reloadKey, requestIdentity, server, setNotice]);

  if (!mayViewInactive) return { data: null, mayViewInactive, reload };
  if (!server) return { data: localData, mayViewInactive, reload };
  if (
    serverData?.accountId !== activeAccountId ||
    serverData.reloadKey !== reloadKey ||
    serverData.requestIdentity !== requestIdentity
  )
    return { data: null, mayViewInactive, reload };
  return { data: serverData.data, mayViewInactive, reload };
}
