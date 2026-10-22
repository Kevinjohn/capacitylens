import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "@capacitylens/shared/types/entities";
import { PlanningControllerError, readPlanningProblem } from "@/data/planning/planningCacheController";
import { attachPersistence, flushPendingWrites } from "@/data/persist";
import { useStore } from "@/store/useStore";
import { makeAccount, makeResourceDraft, resetStoreWithAccount } from "@/test/fixtures";
import { requireCreated } from "@/test/requireCreated";

// Lets a test make the planning transport fail like the server would, over the demo transport.
const failure = vi.hoisted(() => ({ read: null as Error | null, execute: null as Error | null }));
const lookups = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/data/planning/volatilePlanningTransport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/planning/volatilePlanningTransport")>();
  return {
    ...actual,
    createStorePlanningTransport: (readData: () => AppData) => {
      const transport = actual.createVolatilePlanningTransport(readData);
      return {
        ...transport,
        read: (...args: Parameters<typeof transport.read>) =>
          failure.read ? Promise.reject(failure.read) : transport.read(...args),
        execute: (...args: Parameters<typeof transport.execute>) =>
          failure.execute ? Promise.reject(failure.execute) : transport.execute(...args),
        lookup: (...args: Parameters<typeof transport.lookup>) => {
          lookups.count += 1;
          return transport.lookup(...args);
        },
      };
    },
  };
});

async function seedTypedAllocation() {
  const resource = await requireCreated(useStore.getState().addResource(makeResourceDraft()));
  const activity = await requireCreated(useStore.getState().addActivity({ name: "Operations", kind: "internal" }));
  return requireCreated(
    await useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: activity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    }),
  );
}

beforeEach(async () => {
  failure.read = null;
  failure.execute = null;
  await resetStoreWithAccount();
});

afterEach(() => {
  failure.read = null;
  failure.execute = null;
});

describe("planning authority publication", () => {
  it("clears the cache and both histories together when authentication is lost, without legacy deletes", async () => {
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => useStore.getState().data, saveAll },
      debounceMs: 0,
    });
    try {
      const client = await requireCreated(
        useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" }),
      );
      useStore.getState().archiveEntity("clients", client.id);
      useStore.getState().unarchiveEntity("clients", client.id);
      useStore.getState().undo();
      expect(await flushPendingWrites()).toEqual({ kind: "clean" });
      expect(useStore.getState().past).toHaveLength(1);
      expect(useStore.getState().future).toHaveLength(1);
      await seedTypedAllocation();
      expect(useStore.getState().planning.history.past).toHaveLength(3);
      await useStore.getState().undoPlanning();
      expect(useStore.getState().planning.history.past).toHaveLength(2);
      expect(useStore.getState().planning.history.future).toHaveLength(1);
      expect(useStore.getState().past).toHaveLength(1);
      expect(useStore.getState().future).toHaveLength(1);
      const savesBeforeLoss = saveAll.mock.calls.length;

      failure.read = new PlanningControllerError("Sign in again.", "unauthenticated", 401);
      await useStore.getState().refreshPlanning();

      const state = useStore.getState();
      expect(state.data.allocations).toEqual([]);
      expect(state.data.clients).toEqual([]);
      expect(state.data.resources).toEqual([]);
      expect(state.past).toEqual([]);
      expect(state.future).toEqual([]);
      expect(state.planning.history.past).toEqual([]);
      expect(state.planning.history.future).toEqual([]);
      expect(state.planning.context).toBeNull();
      expect(state.activeAccountId).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(saveAll).toHaveBeenCalledTimes(savesBeforeLoss);
    } finally {
      detach();
    }
  });

  it("keeps rows and history and shows a refusal when a change loses company membership", async () => {
    const allocation = await seedTypedAllocation();
    const data = useStore.getState().data;
    const legacyPast = useStore.getState().past;
    const planningPast = useStore.getState().planning.history.past;
    failure.execute = new PlanningControllerError(
      "You no longer belong to this company.",
      "account_membership_lost",
      403,
    );

    await expect(useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-03" })).rejects.toThrow(
      "You no longer belong to this company.",
    );

    const state = useStore.getState();
    expect(state.data).toBe(data);
    expect(state.past).toBe(legacyPast);
    expect(state.planning.history.past).toBe(planningPast);
    expect(state.planning.context).not.toBeNull();
    expect(state.activeAccountId).not.toBeNull();
    expect(readPlanningProblem(state.planning)).toBe("refused");
  });

  it("settles an uncertain write through its commitment lookup on the next refresh", async () => {
    const allocation = await seedTypedAllocation();
    failure.execute = new TypeError("response lost");
    await expect(useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-03" })).rejects.toThrow(
      "response lost",
    );
    expect(useStore.getState().planning.status).toBe("uncertain");
    failure.execute = null;
    lookups.count = 0;

    await useStore.getState().refreshPlanning();

    expect(lookups.count).toBe(1);
  });
});

describe("planning ownership of allocations", () => {
  it("keeps other companies' allocations once when a typed receipt updates the active company", async () => {
    const active = await seedTypedAllocation();
    const other = { ...active, id: "allocation-other-company", accountId: "a2" };
    useStore.setState((state) => ({
      data: {
        ...state.data,
        accounts: [...state.data.accounts, makeAccount({ id: "a2" })],
        allocations: [...state.data.allocations, other],
      },
    }));

    await useStore.getState().updateAllocation(active.id, { endDate: "2026-06-05" });

    const allocations = useStore.getState().data.allocations;
    expect(allocations.filter((row) => row.id === other.id)).toEqual([other]);
    expect(allocations.find((row) => row.id === active.id)?.endDate).toBe("2026-06-05");
  });

  it("opens the planning context for a company as soon as it becomes active", async () => {
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeAccount({ id: "a2" })],
    });

    useStore.getState().setActiveAccount("a2");

    expect(useStore.getState().planning.context?.companyId).toBe("a2");
    await vi.waitFor(() => expect(useStore.getState().planning.status).toBe("ready"));
  });

  it("undoes the latest typed allocation edit without removing a preceding catalogue change", async () => {
    const allocation = await seedTypedAllocation();
    const client = await requireCreated(useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" }));
    await useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-05" });

    await useStore.getState().undoPlanning();

    expect(useStore.getState().data.clients.find((row) => row.id === client.id)).toEqual(client);
    expect(useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.endDate).toBe(
      allocation.endDate,
    );
  });
});
