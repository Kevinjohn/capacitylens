import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store/useStore";

const mocks = vi.hoisted(() => ({ transitionAccount: vi.fn() }));

vi.mock("../auth/accountTransition", () => ({ transitionAccount: mocks.transitionAccount }));

import { chooseAnotherAccountAfterLoadFailure } from "./accountLoadRecoveryActions";

describe("chooseAnotherAccountAfterLoadFailure", () => {
  beforeEach(() => {
    mocks.transitionAccount.mockReset();
    useStore.getState().setNotice(null);
  });

  it("returns to the schedule after leaving a failed company from the Account route", async () => {
    const navigate = vi.fn();
    mocks.transitionAccount.mockResolvedValue(true);

    await chooseAnotherAccountAfterLoadFailure(true, navigate);

    expect(mocks.transitionAccount).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("keeps the current route when it is not the Account route", async () => {
    const navigate = vi.fn();
    mocks.transitionAccount.mockResolvedValue(true);

    await chooseAnotherAccountAfterLoadFailure(false, navigate);

    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not navigate when leaving the company is refused, and surfaces a notice", async () => {
    const navigate = vi.fn();
    mocks.transitionAccount.mockResolvedValue(false);

    await chooseAnotherAccountAfterLoadFailure(true, navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toEqual({
      message: "Could not switch company. Please try again.",
      tone: "error",
    });
  });

  it("surfaces a transition failure without rejecting the click handler", async () => {
    const error = new Error("switch failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.transitionAccount.mockRejectedValue(error);

    await expect(chooseAnotherAccountAfterLoadFailure(true, vi.fn())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Company switch failed", error);
    expect(useStore.getState().notice).toEqual({
      message: "Could not switch company. Please try again.",
      tone: "error",
    });
    log.mockRestore();
  });
});
