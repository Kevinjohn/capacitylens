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
import { errorMessage } from "../../lib/errorMessage";
import { reloadPage } from "../../lib/reloadPage";

import type { StoreState } from "../../store/useStore";
export function useLocalDataActions({
  offlineEnabled,
  authMode,
  user,
  canCreateAccount,
  multiAccount,
  accountSummaries,
  activeAccountId,
  data,
  setNotice,
}: {
  offlineEnabled: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  user: ReturnType<typeof useAuth>["user"];
  canCreateAccount: boolean;
  multiAccount: boolean;
  accountSummaries: StoreState["accountSummaries"];
  activeAccountId: StoreState["activeAccountId"];
  data: StoreState["data"];
  setNotice: StoreState["setNotice"];
}) {
  const offlineAction = useExclusiveAction();

  // A user-triggered wipe of everything CapacityLens keeps in this browser: the opt-in read-only
  // cache plus device preferences. Server data is never touched; demo data is memory-only already.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Hand-rolled rather than useExclusiveAction (which the offline toggle above uses): on the SUCCESS
  // path this gate is never reopened, because the next thing that happens is a page reload and a
  // re-enabled confirm button in that window would let a second wipe start. useExclusiveAction
  // always releases in `finally` — correct for a retryable action, wrong for this one.
  const clearActionLock = useRef(false);
  const [clearBusy, setClearBusy] = useState(false);

  const clearLocalStorage = async () => {
    if (clearActionLock.current) return;
    clearActionLock.current = true;
    setClearBusy(true);
    // Surface, never swallow (DEFENSIVE-CODING.md §1): this is a user-triggered action, so a storage
    // failure (private mode / disabled storage) must show as a visible notice rather than vanish.
    try {
      await clearAllOfflineData();
      clearCapacitylensLocalStorage();
    } catch (e) {
      clearActionLock.current = false;
      setClearBusy(false);
      setConfirmingClear(false);
      setNotice(m.settings_err_clear_storage({ error: errorMessage(e) }), "error");
      return;
    }
    // Reload so the app re-initialises from the server or a fresh in-memory demo.
    reloadPage();
  };

  const toggleOffline = () => {
    const next = !offlineEnabled;
    offlineAction.run(
      async () => {
        try {
          await setOfflineReadEnabled(next);
          if (next) {
            if (!user) throw new Error(m.settings_offline_verified_user_required());
            const authWrite = await cacheAuthSnapshot({
              authMode,
              user,
              canCreateAccount,
              multiAccount,
            });
            const summariesWrite = await cacheAccountSummaries(accountSummaries);
            const sliceWrite = activeAccountId ? await cacheAccountSlice(activeAccountId, data) : null;
            if (
              authWrite.status !== "written" ||
              summariesWrite.status !== "written" ||
              (sliceWrite !== null && sliceWrite.status !== "written")
            ) {
              throw new Error(m.settings_offline_write_failed());
            }
          }
          setNotice(next ? m.settings_offline_enabled_notice() : m.settings_offline_disabled_notice(), "info");
        } catch (e) {
          if (next) {
            // Registration succeeded before snapshot creation can fail (quota/private-mode errors).
            // Roll the whole opt-in back so the device never claims offline readiness with a partial
            // cache. If cleanup also fails, surface both failures instead of hiding the second one.
            // The rollback must finish INSIDE the action: the gate reopens once this settles.
            try {
              await setOfflineReadEnabled(false);
            } catch (rollbackError) {
              throw new AggregateError([e, rollbackError], m.settings_offline_cleanup_incomplete(), {
                cause: rollbackError,
              });
            }
          }
          throw e;
        }
      },
      (error) => setNotice(m.settings_offline_error({ error: errorMessage(error) }), "error"),
    );
  };

  return {
    confirmingClear,
    setConfirmingClear,
    clearBusy,
    clearLocalStorage,
    toggleOffline,
    offlineBusy: offlineAction.busy,
  };
}
