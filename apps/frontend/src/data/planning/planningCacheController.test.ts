import { createStore } from "zustand/vanilla";
import { describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { PlanningIntent, PlanningMutationSuccess } from "@capacitylens/backend/planning";
import { createPlanningCacheController, createPlanningCacheState } from "./planningCacheController";
import type { PlanningCacheState, PlanningSnapshot, PlanningTransport } from "./planningCacheController";

const context = { identity: "actor-1", companyId: "company-1" };
const intent = { operation: "allocation.update", id: "allocation-1", changes: { startDate: "2026-10-21" } } as const;
const inverse = { operation: "allocation.update", id: "allocation-1", changes: { startDate: "2026-10-20" } } as const;
const makeState = (): PlanningCacheState => createPlanningCacheState();
const success = (mutationId: string, revision: number): PlanningMutationSuccess => ({
  status: "committed",
  mutationId,
  revision,
  restoration: { consumedGroupId: null, replacementGroupId: null },
  projection: { mode: "patch", history: "retain", changed: { upserts: [], removed: [] } },
});

function harness(transport: PlanningTransport) {
  const store = createStore<PlanningCacheState>(() => makeState());
  const snapshots: PlanningSnapshot[] = [];
  let serverSnapshot: PlanningSnapshot = { revision: 0, canWrite: true, data: emptyAppData() };
  const read = vi.fn(async (clientContext: Parameters<PlanningTransport["read"]>[0], signal: AbortSignal) => {
    const snapshot = snapshots.shift();
    if (snapshot) {
      serverSnapshot = snapshot;
      return snapshot;
    }
    const result: unknown = await transport.read(clientContext, signal);
    if (typeof result === "object" && result !== null) return result as PlanningSnapshot;
    return serverSnapshot;
  });
  let id = 0;
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: {
      ...transport,
      read,
      async execute(...args) {
        const receipt = await transport.execute(...args);
        serverSnapshot = { ...serverSnapshot, revision: receipt.revision };
        return receipt;
      },
    },
    createMutationId: vi.fn(() => `mutation-${++id}`),
  });
  return {
    controller,
    state: store.getState,
    async readSnapshot(snapshot: PlanningSnapshot) {
      snapshots.push(snapshot);
      return controller.refresh();
    },
  };
}

