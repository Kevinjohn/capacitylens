import type { Allocation } from "@capacitylens/shared/types/entities";
import { makeResourceDraft } from "../../../test/fixtures";
import { useStore } from "../../../store/useStore";
import type { BarLayout } from "../schedulerModel";

// A fixed-width (500px) lane DOMRect stub for pointer-geometry math in drag/resize tests — only
// `top`/`bottom` (and the `height` they imply) vary per case.
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

export function seedAllocation(overrides: Partial<Allocation> = {}): Allocation {
  const s = useStore.getState();
  const c = s.addClient({ name: "Acme", color: "#1" });
  const p = s.addProject({ name: "P", clientId: c.id, color: "#2" });
  const t = s.addActivity({ name: "Wires", kind: "project", projectId: p.id });
  const r = s.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
  return s.addAllocation({
    resourceId: r.id,
    activityId: t.id,
    startDate: "2026-06-01",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
    ...overrides,
  });
}

export function seedVisibleAllocationWithHiddenCapacity(): Allocation {
  const st = useStore.getState();
  const hiddenClient = st.addClient({ name: "Archived client", color: "#1" });
  const hiddenProject = st.addProject({ name: "Archived work", clientId: hiddenClient.id, color: "#2" });
  const hiddenActivity = st.addActivity({ name: "Hidden work", kind: "project", projectId: hiddenProject.id });
  const visibleClient = st.addClient({ name: "Visible client", color: "#3" });
  const visibleProject = st.addProject({ name: "Visible work", clientId: visibleClient.id, color: "#4" });
  const visibleActivity = st.addActivity({ name: "Visible work", kind: "project", projectId: visibleProject.id });
  const resource = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#5" }));
  st.addAllocation({
    resourceId: resource.id,
    activityId: hiddenActivity.id,
    startDate: "2026-06-03",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
  });
  const visible = st.addAllocation({
    resourceId: resource.id,
    activityId: visibleActivity.id,
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    hoursPerDay: 4,
    status: "confirmed",
  });
  st.archiveEntity("clients", hiddenClient.id);
  return visible;
}

export const barFor = (allocation: Allocation): BarLayout => ({
  allocation,
  x: 0,
  width: 144,
  top: 0,
  color: "#3b82f6",
  label: "Wires",
  external: false,
});

export function getStoredAllocation(allocationId: Allocation["id"]): Allocation {
  const allocation = useStore.getState().data.allocations.find((candidate) => candidate.id === allocationId);
  if (!allocation) throw new Error(`Expected allocation ${allocationId} to remain in the store.`);
  return allocation;
}

export function getSrAnnouncement() {
  const announcement = useStore.getState().srAnnouncement;
  if (!announcement) throw new Error("Expected the allocation edit to produce a screen-reader announcement.");
  return announcement;
}

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
