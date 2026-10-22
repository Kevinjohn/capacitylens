import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateMemberships, refreshAccountSummaries, refreshPlanning, state } = vi.hoisted(() => ({
  invalidateMemberships: vi.fn(),
  refreshAccountSummaries: vi.fn(),
  refreshPlanning: vi.fn(),
  state: { activeAccountId: "a-studio" },
}));

vi.mock("@/store/useStore", () => ({
  useStore: { getState: () => ({ invalidateMemberships, refreshPlanning, ...state }) },
}));
vi.mock("./useAccountSummaries", () => ({ refreshAccountSummaries }));

import { reprojectAccess } from "./reprojectAccess";

describe("reprojectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshAccountSummaries.mockResolvedValue([]);
    refreshPlanning.mockResolvedValue(true);
  });

  it("invalidates actor-dependent membership data before reloading the active account", async () => {
    await expect(reprojectAccess("a-studio")).resolves.toBe(true);
    expect(invalidateMemberships).toHaveBeenCalledOnce();
    expect(refreshAccountSummaries).toHaveBeenCalledWith({
      preserveActiveAccountIfMissing: true,
    });
    expect(refreshPlanning).toHaveBeenCalledExactlyOnceWith({ fresh: true });
  });

  it("stops when authoritative account summaries cannot be loaded", async () => {
    refreshAccountSummaries.mockResolvedValue(null);

    await expect(reprojectAccess("a-studio")).resolves.toBe(false);
    expect(refreshPlanning).not.toHaveBeenCalled();
  });

  it("reports an account-slice reload failure", async () => {
    refreshPlanning.mockResolvedValue(false);

    await expect(reprojectAccess("a-studio")).resolves.toBe(false);
  });
});
