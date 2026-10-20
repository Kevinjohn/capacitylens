import { afterEach, describe, expect, it, vi } from "vitest";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { makeAccount, makeAppData } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { publishMasqueradeAccount } from "./masqueradeProjectionRecovery";

const state: MasqueradeState = {
  accountId: "wayne",
  targetUserId: "selina",
  targetName: "Selina Kyle",
  effectiveRole: "viewer",
  startedAt: "2026-10-20T10:00:00.000Z",
  token: "verified-session-token",
};

afterEach(() => {
  useStore.setState({
    data: emptyAppData(),
    activeAccountId: null,
    accountSummaries: [],
    accountSummariesComplete: false,
    masquerade: { kind: "inactive" },
  });
  vi.restoreAllMocks();
});

describe("publishMasqueradeAccount", () => {
  it("defers an unknown cold selection to the verified planning runtime", () => {
    useStore.setState({ data: emptyAppData(), activeAccountId: null, accountSummaries: [] });
    const setActiveAccount = vi.spyOn(useStore.getState(), "setActiveAccount");

    publishMasqueradeAccount(state, true);

    expect(useStore.getState().activeAccountId).toBeNull();
    expect(useStore.getState().accountSummaries).toEqual([]);
    expect(useStore.getState().accountSummariesComplete).toBe(false);
    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(useStore.getState().activeRole).toBe("viewer");
  });

  it("selects the company normally when its canonical account row is already loaded", () => {
    useStore.setState({
      data: makeAppData({ accounts: [makeAccount({ id: "wayne", name: "Wayne Enterprises" })] }),
      activeAccountId: null,
    });

    publishMasqueradeAccount(state, true);

    expect(useStore.getState().activeAccountId).toBe("wayne");
    expect(useStore.getState().accountSummaries).toEqual([{ id: "wayne", name: "Wayne Enterprises", role: "viewer" }]);
  });
});
