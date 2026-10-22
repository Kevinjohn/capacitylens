import { beforeEach, describe, expect, it } from "vitest";
import { lifecycleStatus } from "@capacitylens/shared/domain/lifecycle";
import {
  DEFAULT_ACCOUNT_ID,
  makeAllocation,
  makeAppData,
  makeResource,
  makeTimeOff,
  requireValue,
  resetStoreWithAccount,
} from "@/test/fixtures";
import { useStore } from "./useStore";

const accountId = DEFAULT_ACCOUNT_ID;
const s = () => useStore.getState();

beforeEach(async () => {
  await resetStoreWithAccount();
});

describe("volatile lifecycle", () => {
  it("archives and restores the same resource without removing it", () => {
    const resource = makeResource({ id: "r-lifecycle", accountId, name: "Diana Prince" });
    s().replaceAll(makeAppData({ resources: [resource] }));
    s().setActiveAccount(accountId);
    s().archiveEntity("resources", resource.id);
    expect(lifecycleStatus(requireValue(s().data.resources[0], "archived resource"))).toBe("archived");
    s().unarchiveEntity("resources", resource.id);
    expect(lifecycleStatus(requireValue(s().data.resources[0], "restored resource"))).toBe("active");
    expect(s().data.resources).toHaveLength(1);
  });

  it("anonymises a resource and dependent notes while clearing local undo history", async () => {
    const resource = makeResource({
      id: "r-lifecycle",
      accountId,
      name: "Diana Prince",
      role: "Designer",
      avatarUrl: "https://images.example/diana.png",
    });
    const allocation = makeAllocation({
      id: "al-lifecycle",
      accountId,
      resourceId: resource.id,
      note: "Private booking",
    });
    const timeOff = makeTimeOff({ id: "to-lifecycle", accountId, resourceId: resource.id, note: "Private leave" });
    s().replaceAll(makeAppData({ resources: [resource], allocations: [allocation], timeOff: [timeOff] }));
    s().setActiveAccount(accountId);
    await s().sendPlanningCommand({
      intent: { operation: "resource.archive", id: resource.id },
      inverse: { operation: "resource.unarchive", id: resource.id },
    });
    expect(s().planning.history.past).toHaveLength(1);
    s().anonymiseResource(resource.id);
    expect(s().data.resources[0]).toMatchObject({ id: resource.id, avatarUrl: null });
    expect(s().data.resources[0]?.name).not.toContain("Diana");
    expect(s().data.resources[0]?.role).not.toBe("Designer");
    expect(s().data.allocations[0]?.note).toBeNull();
    expect(s().data.timeOff[0]?.note).toBeNull();
    expect(s().past).toEqual([]);
    expect(s().future).toEqual([]);
    expect(s().planning.history.past).toEqual([]);
    expect(s().planning.history.future).toEqual([]);
  });

  it("invalidates retained deletion handles for the selected company after resource anonymisation", async () => {
    const target = makeResource({ id: "r-target", accountId, name: "Diana Prince" });
    const other = makeResource({ id: "r-other", accountId, name: "Clark Kent" });
    const privateBooking = makeAllocation({ id: "al-private", accountId, resourceId: target.id, note: "Private note" });
    const otherBooking = makeAllocation({
      id: "al-other",
      accountId,
      resourceId: other.id,
      note: "Other private note",
    });
    s().replaceAll(makeAppData({ resources: [target, other], allocations: [privateBooking, otherBooking] }));
    s().setActiveAccount(accountId);
    await s().deleteAllocation(privateBooking.id);
    await s().deleteAllocation(otherBooking.id);
    const retained = s()
      .planning.history.past.map((entry) => entry.inverse)
      .filter((inverse) => inverse.operation === "planning.restoreGroup");
    expect(retained).toHaveLength(2);
    s().anonymiseResource(target.id);
    for (const inverse of retained) {
      await expect(s().sendPlanningCommand({ intent: inverse, inverse: null })).rejects.toMatchObject({ status: 409 });
    }
    expect(s().data.allocations).toEqual([]);
    expect(s().data.resources.find((row) => row.id === other.id)?.name).toBe("Clark Kent");
  });

  it("does not republish a pre-scrub planning completion after the reset generation changes", async () => {
    const resource = makeResource({ id: "r-racing", accountId, name: "Diana Prince" });
    s().replaceAll(makeAppData({ resources: [resource] }));
    s().setActiveAccount(accountId);
    const pending = s().sendPlanningCommand({
      intent: { operation: "resource.archive", id: resource.id },
      inverse: { operation: "resource.unarchive", id: resource.id },
    });
    s().anonymiseResource(resource.id);
    await pending.catch(() => undefined);
    expect(s().data.resources.find((row) => row.id === resource.id)?.name).toMatch(/^Removed person/);
    expect(s().planning.pending).toBeNull();
    expect(s().planning.history.past).toEqual([]);
  });
});
