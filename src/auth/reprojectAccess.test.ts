import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateMemberships, refreshAccountSummaries, refreshActiveAccountSlice } = vi.hoisted(() => ({
  invalidateMemberships: vi.fn(),
  refreshAccountSummaries: vi.fn(),
  refreshActiveAccountSlice: vi.fn(),
}));

vi.mock("../store/useStore", () => ({
  useStore: { getState: () => ({ invalidateMemberships }) },
}));
vi.mock("./useAccountSummaries", () => ({ refreshAccountSummaries }));
vi.mock("../data/persist", () => ({ refreshActiveAccountSlice }));

import { reprojectAccess } from "./reprojectAccess";

describe("reprojectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshAccountSummaries.mockResolvedValue([]);
    refreshActiveAccountSlice.mockResolvedValue("reloaded");
  });

  it("invalidates actor-dependent membership data before reloading the active account", async () => {
    await expect(reprojectAccess("a-studio")).resolves.toBe(true);
    expect(invalidateMemberships).toHaveBeenCalledOnce();
    expect(refreshAccountSummaries).toHaveBeenCalledWith({
      allowCachedFallback: false,
      preserveActiveAccountIfMissing: true,
    });
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith("a-studio");
  });

  it("stops when authoritative account summaries cannot be loaded", async () => {
    refreshAccountSummaries.mockResolvedValue(null);

    await expect(reprojectAccess("a-studio")).resolves.toBe(false);
    expect(refreshActiveAccountSlice).not.toHaveBeenCalled();
  });

  it("reports an account-slice reload failure", async () => {
    refreshActiveAccountSlice.mockResolvedValue("unattached");

    await expect(reprojectAccess("a-studio")).resolves.toBe(false);
  });
});
