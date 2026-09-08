import { m } from "@/i18n";
import { useRef, useState } from "react";
import { useAuth } from "../../auth/authContext";
import { clearCapacitylensLocalStorage } from "../../data/clearLocalStorage";
import {
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  clearAllOfflineData,
  setOfflineReadEnabled,
} from "../../data/offlineCache";
import { useExclusiveAction } from "../../hooks/useExclusiveAction";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { reloadPage } from "../../lib/reloadPage";

import type { StoreState } from "../../store/useStore";

interface LocalDataActionInput {
  offlineEnabled: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  user: ReturnType<typeof useAuth>["user"];
  canCreateAccount: boolean;
  multiAccount: boolean;
  accountSummaries: StoreState["accountSummaries"];
  activeAccountId: StoreState["activeAccountId"];
  data: StoreState["data"];
  setNotice: StoreState["setNotice"];
}

function useClearLocalStorageAction(setNotice: StoreState["setNotice"]) {
  const clearActionLock = useRef(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const clearLocalStorage = async () => {
    if (clearActionLock.current) return;
    clearActionLock.current = true;
    setClearBusy(true);
    try {
      await clearAllOfflineData();
      clearCapacitylensLocalStorage();
    } catch (cause) {
      clearActionLock.current = false;
      setClearBusy(false);
      setConfirmingClear(false);
      setNotice(m.settings_err_clear_storage({ error: resolveErrorMessage(cause) }), "error");
      return;
    }
    reloadPage();
  };
  return { confirmingClear, setConfirmingClear, clearBusy, clearLocalStorage };
}

function createToggleOffline(input: LocalDataActionInput, offlineAction: ReturnType<typeof useExclusiveAction>) {
  return () => {
    const next = !input.offlineEnabled;
    offlineAction.run(
      async () => {
        try {
          await setOfflineReadEnabled(next);
          if (next) {
            if (!input.user) throw new Error(m.settings_offline_verified_user_required());
            const authWrite = await cacheAuthSnapshot({
              authMode: input.authMode,
              user: input.user,
              canCreateAccount: input.canCreateAccount,
              multiAccount: input.multiAccount,
            });
            const summariesWrite = await cacheAccountSummaries(input.accountSummaries);
            const sliceWrite = input.activeAccountId
              ? await cacheAccountSlice(input.activeAccountId, input.data)
              : null;
            if (
              authWrite.kind !== "written" ||
              summariesWrite.kind !== "written" ||
              (sliceWrite !== null && sliceWrite.kind !== "written")
            ) {
              throw new Error(m.settings_offline_write_failed());
            }
          }
          input.setNotice(next ? m.settings_offline_enabled_notice() : m.settings_offline_disabled_notice(), "info");
        } catch (cause) {
          if (next) {
            try {
              await setOfflineReadEnabled(false);
            } catch (rollbackError) {
              throw new AggregateError([cause, rollbackError], m.settings_offline_cleanup_incomplete(), {
                cause: rollbackError,
              });
            }
          }
          throw cause;
        }
      },
      (error) => input.setNotice(m.settings_offline_error({ error: resolveErrorMessage(error) }), "error"),
    );
  };
}

export function useLocalDataActions(input: LocalDataActionInput) {
  const { setNotice } = input;
  const clearAction = useClearLocalStorageAction(setNotice);
  const offlineAction = useExclusiveAction();
  const toggleOffline = createToggleOffline(input, offlineAction);

  return { ...clearAction, toggleOffline, offlineBusy: offlineAction.busy };
}
