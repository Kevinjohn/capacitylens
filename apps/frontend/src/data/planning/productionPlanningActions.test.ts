import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { makeAccount, makeActivity, makeAllocation, makeAppData } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import type { StoreState } from "@/store/types";
import type { PlanningMutationSuccess } from "@capacitylens/backend/planning";
import { createPlanningCacheController, createPlanningCacheState } from "./planningCacheController";
import type { PlanningTransport } from "./planningCacheController";
import { createProductionPlanningActions } from "./productionPlanningActions";

function setup() {
  const allocation = makeAllocation({ id: "booking", accountId: "wayne", hoursPerDay: 4 });
  let canonical: { revision: number; data: ReturnType<typeof makeAppData>; accessKey?: string; canWrite: boolean } = {
    revision: 2,
    canWrite: true,
    accessKey: "original authority",
    data: makeAppData({
      accounts: [makeAccount({ id: "wayne" })],
      activities: [makeActivity({ id: allocation.activityId, accountId: "wayne" })],
      allocations: [allocation],
    }),
  };
  const execute = vi.fn<PlanningTransport["execute"]>();
  const read = vi.fn(async () => canonical);
  const store = createStore<StoreState>(() => ({
    ...useStore.getState(),
    ...createPlanningCacheState(),
    activeAccountId: "wayne",
  }));
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: { execute, read, lookup: vi.fn() },
  });
  controller.setContext({ identity: "actor", companyId: "wayne" });
  return {
    store,
    controller,
    execute,
    read,
    allocation,
    actions: createProductionPlanningActions(store, controller),
    setCanonical(value: typeof canonical) {
      canonical = value;
    },
  };
}

