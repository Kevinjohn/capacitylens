import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { makeAccount, makeAppData, makeClient } from "@/test/fixtures";
import {
  createPlanningCacheController,
  createPlanningCacheState,
  PlanningControllerError,
} from "./planningCacheController";
import type { PlanningSnapshot, PlanningTransport } from "./planningCacheController";

type RequestStage = "read" | "execute" | "lookup";
type Success = Awaited<ReturnType<PlanningTransport["execute"]>>;

const context = { identity: "bruce-session-1", companyId: "wayne" };
const update = { operation: "allocation.update", id: "allocation-1", changes: { startDate: "2026-10-21" } } as const;
const inverse = { operation: "allocation.update", id: "allocation-1", changes: { startDate: "2026-10-20" } } as const;

function snapshot(name: string, revision = 1): PlanningSnapshot {
  return {
    revision,
    accessKey: "owner",
    data: makeAppData({
      accounts: [makeAccount({ id: "wayne", name: "Wayne Enterprises" })],
      clients: [makeClient({ accountId: "wayne", name })],
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function setup() {
  const store = createStore(() => createPlanningCacheState());
  const read = vi.fn<PlanningTransport["read"]>().mockResolvedValue(snapshot("Wayne Enterprises"));
  const execute = vi.fn<PlanningTransport["execute"]>();
  const lookup = vi.fn<PlanningTransport["lookup"]>();
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, lookup },
  });
  controller.setContext(context);
  await controller.refresh();
  store.setState((state) => ({
    planning: { ...state.planning, history: { past: [{ forward: update, inverse }], future: [], tipRevision: 1 } },
  }));
  return { store, controller, read, execute, lookup };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function startRequest(fixture: Fixture, stage: RequestStage): Promise<unknown> {
  if (stage === "read") return fixture.controller.refresh();
  if (stage === "execute")
    return fixture.controller.execute(fixture.controller.begin({ startDate: "2026-10-20" }), update, inverse);
  fixture.execute.mockRejectedValueOnce(new TypeError("Response lost"));
  await fixture.controller
    .execute(fixture.controller.begin({ startDate: "2026-10-20" }), update, inverse)
    .catch((error: unknown) => error);
  return fixture.controller.reconcile();
}

function rejectStage(fixture: Fixture, stage: RequestStage, error: Error) {
  if (stage === "read") fixture.read.mockRejectedValueOnce(error);
  else if (stage === "execute") fixture.execute.mockRejectedValueOnce(error);
  else fixture.lookup.mockRejectedValueOnce(error);
}

describe("planning request access boundaries", () => {
  for (const stage of ["read", "execute", "lookup"] as const) {
    for (const loss of [
      { status: 401, code: undefined },
      { status: 403, code: "account_membership_lost" },
    ]) {
      it(`clears rows, history and pending state atomically after ${stage} reports ${loss.status}/${loss.code ?? "session"}`, async () => {
        const fixture = await setup();
        const publications: boolean[] = [];
        fixture.store.subscribe((state) => {
          if (state.planning.context === null)
            publications.push(
              state.data.clients.length === 0 &&
                state.planning.history.past.length === 0 &&
                state.planning.history.future.length === 0 &&
                state.planning.pending === null,
            );
        });
        rejectStage(fixture, stage, new PlanningControllerError("Access ended", loss.code, loss.status));
        await startRequest(fixture, stage).catch((error: unknown) => error);
        expect(fixture.store.getState().planning.context).toBeNull();
        expect(fixture.store.getState().data.clients).toEqual([]);
        expect(publications).toEqual([true]);
      });
    }

    it(`keeps readable rows for an ordinary refusal from ${stage}`, async () => {
      const fixture = await setup();
      rejectStage(fixture, stage, new PlanningControllerError("Action refused", "authorization_denied", 403));
      await startRequest(fixture, stage).catch((error: unknown) => error);
      expect(fixture.store.getState().planning.context).toEqual(context);
      expect(fixture.store.getState().data.clients[0]?.name).toBe("Wayne Enterprises");
    });

    it(`ignores a delayed ${stage} access-loss error after a new context has loaded`, async () => {
      const fixture = await setup();
      const pending = deferred<never>();
      if (stage === "read") fixture.read.mockImplementationOnce(() => pending.promise);
      else if (stage === "execute") fixture.execute.mockImplementationOnce(() => pending.promise);
      else fixture.lookup.mockImplementationOnce(() => pending.promise);
      const oldRequest = startRequest(fixture, stage).catch((error: unknown) => error);
      // Lookup begins only after the lost execution has been classified.
      if (stage === "lookup") await vi.waitFor(() => expect(fixture.lookup).toHaveBeenCalledOnce());
      fixture.controller.setContext({ ...context, identity: "diana-session-2" });
      fixture.read.mockResolvedValueOnce({ ...snapshot("Gotham", 2), accessKey: "editor" });
      await fixture.controller.refresh();
      pending.reject(new PlanningControllerError("Previous session ended", undefined, 401));
      await oldRequest;
      expect(fixture.store.getState().planning.context?.identity).toBe("diana-session-2");
      expect(fixture.store.getState().data.clients[0]?.name).toBe("Gotham");
      expect(fixture.store.getState().planning.error).toBeNull();
    });
  }

  it("rejects an old mutation response after canonical authority changes inside the same company", async () => {
    const fixture = await setup();
    const pending = deferred<Success>();
    fixture.execute.mockImplementationOnce(() => pending.promise);
    const draft = fixture.controller.begin({ startDate: "2026-10-20" });
    const oldRequest = fixture.controller.execute(draft, update, inverse).catch((error: unknown) => error);
    const execution = fixture.store.getState().planning.pending?.execution;
    expect(execution).toBeDefined();
    fixture.read.mockResolvedValueOnce({ ...snapshot("Gotham", 2), accessKey: "editor" });
    await fixture.controller.refresh();
    pending.resolve({
      status: "committed",
      mutationId: execution?.mutationId ?? "missing",
      revision: 2,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: {
        mode: "patch",
        history: "retain",
        changed: {
          upserts: [{ entity: "clients", row: makeClient({ accountId: "wayne", name: "Wayne Enterprises" }) }],
          removed: [],
        },
      },
    });
    await oldRequest;
    expect(fixture.store.getState().data.clients[0]?.name).toBe("Gotham");
    expect(fixture.store.getState().planning.history.past).toEqual([]);
    expect(fixture.store.getState().planning.pending).toBeNull();
    await expect(fixture.controller.execute(draft, update, inverse)).rejects.toThrow(/context/i);
  });

  it("applies the server's canonical patch before a delayed post-write read finishes", async () => {
    const fixture = await setup();
    const canonicalRead = deferred<PlanningSnapshot>();
    fixture.read.mockImplementationOnce(() => canonicalRead.promise);
    fixture.execute.mockImplementationOnce(async (...parameters) => ({
      status: "committed",
      mutationId: parameters[1].mutationId,
      revision: 2,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: {
        mode: "patch",
        history: "retain",
        changed: {
          upserts: [{ entity: "clients", row: makeClient({ accountId: "wayne", name: "Ferris Aircraft" }) }],
          removed: [],
        },
      },
    }));
    const saving = fixture.controller.execute(fixture.controller.begin({ startDate: "2026-10-20" }), update, null);
    await vi.waitFor(() => expect(fixture.store.getState().planning.outcome?.kind).toBe("acknowledged"));
    expect(fixture.store.getState().data.clients[0]?.name).toBe("Ferris Aircraft");
    expect(fixture.store.getState().planning.pending).not.toBeNull();
    canonicalRead.resolve(snapshot("Ferris Aircraft", 2));
    await saving;
    expect(fixture.store.getState().planning.pending).toBeNull();
    expect(fixture.store.getState().planning.status).toBe("ready");
  });
});
