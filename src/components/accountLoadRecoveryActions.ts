import type { NavigateFunction } from "react-router-dom";
import { transitionAccount } from "../auth/accountTransition";

export async function chooseAnotherAccountAfterLoadFailure(
  accountRoute: boolean,
  navigate: NavigateFunction,
): Promise<void> {
  try {
    const switched = await transitionAccount(null);
    if (switched && accountRoute) void navigate("/");
  } catch (error: unknown) {
    console.error("Company switch failed", error);
  }
}
