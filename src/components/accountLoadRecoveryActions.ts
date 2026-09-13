import type { NavigateFunction } from "react-router-dom";
import { transitionAccount } from "../auth/accountTransition";
import { useStore } from "../store/useStore";
import { m } from "@/i18n";

/** The recovery screen's only exit: leave a company whose data failed to load. A silent failure
 * here would leave the user stuck on a blocking full-screen stage with no visible next step. */
export async function chooseAnotherAccountAfterLoadFailure(
  accountRoute: boolean,
  navigate: NavigateFunction,
): Promise<void> {
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
