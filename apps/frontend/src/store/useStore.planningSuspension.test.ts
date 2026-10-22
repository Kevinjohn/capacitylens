import { beforeEach, describe, expect, it } from "vitest";
import { makeAccount, makeResourceDraft, resetStoreWithAccount } from "@/test/fixtures";
import { requireCreated } from "@/test/requireCreated";
import { useStore } from "./useStore";

beforeEach(async () => {
  await resetStoreWithAccount();
});

describe("planning command suspension", () => {
  it("blocks a typed send, undo, and redo until its idempotent release", async () => {
    const resource = await requireCreated(useStore.getState().addResource(makeResourceDraft()));
    const activity = await requireCreated(useStore.getState().addActivity({ name: "Operations", kind: "internal" }));
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    const release = useStore.getState().suspendPlanningCommands();
    if (!release) throw new Error("The ready planning view did not acquire its replacement lock.");
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    expect(useStore.getState().suspendPlanningCommands()).toBeNull();

    await expect(useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-03" })).rejects.toThrow(
      /suspended/,
    );
    await expect(useStore.getState().undoPlanning()).resolves.toBe(false);
    await expect(useStore.getState().redoPlanning()).resolves.toBe(false);
    expect(useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.endDate).toBe("2026-06-02");

    release();
    release();
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
  });

  it("does not let an old company release unlock a later context incarnation", async () => {
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeAccount({ id: "a2" })],
    });
    const releaseA = useStore.getState().suspendPlanningCommands();
    if (!releaseA) throw new Error("Company A did not acquire its replacement lock.");
    useStore.getState().setActiveAccount("a2");
    await useStore.getState().refreshPlanning();
    const releaseB = useStore.getState().suspendPlanningCommands();
    if (!releaseB) throw new Error("Company B did not acquire its replacement lock.");
    releaseA();
    await expect(
      useStore.getState().sendPlanningCommand({
        intent: { operation: "allocation.deleteGroup", ids: [] },
        inverse: null,
      }),
    ).rejects.toThrow(/suspended/);
    releaseB();
    useStore.getState().setActiveAccount("acct-test");
    await useStore.getState().refreshPlanning();
    const releaseSecondA = useStore.getState().suspendPlanningCommands();
    if (!releaseSecondA) throw new Error("The new company A incarnation did not acquire its lock.");
    releaseA();
    await expect(
      useStore.getState().sendPlanningCommand({
        intent: { operation: "allocation.deleteGroup", ids: [] },
        inverse: null,
      }),
    ).rejects.toThrow(/suspended/);
    releaseSecondA();
  });

  it("retires a demo company lock across picker selection without erasing other demo companies", async () => {
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeAccount({ id: "a2" })],
    });
    const releaseOldA = useStore.getState().suspendPlanningCommands();
    if (!releaseOldA) throw new Error("The first company A context was not ready.");
    useStore.getState().setActiveAccount(null);
    expect(useStore.getState().planning.context).toBeNull();
    expect(useStore.getState().data.accounts.map((account) => account.id)).toEqual(["acct-test", "a2"]);

    useStore.getState().setActiveAccount("acct-test");
    await useStore.getState().refreshPlanning();
    const releaseNewA = useStore.getState().suspendPlanningCommands();
    if (!releaseNewA) throw new Error("The re-entered company A context was not ready.");
    releaseOldA();
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    releaseNewA();
    expect(useStore.getState().planningReadyForReplacement()).toBe(true);
  });

  it("refuses replacement until the canonical view is ready and resolved", () => {
    expect(useStore.getState().planningReadyForReplacement()).toBe(true);
    useStore.setState((state) => ({ planning: { ...state.planning, status: "loading" } }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    useStore.setState((state) => ({ planning: { ...state.planning, status: "ready", pending: null, revision: null } }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
  });

  it("can claim an unsettled selected context for authority recovery without permitting an ordinary replacement", () => {
    useStore.setState((state) => ({
      planning: { ...state.planning, status: "error", revision: null },
    }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    const releaseRecovery = useStore.getState().suspendPlanningCommands();
    if (!releaseRecovery) throw new Error("The unsettled selected context could not be claimed for recovery.");
    expect(useStore.getState().suspendPlanningCommands()).toBeNull();
    releaseRecovery();
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
  });

  it("refuses authority recovery while a typed mutation remains unresolved", () => {
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        status: "uncertain",
        pending: {
          execution: {
            mutationId: "pending-mutation",
            baseRevision: state.planning.revision ?? 0,
            intent: { operation: "allocation.deleteGroup", ids: [] },
          },
          inverse: null,
          historyEntry: null,
          originalWritable: state.data,
          kind: "new",
        },
      },
    }));

    expect(useStore.getState().suspendPlanningCommands()).toBeNull();
  });

  it("clears private planning rows even when the controller context is already null", () => {
    useStore.getState().clearPlanning();
    useStore.setState((state) => ({
      data: { ...state.data, accounts: [makeAccount()] },
      accountSummaries: [{ id: "acct-test", name: "Test Co", role: "owner" }],
    }));
    expect(useStore.getState().planning.context).toBeNull();

    useStore.getState().clearPlanning();

    expect(useStore.getState().data.accounts).toEqual([]);
    expect(useStore.getState().accountSummaries).toEqual([]);
  });
});
