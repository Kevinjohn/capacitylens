import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverConfigured: true,
  transitionAccount: vi.fn(),
  start: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("../data/apiConfig", () => ({
  isServerConfigured: () => mocks.serverConfigured,
}));

vi.mock("../store/useStore", () => ({
  useStore: { getState: () => ({ setActiveAccount: mocks.setActiveAccount }) },
}));

vi.mock("./masqueradeController", () => ({
  masqueradeController: { transitionAccount: mocks.transitionAccount, start: mocks.start },
}));

describe("account transition boundary", () => {
  beforeEach(() => {
    mocks.serverConfigured = true;
    mocks.transitionAccount.mockReset();
    mocks.start.mockReset();
    mocks.setActiveAccount.mockReset();
  });

  it("delegates account changes to the masquerade transition boundary", async () => {
    mocks.transitionAccount.mockResolvedValue(true);
    const boundary = await import("./accountTransition");

    await expect(boundary.transitionAccount("a-loft")).resolves.toBe(true);
    expect(mocks.transitionAccount).toHaveBeenCalledWith("a-loft");
  });

  it("delegates account clearing through the same boundary", async () => {
    mocks.transitionAccount.mockResolvedValue(false);
    const boundary = await import("./accountTransition");

    await expect(boundary.transitionAccount(null)).resolves.toBe(false);
    expect(mocks.transitionAccount).toHaveBeenCalledWith(null);
  });

  it("activates local accounts without loading the server transition owner", async () => {
    mocks.serverConfigured = false;
    const boundary = await import("./accountTransition");

    await expect(boundary.transitionAccount("a-studio")).resolves.toBe(true);
    expect(mocks.setActiveAccount).toHaveBeenCalledWith("a-studio");
    expect(mocks.transitionAccount).not.toHaveBeenCalled();
  });

  it("starts masquerade through the same lazy controller boundary", async () => {
    mocks.start.mockResolvedValue(true);
    const boundary = await import("./accountTransition");

    await expect(boundary.startMasquerade("a-studio", "u-viewer")).resolves.toBe(true);
    expect(mocks.start).toHaveBeenCalledWith("a-studio", "u-viewer");
  });
});