describe("planning cache controller", () => {
  it("retains the draft revision through refresh and refuses the stale attempt without replay", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue({ status: 409, code: "stale_revision" });
    const read = vi
      .fn<PlanningTransport["read"]>()
      .mockResolvedValue({ revision: 4, canWrite: true, data: emptyAppData() });
    const h = harness({ execute, read, lookup: vi.fn<PlanningTransport["lookup"]>() });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 3, canWrite: true, data: emptyAppData() });
    const draft = h.controller.begin({ timezone: "Etc/GMT" });
    await h.readSnapshot({ revision: 4, canWrite: true, data: emptyAppData() });
    expect(draft.baseRevision).toBe(3);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({ code: "stale_revision" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1].baseRevision).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown commitment uncertain and reconciles without resending", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue(new TypeError("offline"));
    const lookup = vi
      .fn<PlanningTransport["lookup"]>()
      .mockResolvedValue({ status: "unknown", mutationId: "mutation-1" });
    const h = harness({ execute, read: vi.fn<PlanningTransport["read"]>(), lookup });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 8, canWrite: true, data: emptyAppData() });
    const draft = h.controller.begin({ timezone: "Etc/GMT" });
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({ uncertain: true });
    expect(h.state().planning.pending?.execution.mutationId).toBe("mutation-1");
    await h.controller.reconcile();
    expect(h.state().planning.status).toBe("uncertain");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(context, "mutation-1", expect.any(AbortSignal));
  });

  it.each([undefined, "request_timeout"])(
    "reconciles HTTP 408 (%s) without releasing or resending the original attempt",
    async (code) => {
      const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue({ status: 408, code });
      const lookup = vi
        .fn<PlanningTransport["lookup"]>()
        .mockResolvedValueOnce({ status: "unknown", mutationId: "mutation-1" })
        .mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 9 });
      const h = harness({ execute, read: vi.fn<PlanningTransport["read"]>(), lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 8, canWrite: true, data: emptyAppData() });
      await expect(h.controller.execute(h.controller.begin({}), intent, inverse)).rejects.toMatchObject({
        status: 408,
        uncertain: true,
      });
      const original = h.state().planning.pending?.execution;
      expect(original).toMatchObject({ mutationId: "mutation-1", baseRevision: 8 });
      expect(h.state().planning.outcome).toEqual({ kind: "uncertain", execution: original });
      expect(() => h.controller.begin({})).toThrow();
      await expect(h.controller.reconcile()).resolves.toBe(false);
      expect(h.state().planning.pending?.execution).toBe(original);
      expect(() => h.controller.begin({})).toThrow();
      await h.readSnapshot({ revision: 9, canWrite: true, data: emptyAppData() });
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning.status).toBe("ready");
      expect(h.state().planning.pending).toBeNull();
      expect(h.state().planning.history.past).toEqual([{ forward: intent, inverse }]);
      expect(execute).toHaveBeenCalledOnce();
      expect(lookup.mock.calls.map((call) => call[1])).toEqual(["mutation-1", "mutation-1"]);
    },
  );

  it("retains the existing fifty-action page-local history limit", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 0, canWrite: true, data: emptyAppData() });
    for (let index = 0; index < 51; index += 1) await h.controller.execute(h.controller.begin({}), intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) await expect(h.controller.undo()).resolves.toBe(true);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.state().planning.history.future).toHaveLength(50);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it("retains history for same-revision reads and clears it for external revisions", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    const draft = h.controller.begin({});
    await h.controller.execute(draft, intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 2, canWrite: true, data: emptyAppData() });
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 3, canWrite: true, data: emptyAppData() });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("ignores late reads from an invalidated client context and clears data/history atomically", async () => {
    let resolveRead!: (value: { revision: number; canWrite: boolean; data: AppData }) => void;
    const read = vi.fn<PlanningTransport["read"]>(
      () =>
        new Promise<{ revision: number; canWrite: boolean; data: AppData }>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const h = harness({
      execute: vi.fn<PlanningTransport["execute"]>(),
      read,
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    const readPromise = h.controller.refresh();
    h.controller.setContext(null);
    resolveRead({ revision: 9, canWrite: true, data: { ...emptyAppData(), accounts: [{ id: "leak" } as never] } });
    await readPromise;
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("keeps context and history for every 403 execute refusal, including membership loss", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ status: 403, code: "authorization_denied" })
      .mockRejectedValueOnce({ status: 403, code: "account_membership_lost" });
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    const first = h.controller.begin({});
    await expect(h.controller.execute(first, intent, inverse)).rejects.toMatchObject({ code: "authorization_denied" });
    expect(h.state().planning.context).toEqual(context);
    const second = h.controller.begin({});
    await expect(h.controller.execute(second, intent, inverse)).rejects.toMatchObject({
      code: "account_membership_lost",
    });
    expect(h.state().planning.context).toEqual(context);
    expect(h.state().planning).toMatchObject({ status: "refused", revision: 1 });
  });

  it("accepts a matching commitment after a read reaches the pending write revision, then clears history on a later external revision", async () => {
    let release!: (receipt: PlanningMutationSuccess) => void;
    const execute = vi.fn<PlanningTransport["execute"]>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    const draft = h.controller.begin({ timezone: "Etc/GMT" });
    const write = h.controller.execute(draft, intent, inverse);
    await h.readSnapshot({ revision: 2, canWrite: true, data: emptyAppData() });
    expect(h.state().planning.history.past).toHaveLength(0);
    release(success("mutation-1", 2));
    await write;
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 3, canWrite: true, data: emptyAppData() });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("uses the final submitted intent with the revision captured when the gesture began", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue({ status: 409, code: "stale_revision" });
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>().mockResolvedValue({ revision: 2, canWrite: true, data: emptyAppData() }),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    const gesture = h.controller.begin({ startDate: "2026-10-26", endDate: "2026-10-30" });
    await h.readSnapshot({ revision: 2, canWrite: true, data: emptyAppData() });
    const finalIntent = {
      operation: "settings.update",
      changes: { timezone: "Europe/Paris" },
    } as PlanningIntent;
    await expect(h.controller.execute(gesture, finalIntent, inverse)).rejects.toMatchObject({ code: "stale_revision" });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ baseRevision: 1, intent: finalIntent });
  });

  it("invalidates drafts and history when the canonical access projection changes", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData(), accessKey: "owner:private" });
    await h.controller.execute(h.controller.begin({}), intent, inverse);
    const draft = h.controller.begin({ captured: true });
    expect(h.state().planning.history.past).toHaveLength(1);
    await expect(
      h.readSnapshot({ revision: 2, canWrite: true, data: emptyAppData(), accessKey: "editor:public" }),
    ).resolves.toBe(true);
    expect(h.state().planning.history.past).toHaveLength(0);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("gives Undo and Redo fresh mutation ids and the current acknowledged revision", async () => {
    const executions: Array<{ mutationId: string; baseRevision: number }> = [];
    const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) => {
      executions.push({ mutationId: execution.mutationId, baseRevision: execution.baseRevision });
      return Promise.resolve(success(execution.mutationId, execution.baseRevision + 1));
    });
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    await h.controller.execute(h.controller.begin({}), intent, inverse);
    expect(await h.controller.undo()).toBe(true);
    expect(await h.controller.redo()).toBe(true);
    expect(executions.map(({ baseRevision }) => baseRevision)).toEqual([1, 2, 3]);
    expect(new Set(executions.map(({ mutationId }) => mutationId)).size).toBe(3);
    expect(h.state().planning.history.tipRevision).toBe(4);
  });

  it("does not add history for no_change and keeps the refusal distinct", async () => {
    const h = harness({
      execute: vi.fn<PlanningTransport["execute"]>().mockRejectedValue({ status: 400, code: "no_change" }),
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    await expect(h.controller.execute(h.controller.begin({}), intent, inverse)).rejects.toMatchObject({
      code: "no_change",
    });
    expect(h.state().planning.outcome).toMatchObject({ kind: "refused", code: "no_change" });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("keeps a committed lookup acknowledged when its canonical read fails and does not enable another write", async () => {
    const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue(new TypeError("offline"));
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: emptyAppData() })
      .mockRejectedValue(new TypeError("read unavailable"));
    const lookup = vi.fn<PlanningTransport["lookup"]>(async (_context, mutationId) => ({
      status: "committed",
      mutationId,
      revision: 2,
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin({});
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    expect(h.state().planning.status).toBe("error");
    expect(h.state().planning.pending).not.toBeNull();
    expect(() => h.controller.begin({})).toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ignores an old success after switching away and back to an otherwise identical context", async () => {
    let release!: (receipt: PlanningMutationSuccess) => void;
    const execute = vi.fn<PlanningTransport["execute"]>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    const anonymousIdentity = Symbol("anonymous");
    const anonymous = { identity: anonymousIdentity, companyId: "company-1" };
    h.controller.setContext(anonymous);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    const write = h.controller.execute(h.controller.begin({}), intent, inverse).catch(() => undefined);
    h.controller.setContext({ identity: anonymousIdentity, companyId: "company-2" });
    h.controller.setContext(anonymous);
    await h.readSnapshot({ revision: 7, canWrite: true, data: emptyAppData() });
    release(success("mutation-1", 2));
    await write;
    expect(h.state().planning.revision).toBe(7);
    expect(h.state().planning.outcome).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("copies client context so caller mutation cannot rebind the active company", () => {
    const h = harness({
      execute: vi.fn<PlanningTransport["execute"]>(),
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    const callerContext = { identity: "actor-1", companyId: "company-1" };
    h.controller.setContext(callerContext);
    callerContext.companyId = "company-2";
    expect(h.state().planning.context).toEqual({ identity: "actor-1", companyId: "company-1" });
  });

  it("drops the previous projection if an access change arrives with an older snapshot", async () => {
    const h = harness({
      execute: vi.fn<PlanningTransport["execute"]>(),
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    const cached = { ...emptyAppData(), accounts: [{ id: "company-1" } as never] };
    await expect(
      h.readSnapshot({ revision: 4, canWrite: true, data: cached, accessKey: "owner:private" }),
    ).resolves.toBe(true);
    expect(h.state().data.accounts).toHaveLength(1);
    await expect(
      h.readSnapshot({ revision: 3, canWrite: true, data: emptyAppData(), accessKey: "viewer:public" }),
    ).resolves.toBe(false);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.status).toBe("error");
  });

  it("does not create Undo for a committed delete lookup without its restoration handle", async () => {
    const deleteIntent = { operation: "allocation.deleteGroup", ids: ["allocation-1"] } as PlanningIntent;
    const restoreIntent = { operation: "planning.restoreGroup", restorationGroupId: "" } as PlanningIntent;
    const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue(new TypeError("offline"));
    const lookup = vi.fn<PlanningTransport["lookup"]>(async (_context, mutationId) => ({
      status: "committed",
      mutationId,
      revision: 2,
    }));
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: emptyAppData() })
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: emptyAppData() });
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin({});
    await expect(h.controller.execute(draft, deleteIntent, restoreIntent)).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it("keeps acknowledged writes locked until every operation receives a canonical refresh", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: emptyAppData() })
      .mockRejectedValueOnce(new TypeError("read unavailable"));
    const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, 2)),
    );
    const h = harness({ execute, read, lookup: vi.fn<PlanningTransport["lookup"]>() });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin({});
    await expect(h.controller.execute(draft, intent, inverse)).resolves.toMatchObject({ revision: 2 });
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    expect(h.state().planning.status).toBe("error");
    expect(h.state().planning.pending).not.toBeNull();
    expect(() => h.controller.begin({})).toThrow();
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses lookup after a duplicate-id 409 and recovers commitment from the base revision", async () => {
    const execute = vi
      .fn<PlanningTransport["execute"]>()
      .mockRejectedValue({ status: 409, code: "mutation_id_reused" });
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: emptyAppData() })
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: emptyAppData() });
    const lookup = vi.fn<PlanningTransport["lookup"]>(async (_context, mutationId) => ({
      status: "committed",
      mutationId,
      revision: 2,
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin({}), intent, inverse);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps a refresh scoped for every 403, including membership loss", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: emptyAppData() })
      .mockRejectedValueOnce({ status: 403, code: "authorization_denied" })
      .mockRejectedValueOnce({ status: 403, code: "account_membership_lost" });
    const h = harness({
      execute: vi.fn<PlanningTransport["execute"]>(),
      read,
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.refresh();
    expect(h.state().planning.context).toEqual(context);
    await h.controller.refresh();
    expect(h.state().planning.context).toEqual(context);
    expect(h.state().planning).toMatchObject({ status: "error", revision: 1 });
  });

  it("reconciles lost Undo and Redo responses with each fresh restoration handle", async () => {
    const create = {
      operation: "allocation.repeat",
      sourceAllocationId: "source-1",
      occurrences: [{ id: "group-1", startDate: "2026-10-21", endDate: "2026-10-21" }],
    } as PlanningIntent;
    const deleteIntent = { operation: "allocation.deleteGroup", ids: ["group-1"] } as PlanningIntent;
    const restore = (restorationGroupId: string) =>
      ({ operation: "planning.restoreGroup", restorationGroupId }) as PlanningIntent;
    const execute = vi
      .fn<PlanningTransport["execute"]>()
      .mockResolvedValueOnce(success("mutation-1", 2))
      .mockRejectedValue(new TypeError("offline"));
    const lookup = vi.fn<PlanningTransport["lookup"]>(async (_context, mutationId) => ({
      status: "committed",
      mutationId,
      revision: Number(mutationId.slice(-1)) + 1,
      ...(mutationId === "mutation-2"
        ? { restorationGroupId: "restore-undo" }
        : mutationId === "mutation-4"
          ? { restorationGroupId: "restore-redo" }
          : {}),
    }));
    let revision = 0;
    const read = vi.fn<PlanningTransport["read"]>(async () => ({
      revision: ++revision,
      canWrite: true,
      data: emptyAppData(),
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin({}), create, deleteIntent);

    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(restore("restore-undo"));

    await expect(h.controller.redo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.past.at(-1)?.forward).toEqual(restore("restore-undo"));
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual(deleteIntent);

    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(restore("restore-redo"));
    expect(execute.mock.calls.map(([, execution]) => execution.baseRevision)).toEqual([1, 2, 3, 4]);
    expect(new Set(execute.mock.calls.map(([, execution]) => execution.mutationId)).size).toBe(4);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function uncertainHarness() {
  const execute = vi.fn<PlanningTransport["execute"]>().mockRejectedValue(new TypeError("response lost"));
  const read = vi
    .fn<PlanningTransport["read"]>()
    .mockResolvedValue({ revision: 2, canWrite: true, data: emptyAppData(), accessKey: "owner" });
  const lookup = vi.fn<PlanningTransport["lookup"]>();
  const h = harness({ execute, read, lookup });
  h.controller.setContext(context);
  await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData(), accessKey: "owner" });
  await expect(h.controller.execute(h.controller.begin({}), intent, inverse)).rejects.toMatchObject({
    uncertain: true,
  });
  return { ...h, read, lookup };
}

describe("planning reconciliation races", () => {
  it("ignores an older lookup failure after a newer reconciliation completed", async () => {
    const h = await uncertainHarness();
    const old = deferred<Awaited<ReturnType<PlanningTransport["lookup"]>>>();
    h.lookup
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 2 });
    const first = h.controller.reconcile();
    await h.controller.reconcile();
    old.reject(new TypeError("old lookup failed"));
    await first;
    expect(h.state().planning.status).toBe("ready");
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.error).toBeNull();
  });

  it("keeps unknown commitment reconcilable after a focus read fails", async () => {
    const h = await uncertainHarness();
    h.read.mockRejectedValueOnce(new TypeError("focus read failed"));
    await h.controller.refresh();
    h.lookup.mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 2 });
    await h.controller.reconcile();
    expect(h.lookup).toHaveBeenCalledOnce();
    expect(h.state().planning.status).toBe("ready");
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it("preserves commitment proof and history when a focus read supersedes the reconciliation read", async () => {
    const h = await uncertainHarness();
    const delayedRead = deferred<PlanningSnapshot>();
    h.lookup.mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 2 });
    h.read.mockImplementationOnce(() => delayedRead.promise);
    const reconciliation = h.controller.reconcile();
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    await h.controller.refresh();
    delayedRead.reject(new TypeError("superseded read failed"));
    await reconciliation;
    expect(h.state().planning.status).toBe("ready");
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.error).toBeNull();
  });

  it("drops confidential cached rows when reconciliation reads an older changed authority", async () => {
    const h = await uncertainHarness();
    await h.readSnapshot({
      revision: 3,
      canWrite: true,
      data: { ...emptyAppData(), accounts: [{ id: "company-1", name: "Wayne confidential" } as never] },
      accessKey: "owner",
    });
    h.lookup.mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 2 });
    h.read.mockResolvedValueOnce({ revision: 2, canWrite: true, data: emptyAppData(), accessKey: "editor" });
    await h.controller.reconcile();
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.status).toBe("error");
  });

  it.each([
    {},
    { revision: 2, canWrite: true, data: { ...emptyAppData(), accounts: [{ id: "other-company" }] } },
    { revision: 3, data: { ...emptyAppData(), accounts: [{ id: "company-1", name: "Unverified" }] } },
  ])("surfaces invalid canonical reads instead of remaining loading: %j", async (snapshot) => {
    const read = vi.fn<PlanningTransport["read"]>().mockResolvedValue(snapshot as PlanningSnapshot);
    const h = harness({ execute: vi.fn(), lookup: vi.fn(), read });
    h.controller.setContext(context);
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.status).toBe("error");
    expect(h.state().planning.error).toBeInstanceOf(Error);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.canWrite).toBe(false);
    expect(h.state().planning.history.past).toHaveLength(0);
    expect(() => h.controller.begin({})).toThrow(/read-only/);
  });

  it.each([
    { operation: "settings.update", changes: { timezone: "Europe/London" } },
    { operation: "catalogue.update", entity: { entity: "clients", id: "client-1", changes: { codeName: "Wayne" } } },
    {
      operation: "catalogue.update",
      entity: { entity: "activities", id: "activity-1", changes: { kind: "internal" } },
    },
  ] as PlanningIntent[])("clears history for a lookup-proven projection change: %j", async (action) => {
    const h = await uncertainHarness();
    // Start a distinct operation so its submitted intent drives lookup eligibility.
    h.controller.setContext(null);
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    await expect(h.controller.execute(h.controller.begin({}), action, inverse)).rejects.toMatchObject({
      uncertain: true,
    });
    h.lookup.mockResolvedValueOnce({ status: "committed", mutationId: "mutation-2", revision: 2 });
    await h.controller.reconcile();
    expect(h.state().planning.history.past).toHaveLength(0);
  });
});

