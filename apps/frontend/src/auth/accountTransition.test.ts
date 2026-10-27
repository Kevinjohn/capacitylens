import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverConfigured: true,
  controllerLoaded: vi.fn(),
  transitionAccount: vi.fn(),
  start: vi.fn(),
  adoptStatus: vi.fn(),
  captureStatusReconciliation: vi.fn(),
  status: vi.fn(),
  retryProjection: vi.fn(),
  end: vi.fn(),
  setActiveAccount: vi.fn(),
  activeAccountId: "a-studio" as string | null,
}));

vi.mock("@/data/apiConfig", () => ({
  isServerConfigured: () => mocks.serverConfigured,
}));

vi.mock("@/store/useStore", () => ({
  useStore: {
    getState: () => ({ activeAccountId: mocks.activeAccountId, setActiveAccount: mocks.setActiveAccount }),
  },
}));

vi.mock("./masqueradeApi", () => ({
  masqueradeApi: { status: mocks.status },
}));

vi.mock("./masqueradeController", () => ({
  masqueradeController:
    (mocks.controllerLoaded(),
    {
      transitionAccount: mocks.transitionAccount,
      start: mocks.start,
      adoptStatus: mocks.adoptStatus,
      captureStatusReconciliation: mocks.captureStatusReconciliation,
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
    mocks.captureStatusReconciliation.mockReset();
    mocks.status.mockReset();
    mocks.retryProjection.mockReset();
    mocks.end.mockReset();
    mocks.setActiveAccount.mockReset();
    mocks.activeAccountId = "a-studio";
  });

  it("rechecks refresh ownership after the controller finishes loading", async () => {
    const isCurrent = vi.fn(() => mocks.controllerLoaded.mock.calls.length === 0);
    const boundary = await import("./accountTransition");

    await expect(
      boundary.adoptMasqueradeStatus({ active: false, contextToken: "idle-context" }, isCurrent),
    ).resolves.toBe(false);
    expect(mocks.controllerLoaded).toHaveBeenCalledOnce();
    expect(isCurrent).toHaveBeenCalledOnce();
    expect(mocks.adoptStatus).not.toHaveBeenCalled();
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
    const status = { active: false as const, contextToken: "idle-context" };
    const boundary = await import("./accountTransition");

    await expect(boundary.adoptMasqueradeStatus(status)).resolves.toBe(true);

    expect(mocks.adoptStatus).toHaveBeenCalledWith(status);
  });

  it("ignores a status response that arrives after its captured projection becomes stale", async () => {
    let isCurrent = true;
    let resolveStatus!: (status: { active: false; contextToken: string }) => void;
    mocks.captureStatusReconciliation.mockReturnValue(() => isCurrent);
    mocks.status.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const boundary = await import("./accountTransition");
    const reconciliation = boundary.reconcileMasqueradeStatus();

    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledWith("a-studio"));
    isCurrent = false;
    resolveStatus({ active: false, contextToken: "stale-idle-context" });

    await expect(reconciliation).resolves.toBeUndefined();
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
