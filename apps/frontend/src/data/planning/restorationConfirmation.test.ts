import { createStore } from "zustand/vanilla";
import { describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import {
  createPlanningCacheController,
  createPlanningCacheState,
  PlanningControllerError,
} from "./planningCacheController";
import type { PlanningCacheState, PlanningTransport } from "./planningCacheController";

const context = { identity: "bruce", companyId: "wayne" };
const intent = {
  operation: "catalogue.update",
  entity: { entity: "projects", id: "gotham", changes: { codeName: "Night" } },
} as const;
function harness(confirm?: (count: number, signal: AbortSignal) => Promise<boolean>) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState());
  const execute = vi
    .fn<PlanningTransport["execute"]>()
    .mockRejectedValueOnce(
      new PlanningControllerError(
        "This change clears 3 restorable items",
        "restoration_confirmation_required",
        409,
        false,
        3,
      ),
    )
    .mockImplementation(async (_context, execution) => ({
      status: "committed",
      mutationId: execution.mutationId,
      revision: 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: { mode: "refetch", history: "clear" },
    }));
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: { execute, read: async () => ({ revision: 0, canWrite: true, data: emptyAppData() }), lookup: vi.fn() },
    ...(confirm ? { confirmRestorationCleanup: confirm } : {}),
  });
  controller.setContext(context);
  return { controller, store, execute };
}

describe("restoration cleanup confirmation", () => {
  it("cancels without changing data, draft or history", async () => {
    const confirm = vi.fn(async () => false);
    const h = harness(confirm);
    await h.controller.refresh();
    const before = h.store.getState();
    const draft = h.controller.begin({ codeName: "Day" });
    expect(await h.controller.execute(draft, intent, null)).toBeNull();
    expect(h.store.getState()).toEqual(before);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    expect(draft.originalWritable).toEqual({ codeName: "Day" });
  });
  it("confirms once using the original identity, intent and revision plus exact count", async () => {
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin({}), intent, null);
    expect(h.execute).toHaveBeenCalledTimes(2);
    const initial = h.execute.mock.calls[0]?.[1];
    expect(initial).toBeDefined();
    expect(h.execute.mock.calls[1]?.[1]).toEqual({ ...initial, confirmedRestorationCount: 3 });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("fails closed without a dialog callback and never automatically asks twice", async () => {
    const closed = harness();
    await closed.controller.refresh();
    await expect(closed.controller.execute(closed.controller.begin({}), intent, null)).rejects.toMatchObject({
      code: "restoration_confirmation_required",
    });
    expect(closed.execute).toHaveBeenCalledTimes(1);
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    h.execute.mockReset();
    h.execute.mockRejectedValue(
      new PlanningControllerError("The count changed.", "restoration_confirmation_stale", 409, false, 2),
    );
    // First refusal carries the original exact count; the confirmed retry receives the changed count.
    h.execute.mockRejectedValueOnce(
      new PlanningControllerError("Confirm cleanup.", "restoration_confirmation_required", 409, false, 3),
    );
    await h.controller.refresh();
    await expect(h.controller.execute(h.controller.begin({}), intent, null)).rejects.toMatchObject({
      code: "restoration_confirmation_stale",
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledTimes(2);
  });
  it("refuses malformed non-positive confirmation counts without opening a dialog", async () => {
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    h.execute
      .mockReset()
      .mockRejectedValue(
        new PlanningControllerError("Invalid count.", "restoration_confirmation_required", 409, false, -1),
      );
    await h.controller.refresh();
    await expect(h.controller.execute(h.controller.begin({}), intent, null)).rejects.toMatchObject({
      code: "restoration_confirmation_required",
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it("keeps a newer canonical revision observed while confirmation was open", async () => {
    let cancel!: (value: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          cancel = resolve;
        }),
    );
    const h = harness(confirm);
    await h.controller.refresh();
    const pending = h.controller.execute(h.controller.begin({}), intent, null);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    h.store.setState((current) => ({ planning: { ...current.planning, revision: 7 } }));
    cancel(false);
    expect(await pending).toBeNull();
    expect(h.store.getState().planning).toMatchObject({ revision: 7, status: "ready", pending: null });
  });
  it("cannot replay after context changes while the dialog is open", async () => {
    let accept!: (value: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const h = harness(confirm);
    await h.controller.refresh();
    const pending = h.controller.execute(h.controller.begin({}), intent, null);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    h.controller.setContext(null);
    accept(true);
    await expect(pending).rejects.toThrow();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.store.getState().planning.context).toBeNull();
  });
});
