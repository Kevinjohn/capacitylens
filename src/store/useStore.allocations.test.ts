import { beforeEach, describe, expect, it } from "vitest";
import type { Allocation } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeResourceDraft, resetStoreWithAccount } from "../test/fixtures";
import { useStore, type Draft } from "./useStore";

const state = () => useStore.getState();

beforeEach(() => resetStoreWithAccount());

function allocationSetup() {
  const resource = state().addResource(makeResourceDraft());
  const activity = state().addActivity({ name: "Admin", kind: "repeatable" });
  const draft = (overrides: Partial<Draft<Allocation>> = {}): Draft<Allocation> => ({
    resourceId: resource.id,
    activityId: activity.id,
    startDate: "2026-06-01",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
    ...overrides,
  });
  useStore.setState({ past: [], future: [] });
  return { resource, activity, draft };
}

describe("atomic allocation creation", () => {
  it("shares the single/bulk path, stamps unique rows, clamps hours and publishes once", () => {
    const { draft } = allocationSetup();
    let publications = 0;
    const unsubscribe = useStore.subscribe(() => {
      publications += 1;
    });
    const created = state().addAllocations([
      draft({ hoursPerDay: 99 }),
      draft({ startDate: "2026-06-08", endDate: "2026-06-10" }),
    ]);
    unsubscribe();

    expect(publications).toBe(1);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((allocation) => allocation.id)).size).toBe(2);
    expect(created.every((allocation) => allocation.accountId === DEFAULT_ACCOUNT_ID)).toBe(true);
    expect(created[0].hoursPerDay).toBe(24);
    expect(state().data.allocations).toEqual(created);
    expect(state().past).toHaveLength(1);

    const single = state().addAllocation(draft({ startDate: "2026-06-15", endDate: "2026-06-15" }));
    expect(state().data.allocations.at(-1)).toEqual(single);
    expect(state().past).toHaveLength(2);
  });

  it("rejects an empty batch", () => {
    expect(() => state().addAllocations([])).toThrow(/at least one allocation/i);
    expect(state().data.allocations).toHaveLength(0);
  });

  it("rejects an invalid middle row before any state/history publication", () => {
    const { draft } = allocationSetup();
    let publications = 0;
    const unsubscribe = useStore.subscribe(() => {
      publications += 1;
    });
    expect(() =>
      state().addAllocations([
        draft(),
        draft({ startDate: "2026-07-10", endDate: "2026-07-01" }),
        draft({ startDate: "2026-08-01", endDate: "2026-08-02" }),
      ]),
    ).toThrow(/end date cannot be before/i);
    unsubscribe();
    expect(publications).toBe(0);
    expect(state().data.allocations).toHaveLength(0);
    expect(state().past).toHaveLength(0);
  });

  it("rejects cross-account references and a placeholder/project mismatch atomically", () => {
    const first = allocationSetup();
    const secondAccount = state().addAccount({ name: "Other", color: "#111111" });
    expect(secondAccount).not.toBeNull();
    state().setActiveAccount(secondAccount!.id);
    const otherResource = state().addResource(makeResourceDraft({ name: "Other person" }));
    const otherActivity = state().addActivity({ name: "Other work", kind: "repeatable" });
    state().setActiveAccount(DEFAULT_ACCOUNT_ID);
    useStore.setState({ past: [], future: [] });
    expect(() =>
      state().addAllocations([
        first.draft(),
        first.draft({ resourceId: otherResource.id, activityId: otherActivity.id }),
      ]),
    ).toThrow(/active company|existing resource and activity/i);
    expect(state().data.allocations).toHaveLength(0);
    expect(state().past).toHaveLength(0);

    const client = state().addClient({ name: "Client", color: "#111111" });
    const boundProject = state().addProject({ name: "Bound", clientId: client.id, color: "#222222" });
    const otherProject = state().addProject({ name: "Other", clientId: client.id, color: "#333333" });
    const placeholder = state().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: "#444444",
      projectId: boundProject.id,
    });
    const mismatchedActivity = state().addActivity({
      name: "Wrong project",
      kind: "project",
      projectId: otherProject.id,
    });
    useStore.setState({ past: [], future: [] });
    expect(() =>
      state().addAllocations([
        first.draft(),
        first.draft({ resourceId: placeholder.id, activityId: mismatchedActivity.id }),
      ]),
    ).toThrow(/placeholder.*bound project/i);
    expect(state().data.allocations).toHaveLength(0);
    expect(state().past).toHaveLength(0);
  });

  it("creates one undo/redo unit for the complete batch", () => {
    const { draft } = allocationSetup();
    const created = state().addAllocations([
      draft(),
      draft({ startDate: "2026-06-08", endDate: "2026-06-10" }),
      draft({ startDate: "2026-06-15", endDate: "2026-06-17" }),
    ]);
    expect(state().data.allocations).toEqual(created);
    state().undo();
    expect(state().data.allocations).toHaveLength(0);
    state().redo();
    expect(state().data.allocations).toEqual(created);
  });

  it("applies the Viewer guard to the whole batch", () => {
    const { draft } = allocationSetup();
    state().setActiveRole("viewer");
    const returned = state().addAllocations([draft(), draft({ startDate: "2026-06-08", endDate: "2026-06-10" })]);
    expect(returned).toHaveLength(2);
    expect(state().data.allocations).toHaveLength(0);
    expect(state().past).toHaveLength(0);
    expect(state().notice).toMatchObject({ tone: "error" });
  });
});
