import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, makeResourceDraft } from "../../test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import {
  barFor,
  getSrAnnouncement,
  getStoredAllocation,
  seedAllocation,
  seedVisibleAllocationWithHiddenCapacity,
} from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

function seedConflictPair() {
  const st = useStore.getState();
  const c = st.addClient({ name: "Acme", color: "#1" });
  const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
  const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
  const r = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
  st.addAllocation({
    resourceId: r.id,
    activityId: t.id,
    startDate: "2026-06-03",
    endDate: "2026-06-03",
    hoursPerDay: 8,
    status: "confirmed",
  });
  return st.addAllocation({
    resourceId: r.id,
    activityId: t.id,
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    hoursPerDay: 8,
    status: "confirmed",
  });
}

function registerCapacityAnnouncementTests() {
  it('announces the over-capacity outcome when a nudge flips a day to over, and "no conflicts" when it resolves', () => {
    // Pin the visible window to early June, independent of "today". The announced over-count is
    // clamped to `visibleRange(ui)`, and the store's DEFAULT window derives from today (once, at
    // init) — so with fixed June allocations this assertion would rot as today drifts past them
    // unless the window is anchored here (mirrors the sibling Window-alignment test below).
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } })); // [2026-06-01 .. 2026-06-14]
    const b = seedConflictPair();
    const { rerender } = render(
      <AllocationBar bar={barFor(b)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(useStore.getState().srAnnouncement).toBeNull(); // nothing announced before any edit

    // ArrowRight: B 06-01..06-02 → 06-02..06-03, overlapping A on Wed → 1 over day.
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    let moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-02", "2026-06-03"]);
    const over = getSrAnnouncement();
    expect(over.text).toBe("Ty now over capacity on 1 day.");

    // ArrowLeft: back to 06-01..06-02, overlap gone → announce no conflicts (and a NEW seq so an
    // identical message would still re-announce — the seq must strictly rise).
    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft" });
    moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-01", "2026-06-02"]);
    const clear = getSrAnnouncement();
    expect(clear.text).toBe("Ty: no capacity conflicts.");
    expect(clear.seq).toBeGreaterThan(over.seq);
  });

  it("ignores retained allocations hidden beneath an archived client", () => {
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } }));
    const visible = seedVisibleAllocationWithHiddenCapacity();
    render(<AllocationBar bar={barFor(visible)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });

    expect(useStore.getState().srAnnouncement?.text).toBe("Ty: no capacity conflicts.");
  });
}

function registerVisibleWindowAnnouncementTest() {
  // Window-alignment (the major review finding): the spoken count must equal the RENDERED per-row
  // sr-only summary, which counts over-days only WITHIN the visible timeline window
  // (`dayStates.filter(d => d.over)`, built across `visibleRange(ui)`). So an over-day OUTSIDE that
  // window — scrolled out of view — must NOT be counted by the announcement. Here the conflict pair
  // sits in September while the visible window is pinned to early June; the recomputed over-day at
  // 09-02 is off-window, so the announcement must read "no conflicts" (it would say "1 day" if it
  // re-scanned the resource's full span instead of clamping to the window).
  it("does NOT count an over-day OUTSIDE the visible window (spoken count == rendered row summary)", () => {
    // Pin a deterministic, narrow visible window to early June, independent of "today".
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 14 } })); // [2026-06-01 .. 2026-06-14]
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    // A fixed on Wed 2026-09-02; B starts Tue 09-01 (no overlap). ArrowRight slides B onto 09-02 →
    // a REAL over-day (16h vs 8h), but 09-02 is far OUTSIDE the [06-01..06-14] visible window.
    st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const b = st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      hoursPerDay: 8,
      status: "confirmed",
    });

    const { rerender } = render(
      <AllocationBar bar={barFor(b)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    const moved = getStoredAllocation(b.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-09-02", "2026-09-02"]); // the conflict really happened…
    // …but it's off-window, so the announcement counts ZERO over-days — matching the rendered row.
    expect(getSrAnnouncement().text).toBe("Ty: no capacity conflicts.");

    // Sanity: widen the window to include September and the SAME edit now speaks the over-day,
    // proving the divergence was purely the window clamp (the over-marker signal is unchanged).
    useStore.setState((s) => ({ ui: { ...s.ui, originDate: "2026-06-01", rangeDays: 120 } })); // now covers 09-02
    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft" }); // 09-02 → 09-01, no overlap
    rerender(
      <AllocationBar
        bar={barFor(getStoredAllocation(b.id))}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" }); // back onto 09-02 → over again
    expect(getSrAnnouncement().text).toBe("Ty now over capacity on 1 day.");
  });
}

function registerPointerAnnouncementTest() {
  it("does NOT announce on a pointer drag (sighted feedback — would be noise)", () => {
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    expect(getStoredAllocation(a.id).startDate).toBe("2026-06-02"); // moved
    expect(useStore.getState().srAnnouncement).toBeNull(); // but the live region stayed silent
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
  it("excludes retained hidden allocations from pointer capacity advice", () => {
    const visible = seedVisibleAllocationWithHiddenCapacity();
    render(<AllocationBar bar={barFor(visible)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    expect(useStore.getState().notice?.message).not.toMatch(/over capacity/i);
  });

  it("pins the dragged row (draggingAllocationId) on the first move and clears it on commit", () => {
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");
    expect(useStore.getState().draggingAllocationId).toBeNull();

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true })); // first move → pin
    expect(useStore.getState().draggingAllocationId).toBe(a.id);

    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true })); // commit → release
    expect(useStore.getState().draggingAllocationId).toBeNull();
  });

  it("clears the drag-pin on pointercancel, and on unmount if the bar still owns it", () => {
    const a = seedAllocation();
    const { unmount } = render(
      <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);
    document.dispatchEvent(new Event("pointercancel"));
    expect(useStore.getState().draggingAllocationId).toBeNull();

    // And the unmount-cleanup releases a pin this bar still owns (deleted/account-switch mid-drag).
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