describe("planning lookup history boundaries", () => {
  it("preserves Redo after a lost restore acknowledgement without a replacement handle", async () => {
    const remove: PlanningIntent = { operation: "allocation.deleteGroup", ids: ["allocation-1"] };
    const restore: PlanningIntent = { operation: "planning.restoreGroup", restorationGroupId: "group-1" };
    const execute = vi
      .fn<PlanningTransport["execute"]>()
      .mockResolvedValueOnce({
        ...success("mutation-1", 2),
        restoration: { consumedGroupId: null, replacementGroupId: "group-1" },
      })
      .mockRejectedValueOnce(new TypeError("restore response lost"))
      .mockResolvedValueOnce({
        ...success("mutation-3", 4),
        restoration: { consumedGroupId: null, replacementGroupId: "group-2" },
      });
    const read = vi
      .fn<PlanningTransport["read"]>()
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: emptyAppData() })
      .mockResolvedValueOnce({ revision: 3, canWrite: true, data: emptyAppData() })
      .mockResolvedValueOnce({ revision: 4, canWrite: true, data: emptyAppData() });
    const lookup = vi
      .fn<PlanningTransport["lookup"]>()
      .mockResolvedValueOnce({ status: "committed", mutationId: "mutation-2", revision: 3 });
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    await h.controller.execute(h.controller.begin({}), remove, restore);
    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(remove);
    expect(await h.controller.redo()).toBe(true);
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual({
      operation: "planning.restoreGroup",
      restorationGroupId: "group-2",
    });
    expect(execute.mock.calls.map(([, execution]) => execution.mutationId)).toEqual([
      "mutation-1",
      "mutation-2",
      "mutation-3",
    ]);
    expect(execute.mock.calls.map(([, execution]) => execution.baseRevision)).toEqual([1, 2, 3]);
  });

  it("accepts lookup proof that arrives after an overlapping canonical refresh", async () => {
    const h = await uncertainHarness();
    const delayed = deferred<Awaited<ReturnType<PlanningTransport["lookup"]>>>();
    h.lookup.mockImplementationOnce(() => delayed.promise);
    const reconcile = h.controller.reconcile();
    await h.controller.refresh();
    delayed.resolve({ status: "committed", mutationId: "mutation-1", revision: 2 });
    await reconcile;
    expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision: 2 });
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it("retries only the canonical read after proven commitment and a failed read", async () => {
    const h = await uncertainHarness();
    h.lookup.mockResolvedValueOnce({ status: "committed", mutationId: "mutation-1", revision: 2 });
    h.read.mockRejectedValueOnce(new TypeError("read failed"));
    await h.controller.reconcile();
    expect(h.state().planning.pending?.commitment?.revision).toBe(2);
    await h.controller.reconcile();
    expect(h.lookup).toHaveBeenCalledOnce();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.pending).toBeNull();
  });
});

