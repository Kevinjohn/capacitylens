import { act } from "@testing-library/react";
import { requireCreated } from "@/test/requireCreated";
import type { Allocation } from "@capacitylens/shared/types/entities";
import { makeResourceDraft } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import type { BarLayout } from "@/components/scheduler/schedulerModel";

/** Lets a committed gesture's typed planning write settle and publish. */
export async function settlePlanning(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Creates a DOM rectangle with predictable vertical bounds for gesture tests. */
export const rect = (top: number, bottom: number): DOMRect =>
  ({
    left: 0,
    right: 500,
    top,
    bottom,
    width: 500,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** Creates a stored allocation with optional field overrides for interaction tests. */
export async function seedAllocation(overrides: Partial<Allocation> = {}): Promise<Allocation> {
  const s = useStore.getState();
  const c = await requireCreated(s.addClient({ name: "Ferris", color: "#1" }));
  const p = await requireCreated(s.addProject({ name: "P", clientId: c.id, color: "#2" }));
  const t = await requireCreated(s.addActivity({ name: "Wires", kind: "project", projectId: p.id }));
  const r = await requireCreated(s.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" })));
  return requireCreated(
    await s.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
      ...overrides,
    }),
  );
}

/** Creates an allocation whose capacity signal is outside the visible test window. */
export async function seedVisibleAllocationWithHiddenCapacity(): Promise<Allocation> {
  const st = useStore.getState();
  const hiddenClient = await requireCreated(st.addClient({ name: "Archived client", color: "#1" }));
  const hiddenProject = await requireCreated(
    st.addProject({ name: "Archived work", clientId: hiddenClient.id, color: "#2" }),
  );
  const hiddenActivity = await requireCreated(
    st.addActivity({ name: "Hidden work", kind: "project", projectId: hiddenProject.id }),
  );
  const visibleClient = await requireCreated(st.addClient({ name: "Visible client", color: "#3" }));
  const visibleProject = await requireCreated(
    st.addProject({ name: "Visible work", clientId: visibleClient.id, color: "#4" }),
  );
  const visibleActivity = await requireCreated(
    st.addActivity({ name: "Visible work", kind: "project", projectId: visibleProject.id }),
  );
  const resource = await requireCreated(st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#5" })));
  await st.addAllocation({
    resourceId: resource.id,
    activityId: hiddenActivity.id,
    startDate: "2026-06-03",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
  });
  const visible = await requireCreated(
    await st.addAllocation({
      resourceId: resource.id,
      activityId: visibleActivity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 4,
      status: "confirmed",
    }),
  );
  await st.archiveEntity("clients", hiddenClient.id);
  return visible;
}

/** Wraps an allocation in the bar layout expected by interaction tests. */
export const barFor = (allocation: Allocation): BarLayout => ({
  allocation,
  x: 0,
  width: 144,
  top: 0,
  color: "#3b82f6",
  label: "Wires",
  external: false,
});

/** Reads a saved allocation and fails the test when it is missing. */
export function getStoredAllocation(allocationId: Allocation["id"]): Allocation {
  const allocation = useStore.getState().data.allocations.find((candidate) => candidate.id === allocationId);
  if (!allocation) throw new Error(`Expected allocation ${allocationId} to remain in the store.`);
  return allocation;
}

/** Reads the current screen-reader announcement and fails when absent. */
export function getSrAnnouncement() {
  const announcement = useStore.getState().srAnnouncement;
  if (!announcement) throw new Error("Expected the allocation edit to produce a screen-reader announcement.");
  return announcement;
}

/** Creates predictable lane bounds for pointer interaction tests. */
export const laneRect = (top: number, bottom: number): DOMRect =>
  ({
    left: 0,
    right: 500,
    top,
    bottom,
    width: 500,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;
