import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "@/store/useStore";
import { resetStoreWithAccount, makeResourceDraft } from "@/test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import {
  barFor,
  getSrAnnouncement,
  getStoredAllocation,
  seedAllocation,
  seedVisibleAllocationWithHiddenCapacity,
  settlePlanning,
} from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

async function seedConflictPair() {
  const st = useStore.getState();
  const c = requireCreated(st.addClient({ name: "Ferris", color: "#1" }));
  const p = requireCreated(st.addProject({ name: "P", clientId: c.id, color: "#2" }));
  const t = requireCreated(st.addActivity({ name: "Wires", kind: "project", projectId: p.id }));
  const r = requireCreated(st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" })));
  await st.addAllocation({
    resourceId: r.id,
    activityId: t.id,
    startDate: "2026-06-03",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
  });
  return requireCreated(
    await st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    }),
  );
}

function registerCapacityAnnouncementTests() {
  it('announces the over-capacity outcome when a nudge flips a day to over, and "no conflicts" when it resolves', async () => {
    // Anchor the visible window to the fixed fixture dates so capacity announcements remain deterministic as today advances.
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } }));
    const b = await seedConflictPair();
    const { rerender } = render(
      <AllocationBar bar={barFor(b)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(useStore.getState().srAnnouncement).toBeNull();

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    await settlePlanning();
    let moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-02", "2026-06-03"]);
    const over = getSrAnnouncement();
    expect(over.text).toBe("Ty now over capacity on 1 day.");

    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft" });
    await settlePlanning();
    moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-01", "2026-06-02"]);
    const clear = getSrAnnouncement();
    expect(clear.text).toBe("Ty: no capacity conflicts.");
    expect(clear.seq).toBeGreaterThan(over.seq);
  });

  it("ignores retained allocations hidden beneath an archived client", async () => {
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } }));
    const visible = await seedVisibleAllocationWithHiddenCapacity();
    render(<AllocationBar bar={barFor(visible)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    await settlePlanning();

    expect(useStore.getState().srAnnouncement?.text).toBe("Ty: no capacity conflicts.");
  });
}

function registerVisibleWindowAnnouncementTest() {
  // Gesture announcements count only conflicts within the visible zoom window; off-window conflicts must not enter the spoken result.
  it("does NOT count an over-day OUTSIDE the visible window (spoken count == rendered row summary)", async () => {
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } }));
    const st = useStore.getState();
    const c = requireCreated(st.addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(st.addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(st.addActivity({ name: "Wires", kind: "project", projectId: p.id }));
    const r = requireCreated(st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" })));

    await st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const b = requireCreated(
      await st.addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );

    const { rerender } = render(
      <AllocationBar bar={barFor(b)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    await settlePlanning();
    const moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-09-02", "2026-09-02"]);

    expect(getSrAnnouncement().text).toBe("Ty: no capacity conflicts.");

    // A wider window must include the same existing conflict, proving the announcement is scoped by visibility.
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 120 } }));
    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft" });
    await settlePlanning();
    rerender(
      <AllocationBar
        bar={barFor(getStoredAllocation(b.id))}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    await settlePlanning();
    expect(getSrAnnouncement().text).toBe("Ty now over capacity on 1 day.");
  });
}

function registerPointerAnnouncementTest() {
  it("does NOT announce on a pointer drag (sighted feedback — would be noise)", async () => {
    const a = await seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));
    await settlePlanning();

    expect(getStoredAllocation(a.id).startDate).toBe("2026-06-02");
    expect(useStore.getState().srAnnouncement).toBeNull();
  });
}

function registerCapacityAnnouncementSuite() {
  describe("keyboard edit announces the recomputed capacity (a11y live region)", () => {
    registerCapacityAnnouncementTests();
    registerVisibleWindowAnnouncementTest();
    registerPointerAnnouncementTest();
  });
}

function registerCapacityAdviceTests() {
  it("excludes retained hidden allocations from pointer capacity advice", async () => {
    const visible = await seedVisibleAllocationWithHiddenCapacity();
    render(<AllocationBar bar={barFor(visible)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));
    await settlePlanning();

    expect(useStore.getState().notice?.message).not.toMatch(/over capacity/i);
  });

  it("pins the dragged row (draggingAllocationId) on the first move and clears it on commit", async () => {
    const a = await seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");
    expect(useStore.getState().draggingAllocationId).toBeNull();

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);

    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));
    await settlePlanning();
    expect(useStore.getState().draggingAllocationId).toBeNull();
  });

  it("clears the drag-pin on pointercancel, and on unmount if the bar still owns it", async () => {
    const a = await seedAllocation();
    const { unmount } = render(
      <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);
    document.dispatchEvent(new Event("pointercancel"));
    expect(useStore.getState().draggingAllocationId).toBeNull();

    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);
    unmount();
    expect(useStore.getState().draggingAllocationId).toBeNull();
  });
}

describe("AllocationBar capacity announcement interactions", () => {
  registerCapacityAnnouncementSuite();
  registerCapacityAdviceTests();
});