describe.each(["receipt", "lookup"] as const)("planning %s completion context", (proof) => {
  for (const action of ["execute", "undo", "redo"] as const) {
    it.each(["sign-out", "company switch", "authority change"] as const)(
      `suppresses ${action} completion after %s during the acknowledged read`,
      async (change) => {
        const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
          Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
        );
        const read = vi.fn<PlanningTransport["read"]>();
        const lookup = vi.fn<PlanningTransport["lookup"]>();
        const h = harness({ execute, read, lookup });
        h.controller.setContext(context);
        await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData(), accessKey: "owner" });
        await h.controller.execute(h.controller.begin({}), intent, inverse);
        if (action === "redo") await h.controller.undo();
        const baseRevision = h.state().planning.revision;
        if (baseRevision === null) throw new Error("Expected an initialized planning revision.");
        const revision = baseRevision + 1;
        const delayed = deferred<PlanningSnapshot>();
        read.mockImplementationOnce(() => delayed.promise);
        if (proof === "lookup") {
          execute.mockRejectedValueOnce({ status: 409, code: "mutation_id_reused" });
          lookup.mockImplementationOnce(async (_context, mutationId) => ({
            status: "committed",
            mutationId,
            revision,
          }));
        }
        const completion =
          action === "execute" ? h.controller.execute(h.controller.begin({}), intent, inverse) : h.controller[action]();
        await vi.waitFor(() => expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision }));
        if (change === "sign-out") h.controller.setContext(null);
        if (change === "company switch") h.controller.setContext({ ...context, companyId: "company-2" });
        delayed.resolve({
          revision,
          canWrite: true,
          data: emptyAppData(),
          accessKey: change === "authority change" ? "editor" : "owner",
        });
        await expect(completion).resolves.toBe(action === "execute" ? null : false);
        expect(h.state().planning.pending).toBeNull();
        expect(h.state().planning.history.past).toEqual([]);
        expect(h.state().planning.history.future).toEqual([]);
        expect(h.state().planning.outcome).toBeNull();
        expect(h.state().planning.error).toBeNull();
        expect(execute).toHaveBeenCalledTimes(action === "redo" ? 3 : 2);
      },
    );
  }
});

