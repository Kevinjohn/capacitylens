import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MasqueradeState, MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";
import { resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { MasqueradeController, type MasqueradeControllerDependencies } from "./masqueradeController";

const state: MasqueradeState = {
  accountId: "a-studio",
  targetUserId: "u-viewer",
  targetName: "Selina Kyle",
  effectiveRole: "viewer",
  startedAt: "2026-09-01T10:00:00.000Z",
  token: "token-1",
};

function harness(overrides: Partial<MasqueradeControllerDependencies> = {}) {
  const resume = vi.fn();
  const dependencies: MasqueradeControllerDependencies = {
    flush: vi.fn(async () => true),
    suspend: vi.fn(() => resume),
    reproject: vi.fn(async () => true),
    switchAccount: vi.fn(async (): Promise<"reloaded"> => "reloaded"),
    api: {
      status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: false })),
      start: vi.fn(async () => state),
      end: vi.fn(async () => {}),
    },
    ...overrides,
  };
  return { controller: new MasqueradeController(dependencies), dependencies, resume };
}

beforeEach(() => {
  resetStoreWithAccount();
  useStore.getState().setMasquerade({ phase: "inactive" });
  useStore.getState().setNotice(null);
});

describe("MasqueradeController", () => {
  it("acquires one suspension across start and end, then releases it once after the real reload", async () => {
    const { controller, dependencies, resume } = harness();
    const navigate = vi.fn(() => {
      expect(useStore.getState().masquerade).toEqual({ phase: "inactive" });
    });

    await expect(controller.start(state.accountId, state.targetUserId)).resolves.toBe(true);
    expect(useStore.getState().masquerade.phase).toBe("active");
    expect(dependencies.suspend).toHaveBeenCalledTimes(1);

    await expect(controller.end("explicit", navigate)).resolves.toBe(true);
    expect(dependencies.suspend).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: true });
    expect(useStore.getState().masquerade).toEqual({ phase: "inactive" });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("aborts before suspension when pending writes cannot be flushed", async () => {
    const { controller, dependencies } = harness({ flush: vi.fn(async () => false) });
    await expect(controller.start(state.accountId, state.targetUserId)).resolves.toBe(false);
    expect(dependencies.suspend).not.toHaveBeenCalled();
    expect(dependencies.api.start).not.toHaveBeenCalled();
  });

  it("releases without dropping edits when the start request fails", async () => {
    const { controller, resume } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: false })),
        start: vi.fn(async () => {
          throw new Error("denied");
        }),
        end: vi.fn(async () => {}),
      },
    });
    await expect(controller.start(state.accountId, state.targetUserId)).resolves.toBe(false);
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: false });
    expect(useStore.getState().masquerade).toEqual({ phase: "inactive" });
  });

  it("stays suspended and starting when projection fails after a successful start", async () => {
    const { controller, resume } = harness({ reproject: vi.fn(async () => false) });
    await expect(controller.start(state.accountId, state.targetUserId)).resolves.toBe(false);
    expect(useStore.getState().masquerade).toMatchObject({ phase: "starting", state });
    expect(resume).not.toHaveBeenCalled();
  });

  it("reports an account switch requested while the start request is still in flight", async () => {
    let resolveStart!: (value: MasqueradeState) => void;
    const startResponse = new Promise<MasqueradeState>((resolve) => {
      resolveStart = resolve;
    });
    const { controller, dependencies } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: false })),
        start: vi.fn(() => startResponse),
        end: vi.fn(async () => {}),
      },
    });

    const starting = controller.start(state.accountId, state.targetUserId);
    await vi.waitFor(() => expect(useStore.getState().masquerade.phase).toBe("starting"));

    await expect(controller.transitionAccount("a-loft")).resolves.toBe(false);
    expect(useStore.getState().notice).toMatchObject({
      message: "Wait for the current masquerade transition to finish.",
      tone: "error",
    });
    expect(dependencies.api.end).not.toHaveBeenCalled();
    expect(dependencies.switchAccount).not.toHaveBeenCalled();

    resolveStart(state);
    await expect(starting).resolves.toBe(true);
  });

  it("keeps a failed projection retry contained and suspended", async () => {
    const { controller, resume } = harness({
      reproject: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")),
    });
    await controller.start(state.accountId, state.targetUserId);

    await expect(controller.retryProjection()).resolves.toBe(false);
    expect(useStore.getState().masquerade.phase).toBe("starting");
    expect(resume).not.toHaveBeenCalled();
  });

  it("adopts a newer cross-tab masquerade returned after DELETE", async () => {
    const newer = { ...state, targetUserId: "u-editor", targetName: "Dick Grayson", token: "token-2" };
    const { controller, resume } = harness({
      api: {
        status: vi.fn(async () => ({ active: true, ...newer })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {}),
      },
    });
    const navigate = vi.fn();
    controller.adoptStatus({ active: true, ...state });
    await expect(controller.end("explicit", navigate)).resolves.toBe(true);
    expect(useStore.getState().masquerade).toMatchObject({ phase: "active", state: newer });
    expect(navigate).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("refuses an account switch when DELETE fails and keeps writes suspended", async () => {
    const { controller, dependencies, resume } = harness({
      api: {
        status: vi.fn(async () => ({ active: true, ...state })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {
          throw new Error("offline");
        }),
      },
    });
    controller.adoptStatus({ active: true, ...state });
    await expect(controller.transitionAccount("a-loft")).resolves.toBe(false);
    expect(dependencies.switchAccount).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade.phase).toBe("ending");
    expect(resume).not.toHaveBeenCalled();
  });

  it("restores the real projection when another tab has ended the shared session masquerade", async () => {
    const { controller, dependencies, resume } = harness();
    controller.adoptStatus({ active: true, ...state });

    controller.adoptStatus({ active: false });
    await vi.waitFor(() => expect(useStore.getState().masquerade.phase).toBe("inactive"));

    expect(dependencies.reproject).toHaveBeenCalledWith(state.accountId);
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: true });
  });
});
