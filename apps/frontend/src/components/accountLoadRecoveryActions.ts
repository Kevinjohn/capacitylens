import type { NavigateFunction } from "react-router-dom";
import { transitionAccount } from "@/auth/accountTransition";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";

// Surface failures while leaving an unavailable company so the blocking recovery view always has an exit.
type ChooseAnotherAccountAfterLoadFailureOptions = { accountRoute: boolean; navigate: NavigateFunction };
/** Leaves the failed account route and selects another accessible account. */
export async function chooseAnotherAccountAfterLoadFailure({
  accountRoute,
  navigate,
}: ChooseAnotherAccountAfterLoadFailureOptions): Promise<void> {
  let switched = false;
  try {
    switched = await transitionAccount(null);
  } catch (error: unknown) {
    console.error("Company switch failed", error);
  }
  if (switched) {
    if (accountRoute) void navigate("/");
    return;
  }
  useStore.getState().setNotice(m.account_load_switch_failed(), "error");
}
