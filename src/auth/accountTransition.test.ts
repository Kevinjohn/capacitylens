import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverConfigured: true,
  controllerLoaded: vi.fn(),
  transitionAccount: vi.fn(),
  start: vi.fn(),
  adoptStatus: vi.fn(),
  retryProjection: vi.fn(),
  end: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("../data/apiConfig", () => ({
  isServerConfigured: () => mocks.serverConfigured,
}));

vi.mock("../store/useStore", () => ({
  useStore: { getState: () => ({ setActiveAccount: mocks.setActiveAccount }) },
}));

vi.mock("./masqueradeController", () => ({
  masqueradeController:
    (mocks.controllerLoaded(),
    {
      transitionAccount: mocks.transitionAccount,
      start: mocks.start,
      adoptStatus: mocks.adoptStatus,
      retryProjection: mocks.retryProjection,
      end: mocks.end,
    }),
}));

describe("account transition boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.serverConfigured = true;
    mocks.controllerLoaded.mockReset();
    mocks.transitionAccount.mockReset();
    mocks.start.mockReset();
    mocks.adoptStatus.mockReset();
    mocks.retryProjection.mockReset();
    mocks.end.mockReset();
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
    expect(mocks.controllerLoaded).not.toHaveBeenCalled();
    expect(mocks.transitionAccount).not.toHaveBeenCalled();
  });

  it("starts masquerade through the same lazy controller boundary", async () => {
    mocks.start.mockResolvedValue(true);
    const boundary = await import("./accountTransition");

    await expect(boundary.startMasquerade("a-studio", "u-viewer")).resolves.toBe(true);
    expect(mocks.start).toHaveBeenCalledWith("a-studio", "u-viewer");
  });

  it("adopts server status through the lazy controller boundary", async () => {
    const status = { active: false as const };
    const boundary = await import("./accountTransition");

    await expect(boundary.adoptMasqueradeStatus(status)).resolves.toBe(true);

    expect(mocks.adoptStatus).toHaveBeenCalledWith(status);
  });

  it("does not adopt server status when refresh ownership expired before adoption", async () => {
    const isCurrent = vi.fn(() => false);
    const boundary = await import("./accountTransition");

    await expect(boundary.adoptMasqueradeStatus({ active: false }, isCurrent)).resolves.toBe(false);
    expect(isCurrent).toHaveBeenCalledOnce();
    expect(mocks.adoptStatus).not.toHaveBeenCalled();
  });

  it("retries projection through the lazy controller boundary", async () => {
    mocks.retryProjection.mockResolvedValue(true);
    const boundary = await import("./accountTransition");

    await expect(boundary.retryMasqueradeProjection()).resolves.toBe(true);
    expect(mocks.retryProjection).toHaveBeenCalledOnce();
  });

  it("ends masquerade through the lazy controller boundary", async () => {
    mocks.end.mockResolvedValue(true);
    const navigate = vi.fn();
    const boundary = await import("./accountTransition");

    await expect(boundary.endMasquerade("explicit", navigate)).resolves.toBe(true);
    expect(mocks.end).toHaveBeenCalledWith("explicit", navigate);
  });
});