describe("production planning actions", () => {
  it.each([false, true])("maps duplicate copies by whether non-date fields changed (%s)", async (edited) => {
    const h = setup();
    await h.controller.refresh();
    h.execute.mockRejectedValue({ status: 400, code: "validation_error", message: "Test refusal" });
    const draft = h.controller.begin(h.allocation);
    await expect(
      h.actions.duplicateAllocation(
        "booking",
        {
          ...h.allocation,
          startDate: "2026-11-02",
          endDate: "2026-11-06",
          hoursPerDay: edited ? 6 : h.allocation.hoursPerDay,
        },
        draft,
      ),
    ).rejects.toMatchObject({ code: "validation_error" });
    const intent = h.execute.mock.calls[0]?.[1].intent;
    expect(intent?.operation).toBe(edited ? "allocation.create" : "allocation.duplicate");
    if (intent?.operation === "allocation.duplicate") expect(intent.sourceAllocationId).toBe("booking");
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.store.getState().data.allocations).toHaveLength(1);
  });

  it("limits repeated absence commands to writable fields and fresh stable IDs", async () => {
    const h = setup();
    await h.controller.refresh();
    h.execute.mockRejectedValue({ status: 400, code: "validation_error", message: "Test refusal" });
    const fields = {
      resourceId: "resource",
      startDate: "2026-10-26",
      endDate: "2026-10-30",
      type: "holiday" as const,
      id: "supplied-id",
      accountId: "another-company",
      createdAt: "untrusted",
    };
    await expect(h.actions.addTimeOffs([fields])).rejects.toMatchObject({ code: "validation_error" });
    const intent = h.execute.mock.calls[0]?.[1].intent;
    if (intent?.operation !== "timeOff.repeat") throw new Error("Expected repeat command.");
    expect(intent.entries).toHaveLength(1);
    const entry = intent.entries[0];
    if (!entry) throw new Error("Expected one repeated absence.");
    const { id, ...writable } = entry;
    expect(writable).toEqual({
      resourceId: "resource",
      startDate: "2026-10-26",
      endDate: "2026-10-30",
      type: "holiday",
      note: null,
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("rejects an unchanged form from a superseded access generation", async () => {
    const h = setup();
    await h.controller.refresh();
    const draft = h.controller.begin(h.allocation);
    h.setCanonical({ canWrite: true, revision: 2, accessKey: "new authority", data: h.store.getState().data });
    await h.controller.refresh();
    await expect(h.actions.updateAllocation("booking", { hoursPerDay: 4 }, draft)).rejects.toThrow(/context changed/);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("keeps canonical rows and typed history unchanged until acknowledgement", async () => {
    const h = setup();
    await h.controller.refresh();
    const draft = h.controller.begin(h.allocation);
    let acknowledge!: (receipt: PlanningMutationSuccess) => void;
    h.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const saving = h.actions.updateAllocation("booking", { hoursPerDay: 6 }, draft);
    expect(h.store.getState().data.allocations[0]?.hoursPerDay).toBe(4);
    expect(h.store.getState().planning.history.past).toHaveLength(0);
    const execution = h.execute.mock.calls[0]?.[1];
    if (!execution) throw new Error("Expected one dispatched planning execution.");
    const saved = { ...h.allocation, hoursPerDay: 6 };
    h.setCanonical({
      canWrite: true,
      revision: 3,
      data: makeAppData({ accounts: [makeAccount({ id: "wayne" })], allocations: [saved] }),
    });
    acknowledge({
      status: "committed",
      mutationId: execution.mutationId,
      revision: 3,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: {
        mode: "patch",
        history: "retain",
        changed: { upserts: [{ entity: "allocations", row: saved }], removed: [] },
      },
    });
    await expect(saving).resolves.toBe(true);
    expect(h.store.getState().data.allocations[0]?.hoursPerDay).toBe(6);
    expect(h.store.getState().planning.history.past[0]?.inverse).toMatchObject({
      operation: "allocation.update",
      changes: { hoursPerDay: 4 },
    });
  });

  it("sends the captured revision after refresh and never retries a stale form", async () => {
    const h = setup();
    await h.controller.refresh();
    const draft = h.controller.begin(h.allocation);
    h.setCanonical({ canWrite: true, revision: 3, data: h.store.getState().data });
    await h.controller.refresh();
    h.execute.mockRejectedValue({ status: 409, code: "stale_revision", message: "Company data changed." });
    await expect(h.actions.updateAllocation("booking", { hoursPerDay: 6 }, draft)).rejects.toMatchObject({
      code: "stale_revision",
    });
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0]?.[1].baseRevision).toBe(2);
    expect(h.store.getState().data.allocations[0]?.hoursPerDay).toBe(4);
    expect(h.store.getState().planning.history.past).toHaveLength(0);
  });

  it("does not acknowledge a known commit whose canonical refresh is unavailable", async () => {
    const h = setup();
    await h.controller.refresh();
    const draft = h.controller.begin(h.allocation);
    h.execute.mockImplementation(async (_context, execution) => ({
      status: "committed",
      mutationId: execution.mutationId,
      revision: 3,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: { mode: "patch", history: "retain", changed: { upserts: [], removed: [] } },
    }));
    // A lower revision cannot finalize the committed execution.
    await expect(h.actions.updateAllocation("booking", { hoursPerDay: 6 }, draft)).rejects.toMatchObject({
      uncertain: true,
    });
    expect(h.store.getState().planning.pending?.commitment?.revision).toBe(3);
    expect(h.store.getState().planning.history.past).toHaveLength(0);
  });
  it("does not mistake a newer authority's acknowledgement for the superseded form's completion", async () => {
    const h = setup();
    await h.controller.refresh();
    const oldDraft = h.controller.begin(h.allocation);
    let releaseOldRead!: (value: Awaited<ReturnType<PlanningTransport["read"]>>) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOldRead = resolve;
        }),
    );
    h.execute.mockImplementation(async (_context, execution) => {
      if (execution.intent.operation !== "allocation.update") throw new Error("Expected allocation update.");
      const hoursPerDay: unknown = execution.intent.changes.hoursPerDay;
      if (typeof hoursPerDay !== "number") throw new Error("Expected the hours patch.");
      const saved = { ...h.allocation, hoursPerDay };
      const revision = execution.baseRevision + 1;
      h.setCanonical({
        canWrite: true,
        revision,
        data: makeAppData({ accounts: [makeAccount({ id: "wayne" })], allocations: [saved] }),
        accessKey: revision === 3 ? "original authority" : "new authority",
      });
      return {
        status: "committed",
        mutationId: execution.mutationId,
        revision,
        restoration: { consumedGroupId: null, replacementGroupId: null },
        projection: {
          mode: "patch",
          history: "retain",
          changed: { upserts: [{ entity: "allocations", row: saved }], removed: [] },
        },
      };
    });
    const oldResult = h.actions.updateAllocation("booking", { hoursPerDay: 6 }, oldDraft).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledTimes(2));
    const saved = { ...h.allocation, hoursPerDay: 6 };
    h.setCanonical({
      canWrite: true,
      revision: 3,
      accessKey: "new authority",
      data: makeAppData({ accounts: [makeAccount({ id: "wayne" })], allocations: [saved] }),
    });
    await h.controller.refresh();
    const newDraft = h.controller.begin(saved);
    await h.actions.updateAllocation("booking", { hoursPerDay: 7 }, newDraft);
    releaseOldRead({
      canWrite: true,
      revision: 3,
      accessKey: "original authority",
      data: makeAppData({ accounts: [makeAccount({ id: "wayne" })], allocations: [saved] }),
    });
    expect(await oldResult).toHaveProperty("error");
    expect(h.store.getState().data.allocations[0]?.hoursPerDay).toBe(7);
  });
});