describe("planning commitment-only completion", () => {
  it.each(["execute", "undo", "redo"] as const)(
    "keeps %s acknowledged and locked after lookup proof followed by a failed read",
    async (action) => {
      const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
        Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
      );
      const read = vi.fn<PlanningTransport["read"]>();
      const lookup = vi.fn<PlanningTransport["lookup"]>();
      const h = harness({ execute, read, lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
      await h.controller.execute(h.controller.begin({}), intent, inverse);
      if (action === "redo") await h.controller.undo();
      const baseRevision = h.state().planning.revision;
      if (baseRevision === null) throw new Error("Expected an initialized planning revision.");
      const revision = baseRevision + 1;
      execute.mockRejectedValueOnce({ status: 409, code: "mutation_id_reused" });
      lookup.mockImplementationOnce(async (_context, mutationId) => ({ status: "committed", mutationId, revision }));
      read.mockRejectedValueOnce(new TypeError("read unavailable"));
      const completion =
        action === "execute" ? h.controller.execute(h.controller.begin({}), intent, inverse) : h.controller[action]();
      await expect(completion).resolves.toBe(action === "execute" ? null : true);
      expect(h.state().planning.outcome).toMatchObject({ kind: "acknowledged", revision });
      expect(h.state().planning.pending?.commitment?.revision).toBe(revision);
      expect(h.state().planning.status).toBe("error");
      expect(() => h.controller.begin({})).toThrow();
      read.mockResolvedValueOnce({ revision, canWrite: true, data: emptyAppData() });
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning.pending).toBeNull();
      expect(h.state().planning.status).toBe("ready");
      expect(lookup).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledTimes(action === "redo" ? 3 : 2);
    },
  );

  it("keeps a reused mutation uncertain when lookup has no commitment proof", async () => {
    const execute = vi
      .fn<PlanningTransport["execute"]>()
      .mockRejectedValue({ status: 409, code: "mutation_id_reused" });
    const lookup = vi.fn<PlanningTransport["lookup"]>(async (_context, mutationId) => ({
      status: "unknown",
      mutationId,
    }));
    const h = harness({ execute, lookup, read: vi.fn<PlanningTransport["read"]>() });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
    await expect(h.controller.execute(h.controller.begin({}), intent, inverse)).rejects.toMatchObject({
      uncertain: true,
    });
    expect(h.state().planning.outcome?.kind).toBe("uncertain");
    expect(h.state().planning.pending?.commitment).toBeUndefined();
    expect(() => h.controller.begin({})).toThrow();
    expect(execute).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
  });
});

