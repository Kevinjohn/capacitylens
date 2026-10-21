import { m } from "@/i18n";
import { useRef, useState } from "react";
import { clearCapacitylensLocalStorage } from "@/data/clearLocalStorage";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { reloadPage } from "@/lib/reloadPage";

import type { StoreState } from "@/store/useStore";

function useClearLocalStorageAction(setNotice: StoreState["setNotice"]) {
  const clearActionLock = useRef(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const clearLocalStorage = async () => {
    if (clearActionLock.current) return;
    clearActionLock.current = true;
    setClearBusy(true);
    try {
      clearCapacitylensLocalStorage();
    } catch (cause) {
      // Release cleanup controls and surface the failure so partial local cleanup is not mistaken for completion.
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

/** Clears device preferences with visible failure feedback. */
export function useLocalDataActions(setNotice: StoreState["setNotice"]) {
  const clearAction = useClearLocalStorageAction(setNotice);
  return clearAction;
}
