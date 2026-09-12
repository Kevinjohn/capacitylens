import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { LAYOUT } from "./layout";
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

  it("does not reread a destination resource from the store on every preview frame", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const src = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    const dst = st.addResource(makeResourceDraft({ name: "Sam", role: "Dev", color: "#4" }));
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: 55, clientY: 125, bubbles: true }));
    });

    const getState = vi.spyOn(useStore, "getState");
    try {
      act(() => {
        document.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 125, bubbles: true }));
      });

      expect(getState).not.toHaveBeenCalled();
    } finally {
      getState.mockRestore();
    }
    act(() => {
      document.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
    });
  });
}

function registerSourceCalendarTest() {
  // Issue #338. June 2026: 06-04 is a Thursday, 06-05 a Friday, 06-08 a Monday, 06-09 a Tuesday.
  const midWeek = [2, 3, 4] as const; // Tue/Wed/Thu — works neither Friday nor Monday
  const monToFri = [1, 2, 3, 4, 5] as const;

  /** The bar is drawn inset inside its column span, so its rendered width is not the raw geometry
   *  width. Mirror `buildBarInset` rather than hard-coding the difference. */
  const renderedWidth = (from: string, to: string) => {
    const raw = GEOM.widthForDates(from, to);
    return Math.max(1, raw - Math.min(LAYOUT.barInset, raw / 3) * 2);
  };

  /** The bar's rendered left edge: its column position plus the same inset. */
  const renderedLeft = (from: string, to: string) =>
    GEOM.xForDateInGeom(from) + Math.min(LAYOUT.barInset, GEOM.widthForDates(from, to) / 3);

  function seedCrossWeekPair() {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const src = st.addResource(makeResourceDraft({ name: "Mid", role: "Dev", color: "#3", workingDays: [...midWeek] }));
    const dst = st.addResource(
      makeResourceDraft({ name: "Full", role: "Dev", color: "#4", workingDays: [...monToFri] }),
    );
    // Two of Mid's working days (Thu 06-04 and Tue 06-09), drawn across the six calendar days
    // between them because Mid works neither Friday nor Monday.
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-04",
      endDate: "2026-06-09",
      hoursPerDay: 8,
      status: "confirmed",
    });
    return { src, dst, a };
  }

  it("a cross-row reassign keeps the duration the SOURCE measured, so the bar shrinks", () => {
    const { src, dst, a } = seedCrossWeekPair();
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{
            allocation: a,
            x: GEOM.xForDateInGeom("2026-06-04"),
            width: GEOM.widthForDates("2026-06-04", "2026-06-09"),
            top: 0,
            color: "#3b82f6",
            label: "Wires",
            external: false,
          }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    const startX = GEOM.xForDateInGeom("2026-06-04") + 10;
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: startX, clientY: 125, bubbles: true }));
    });

    // The preview already shows the shrunk two-day span, so the bar does not jump on release.
    expect(parseFloat((bar as HTMLElement).style.width)).toBeCloseTo(renderedWidth("2026-06-04", "2026-06-05"), 5);

    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { clientX: startX, clientY: 125, bubbles: true }));
    });

    const moved = getStoredAllocation(a.id);
    expect(moved.resourceId).toBe(dst.id);
    // Two working days measured on Mid, re-placed on Full: Thursday and Friday.
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-04", "2026-06-05"]);
    // The duration is preserved in working days, so the load per day is untouched.
    expect(moved.hoursPerDay).toBe(8);
  });

  it("a reassignment the drop will refuse previews nothing, so the bar does not stretch then snap back", () => {
    // Mon 2026-06-08 - Fri 06-12 on a Mon-Fri person, dropped straight onto a Tue/Wed/Thu person.
    // The unchanged Monday start is not one of theirs, so the commit refuses the drop; drawing the
    // range it would otherwise take (five of their working days, running to 06-18) would stretch
    // the bar to twice its width and then snap it back on release.
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const src = st.addResource(
      makeResourceDraft({ name: "Full", role: "Dev", color: "#3", workingDays: [...monToFri] }),
    );
    const dst = st.addResource(makeResourceDraft({ name: "Mid", role: "Dev", color: "#4", workingDays: [...midWeek] }));
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-08",
      endDate: "2026-06-12",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const barWidth = GEOM.widthForDates("2026-06-08", "2026-06-12");
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{
            allocation: a,
            x: GEOM.xForDateInGeom("2026-06-08"),
            width: barWidth,
            top: 0,
            color: "#3b82f6",
            label: "Wires",
            external: false,
          }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    const startX = GEOM.xForDateInGeom("2026-06-08") + 10;
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: startX, clientY: 125, bubbles: true }));
    });
    expect(parseFloat((bar as HTMLElement).style.width)).toBeCloseTo(renderedWidth("2026-06-08", "2026-06-12"), 5);

    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { clientX: startX, clientY: 125, bubbles: true }));
    });

    const after = getStoredAllocation(a.id);
    expect(after.resourceId).toBe(src.id);
    expect([after.startDate, after.endDate]).toEqual(["2026-06-08", "2026-06-12"]);
  });

  it("keeps following the pointer sideways while the row under it refuses the drop", () => {
    // Same refused drop as above, but dragged a week to the right as well as down. The bar must not
    // take the destination's re-placement, and it must not freeze at its old column either: it
    // previews the range this drag would give it on its OWN row, so it tracks the pointer.
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const src = st.addResource(
      makeResourceDraft({ name: "Full", role: "Dev", color: "#3", workingDays: [...monToFri] }),
    );
    const dst = st.addResource(makeResourceDraft({ name: "Mid", role: "Dev", color: "#4", workingDays: [...midWeek] }));
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-08",
      endDate: "2026-06-12",
      hoursPerDay: 8,
      status: "confirmed",
    });
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{
            allocation: a,
            x: GEOM.xForDateInGeom("2026-06-08"),
            width: GEOM.widthForDates("2026-06-08", "2026-06-12"),
            top: 0,
            color: "#3b82f6",
            label: "Wires",
            external: false,
          }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    const startX = GEOM.xForDateInGeom("2026-06-08") + 10;
    // Mon 06-15 is not one of Tue/Wed/Thu, so the drop is still refused.
    const movedX = GEOM.xForDateInGeom("2026-06-15") + 10;
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: movedX, clientY: 125, bubbles: true }));
    });

    const style = (bar as HTMLElement).style;
    expect(parseFloat(style.left)).toBeCloseTo(renderedLeft("2026-06-15", "2026-06-19"), 5);
    expect(parseFloat(style.width)).toBeCloseTo(renderedWidth("2026-06-15", "2026-06-19"), 5);

    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { clientX: movedX, clientY: 125, bubbles: true }));
    });
    expect(getStoredAllocation(a.id).resourceId).toBe(src.id);
  });

  it("keeps previewing a zero-column reassignment when the source resource disappears", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const src = st.addResource(
      makeResourceDraft({ name: "Full", role: "Dev", color: "#3", workingDays: [...monToFri] }),
    );
    const dst = st.addResource(
      makeResourceDraft({ name: "Full", role: "Dev", color: "#4", workingDays: [...monToFri] }),
    );
    // The stored range ends on a Sunday. Reinterpreting its seven target working days should end
    // on Friday instead, so a missing source week cannot be mistaken for a same-row no-op.
    const a = st.addAllocation({
      resourceId: src.id,
      activityId: t.id,
      startDate: "2026-06-04",
      endDate: "2026-06-14",
      hoursPerDay: 8,
      status: "confirmed",
    });
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{
            allocation: a,
            x: GEOM.xForDateInGeom(a.startDate),
            width: GEOM.widthForDates(a.startDate, a.endDate),
            top: 0,
            color: "#3b82f6",
            label: "Wires",
            external: false,
          }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: GEOM.xForDateInGeom(a.startDate) + 10, clientY: 25, button: 0 });
    // Keep the destination lane in the DOM while its source resource is removed from live state,
    // matching a virtualized row being deleted during an armed gesture.
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      resources: useStore.getState().data.resources.filter((resource) => resource.id !== src.id),
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("pointermove", { clientX: GEOM.xForDateInGeom(a.startDate) + 10, clientY: 125, bubbles: true }),
      );
    });

    expect(parseFloat((bar as HTMLElement).style.width)).toBeCloseTo(renderedWidth("2026-06-04", "2026-06-12"), 5);
    act(() => {
      document.dispatchEvent(
        new MouseEvent("pointerup", { clientX: GEOM.xForDateInGeom(a.startDate) + 10, clientY: 125, bubbles: true }),
      );
    });
    expect(getStoredAllocation(a.id)).toMatchObject({
      resourceId: dst.id,
      startDate: "2026-06-04",
      endDate: "2026-06-12",
    });
  });

  it("a same-row vertical wiggle previews nothing, even for a range its own week would renormalise", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r = st.addResource(makeResourceDraft({ name: "Full", role: "Dev", color: "#3", workingDays: [...monToFri] }));
    // Thu 06-04 - Sun 06-07: two working days drawn over four calendar days, so re-deriving the
    // range here WOULD change it. A gesture that commits nothing must not preview that change.
    const a = st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-04",
      endDate: "2026-06-07",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const barWidth = GEOM.widthForDates("2026-06-04", "2026-06-07");
    render(
      <>
        <div data-resource-id={r.id} data-testid="lane-only" />
        <AllocationBar
          bar={{
            allocation: a,
            x: GEOM.xForDateInGeom("2026-06-04"),
            width: barWidth,
            top: 0,
            color: "#3b82f6",
            label: "Wires",
            external: false,
          }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-only").getBoundingClientRect = () => rect(0, 150);

    const bar = screen.getByTestId("allocation-bar");
    const startX = GEOM.xForDateInGeom("2026-06-04") + 10;
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: startX, clientY: 120, bubbles: true }));
    });

    expect(parseFloat((bar as HTMLElement).style.width)).toBeCloseTo(renderedWidth("2026-06-04", "2026-06-07"), 5);

    act(() => {
      document.dispatchEvent(new MouseEvent("pointerup", { clientX: startX, clientY: 120, bubbles: true }));
    });

    const after = getStoredAllocation(a.id);
    expect([after.startDate, after.endDate]).toEqual(["2026-06-04", "2026-06-07"]);
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
  registerSourceCalendarTest();
  registerWeekendPreviewTests();
});