describe.each(["receipt", "lookup"] as const)("planning activity history via %s", (proof) => {
  it.each([true, false])(
    "applies the kind-present=%s boundary to existing past and future history",
    async (includesKind) => {
      const execute = vi.fn<PlanningTransport["execute"]>((_context, execution) =>
        Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
      );
      const read = vi.fn<PlanningTransport["read"]>();
      const lookup = vi.fn<PlanningTransport["lookup"]>();
      const h = harness({ execute, read, lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: emptyAppData() });
      await h.controller.execute(h.controller.begin({}), intent, inverse);
      await h.controller.execute(h.controller.begin({}), intent, inverse);
      await h.controller.undo();
      expect(h.state().planning.history.past).toHaveLength(1);
      expect(h.state().planning.history.future).toHaveLength(1);
      const changes = { name: "Facilities", ...(includesKind ? { kind: "internal" as const } : {}) };
      const update: PlanningIntent = {
        operation: "catalogue.update",
        entity: { entity: "activities", id: "activity-1", changes },
      };
      const reverse: PlanningIntent = {
        operation: "catalogue.update",
        entity: { entity: "activities", id: "activity-1", changes: { ...changes, name: "Office" } },
      };
      read.mockResolvedValueOnce({ revision: 5, canWrite: true, data: emptyAppData() });
      if (proof === "lookup") {
        execute.mockRejectedValueOnce(new TypeError("response lost"));
        lookup.mockImplementationOnce(async (_context, mutationId) => ({
          status: "committed",
          mutationId,
          revision: 5,
        }));
        await expect(
          h.controller.execute(h.controller.begin({ name: "Office", kind: "internal" }), update, reverse),
        ).rejects.toMatchObject({ uncertain: true });
        await h.controller.reconcile();
      } else {
        execute.mockImplementationOnce(async (_context, execution) => ({
          ...success(execution.mutationId, 5),
          ...(includesKind ? { projection: { mode: "refetch" as const, history: "clear" as const } } : {}),
        }));
        await h.controller.execute(h.controller.begin({ name: "Office", kind: "internal" }), update, reverse);
      }
      expect(h.state().planning.history.past).toEqual(
        includesKind
          ? []
          : [
              { forward: intent, inverse },
              { forward: update, inverse: reverse },
            ],
      );
      expect(h.state().planning.history.future).toEqual([]);
      expect(h.state().planning.history.tipRevision).toBe(includesKind ? null : 5);
      expect(execute).toHaveBeenCalledTimes(4);
      expect(lookup).toHaveBeenCalledTimes(proof === "lookup" ? 1 : 0);
    },
  );
});

describe("canonical planning write capability", () => {
  it("clears acknowledged history and invalidates drafts when the read becomes read-only", async () => {
    const execute = vi
      .fn<PlanningTransport["execute"]>()
      .mockImplementation(async (_context, execution) => success(execution.mutationId, execution.baseRevision + 1));
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport["read"]>(),
      lookup: vi.fn<PlanningTransport["lookup"]>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 0, canWrite: true, data: emptyAppData() });
    await h.controller.execute(h.controller.begin({}), intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(1);
    const draft = h.controller.begin({});
    await h.readSnapshot({ revision: 1, canWrite: false, data: emptyAppData() });
    expect(h.state().planning.history.past).toHaveLength(0);
    expect(() => h.controller.begin({})).toThrow(/read-only/);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
