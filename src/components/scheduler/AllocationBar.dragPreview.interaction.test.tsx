import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, makeResourceDraft } from "../../test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import { barFor, getStoredAllocation, rect, seedAllocation } from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

function registerTargetCalendarTest() {
  it("a cross-row reassign computes dates against the TARGET resource’s working week, not the source’s", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    // Source works EVERY day (not weekend-aware); target works Mon–Fri (weekend-aware).
    const src = st.addResource({
      kind: "person",
      name: "Sev",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      halfDays: [],
      color: "#3",
    });
    const dst = st.addResource({
      kind: "person",
      name: "Wk",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#4",
    });
    // A single-day allocation on Friday 2026-06-05, on the source resource.
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    });

    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{ allocation: a, x: 0, width: 48, top: 0, color: "#3b82f6", label: "Wires", external: false }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 24, clientY: 25, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 72, clientY: 125, bubbles: true })); // +1 day, drop on dst
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 72, clientY: 125, bubbles: true }));

    const moved = getStoredAllocation(a.id);
    expect(moved.resourceId).toBe(dst.id);
    // The raw +1 shift lands on Sat 06-06. Under the TARGET's Mon–Fri week both the leading edge
    // and this one-working-day span snap to Mon 06-08 (the source's seven-day week would keep Sat).
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-08", "2026-06-08"]);
  });
}

function registerWeekendPreviewTests() {
  it("previews the SAME weekend-snapped geometry the commit applies (no jump on release)", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    // Mon–Fri allocation 06-01..06-05 (5 working days) → a 5-calendar-day-wide bar.
    const a = st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const dayWidth = 48;
    render(
      <AllocationBar
        bar={{ allocation: a, x: 0, width: 5 * dayWidth, top: 0, color: "#3b82f6", label: "Wires", external: false }}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 10, clientY: 10, button: 0 });
    // Move +1 day — crosses the weekend, so the commit extends the end (Fri → following Mon).
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: 10 + dayWidth, clientY: 10, bubbles: true }));
    });
    // The PREVIEW width reflects the extended 7-day span (06-02..06-08), not the raw 5-day
    // bar — matching what the commit produces, so the bar doesn't jump on release.
    const previewedWidth = parseFloat((bar as HTMLElement).style.width);
    expect(previewedWidth).toBeGreaterThan(6 * dayWidth - 12); // ~7 days (minus inset), not 5
  });

  it("aborts a drag on pointercancel without committing or leaking listeners", () => {
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, bubbles: true })); // start dragging
    document.dispatchEvent(new Event("pointercancel")); // browser steals the gesture (e.g. to scroll)

    expect(getStoredAllocation(a.id).startDate).toBe("2026-06-01");

    // Listeners were torn down: a stray later pointerup must not commit a stale move.
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 300, bubbles: true }));
    expect(getStoredAllocation(a.id).startDate).toBe("2026-06-01");
  });
}

describe("AllocationBar target-calendar and weekend preview interactions", () => {
  registerTargetCalendarTest();
  registerWeekendPreviewTests();
});
