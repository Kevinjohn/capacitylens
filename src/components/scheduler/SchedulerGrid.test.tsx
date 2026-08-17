import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SchedulerGrid } from "./SchedulerGrid";
import { useStore } from "../../store/useStore";
import type { AppData } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeAllocation, makeClosure, makeResource, makeTimeOff } from "../../test/fixtures";
import { schedulerDataset } from "./__tests__/schedulerTestKit";
import { LAYOUT, schedulerDensity } from "./layout";

const ACC = DEFAULT_ACCOUNT_ID;

// SchedulerGrid calls useNavigate (the empty-state "Go to Resources" CTA), so every render must
// sit inside a Router.
function renderGrid() {
  return render(<SchedulerGrid />, { wrapper: MemoryRouter });
}

function dataset(): AppData {
  return schedulerDataset({
    resources: [
      makeResource({ accountId: ACC, disciplineId: "d1", name: "Bruce", color: "#111" }),
      makeResource({
        id: "r-ext",
        accountId: ACC,
        kind: "external",
        name: "Kord Industries",
        role: "Partner studio",
        color: "#999",
      }),
    ],
  });
}

beforeEach(() => {
  useStore.getState().replaceAll(dataset());
  useStore.getState().setActiveAccount(ACC);
  useStore.getState().setOriginDate("2026-06-01");
  useStore.getState().setZoom(1); // widest columns
  useStore.getState().setDrawMode("work");
  // Density is a persisted device pref, so it survives between tests in this file — pin it to the
  // shipped default (roomy) or a test that flips it changes the row/header heights every test after
  // it measures.
  useStore.getState().setCompactView(false);
  useStore.getState().setUtilizationPref("showTotal", true);
  useStore.getState().clearFilters();
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [], scrollToResource: null } }));
});

describe("SchedulerGrid", () => {
  it("names the resource column when the optional total utilisation is hidden", () => {
    useStore.getState().setUtilizationPref("showTotal", false);

    renderGrid();

    expect(screen.getByRole("columnheader", { name: "Resources" })).toHaveAttribute("aria-colindex", "1");
    expect(screen.queryByTestId("overall-utilization")).not.toBeInTheDocument();
  });

  it("positions a bar by start date with inclusive width", () => {
    renderGrid();
    const bar = screen.getByTestId("allocation-bar");
    // origin === start -> left is just the visual inset; width is a positive multiple of
    // the (responsive) dayWidth. Exact px geometry is covered by schedulerModel.test.
    expect(bar.style.left).toBe(`${LAYOUT.barInset}px`);
    expect(Number.parseInt(bar.style.width, 10)).toBeGreaterThan(0);
    expect(bar).toHaveAttribute("data-status", "confirmed");
  });

  it("groups resource rows under their discipline", () => {
    renderGrid();
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Bruce")).toBeInTheDocument();
    expect(screen.getByText(/Wireframes/)).toBeInTheDocument();
  });

  it("keeps the dragged source mounted while vertical windowing exposes a distant target", () => {
    const base = dataset();
    const resources = Array.from({ length: 100 }, (_, index) => ({
      ...base.resources[0],
      id: `r${index}`,
      name: `Person ${index}`,
    }));
    useStore.getState().replaceAll({
      ...base,
      resources,
      allocations: [{ ...base.allocations[0], resourceId: "r0" }],
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 180 });
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const view = renderGrid();
    try {
      expect(document.querySelector('[data-resource-id="r0"]')).not.toBeNull();
      expect(document.querySelector('[data-resource-id="r99"]')).toBeNull();

      act(() => useStore.setState({ draggingAllocationId: "a1" }));
      const grid = screen.getByTestId("scheduler-grid");
      act(() => {
        grid.scrollTop = 100_000;
        grid.dispatchEvent(new Event("scroll"));
      });

      expect(document.querySelector('[data-resource-id="r99"]')).not.toBeNull();
      expect(document.querySelector('[data-resource-id="r0"]')).not.toBeNull();
      expect(screen.getByTestId("allocation-bar")).toBeInTheDocument();
    } finally {
      view.unmount();
      rafSpy.mockRestore();
      delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
      useStore.setState({ draggingAllocationId: null });
    }
  });

  it("exposes grid semantics + an sr-only capacity summary for screen readers", () => {
    renderGrid();
    expect(screen.getByRole("grid", { name: "Resource schedule" })).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
    expect(screen.getByRole("rowheader", { name: /Bruce/ })).toBeInTheDocument();
    expect(screen.getByText(/1 allocation\./)).toBeInTheDocument(); // sr-only row summary
  });

  it("announces time-off mode, hides work counts and offers keyboard time-off creation", async () => {
    renderGrid();

    act(() => useStore.getState().setDrawMode("timeoff"));

    expect(screen.getByTestId("scheduler-live-region")).toHaveTextContent(/Time-off mode/);
    expect(screen.queryByText(/1 allocation\./)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add time off for Kord Industries/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add time off for Bruce" }));
    expect(await screen.findByRole("heading", { name: "Add time off" })).toBeInTheDocument();
  });

  it("folds the per-row utilisation % into the sr-only summary (WCAG 1.3.1)", () => {
    renderGrid();
    // The utilisation % is otherwise only a `title` on a non-interactive span (AT may not expose it);
    // the sr-only summary must carry it, using the "Utilisation" term and the visible-window phrasing.
    expect(screen.getByText(/% utilisation over the visible/)).toBeInTheDocument();
  });

  it("renders saved half days and includes their non-colour signal in the row summary", () => {
    useStore.getState().updateResource("r1", { halfDays: [2] });
    renderGrid();

    const row = screen.getByRole("rowheader", { name: /Bruce/ }).closest('[data-testid="scheduler-row"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByTestId("half-day").length).toBeGreaterThan(0);
    expect(within(row as HTMLElement).getByText(/half working days\./)).toBeInTheDocument();
  });

  it("marks over-allocated days and shows a utilization figure", () => {
    // Bruce has 8h on 06-01..06-02; add 4h more on 06-01 -> 12h > 8h available.
    useStore.getState().addAllocation({
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 4,
      status: "confirmed",
    });
    renderGrid();
    expect(screen.getAllByTestId("over-marker").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("utilization").length).toBeGreaterThan(0);
  });

  it("marks a zero-load block on time off and includes it in the non-colour row summary", () => {
    useStore.getState().updateAccount(ACC, { schedulingMode: "blocks" });
    useStore.getState().addTimeOff({
      resourceId: "r1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      type: "holiday",
    });
    useStore.getState().setUtilizationPref("showPersonal", true);

    renderGrid();

    const row = screen.getByTestId("scheduler-row");
    expect(within(row).getByTestId("over-marker")).toBeInTheDocument();
    expect(within(row).getByText(/Over capacity on 1 day\./)).toBeInTheDocument();
    expect(within(row).getByTestId("utilization")).toHaveTextContent("0%");
    expect(screen.getByTestId("overall-utilization")).toHaveTextContent("0%");
  });

  it("renders each closure once across tracked rows, alongside personal time off, and stops before External", () => {
    useStore.getState().updateAccount(ACC, { externalEnabled: true });
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      closures: [
        makeClosure({
          accountId: ACC,
          name: "Long weekend",
          startDate: "2026-06-05",
          endDate: "2026-06-08",
        }),
      ],
      timeOff: [
        makeTimeOff({
          accountId: ACC,
          resourceId: "r1",
          startDate: "2026-06-05",
          endDate: "2026-06-08",
        }),
      ],
    });

    renderGrid();

    const band = screen.getByTestId("scheduler-closure-band");
    const rows = screen.getAllByTestId("scheduler-row");
    expect(screen.getAllByTestId("scheduler-closure-band")).toHaveLength(1);
    expect(band).toHaveTextContent("Long weekend");
    expect(within(rows[0]).getByTestId("timeoff-block")).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId("timeoff-block")).not.toBeInTheDocument();
    expect(band.style.height).toBe(
      `${schedulerDensity(false).groupHeaderHeight + Number.parseInt(rows[0].style.height, 10)}px`,
    );
  });

  // The density pref has to reach BOTH pipelines: the model (row heights, bar offsets) and the view
  // (group headers, identity band). Measuring the rendered row proves the model half actually
  // rebuilt — a stale memo would keep the old height even with the pref flipped.
  it("renders taller rows with Compact view off, while the discipline band stays put", () => {
    const measure = () => {
      const row = screen.getAllByTestId("scheduler-row")[0]!;
      const group = screen.getAllByTestId("discipline-group")[0]!;
      return { row: row.style.height, group: group.style.height };
    };

    const roomy = renderGrid() && measure();
    act(() => useStore.getState().setCompactView(true));
    const compact = measure();

    expect(parseInt(roomy.row, 10)).toBeGreaterThan(parseInt(compact.row, 10));
    // The band is deliberately EXEMPT from the density change — same height either way.
    expect(compact.group).toBe(`${LAYOUT.groupHeaderHeight}px`);
    expect(roomy.group).toBe(`${LAYOUT.groupHeaderHeight}px`);
  });

  it("does not replay a handled resource jump after a later model change", () => {
    renderGrid();
    const grid = screen.getByTestId("scheduler-grid");

    act(() => useStore.getState().jumpToResource("r1"));
    // The first row sits directly under one discipline header, whose height follows the active
    // density — the store default is Compact OFF (roomy), so assert the roomy geometry.
    expect(grid.scrollTop).toBe(schedulerDensity(false).groupHeaderHeight);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);

    act(() => {
      grid.scrollTop = 777;
      useStore.getState().addAllocation({
        resourceId: "r1",
        activityId: "t1",
        startDate: "2026-06-03",
        endDate: "2026-06-03",
        hoursPerDay: 1,
        status: "confirmed",
      });
    });

    expect(grid.scrollTop).toBe(777);
  });

  it("expands a collapsed discipline before scrolling to its resource", () => {
    useStore.getState().toggleGroup("d1");
    renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    grid.scrollTop = 444;

    act(() => useStore.getState().jumpToResource("r1"));
    expect(useStore.getState().ui.collapsedGroups).not.toContain("d1");
    expect(grid.scrollTop).toBe(schedulerDensity(false).groupHeaderHeight);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);
  });

  it("expands the collapsed External band before scrolling to its resource", () => {
    useStore.getState().updateAccount(ACC, { externalEnabled: true });
    useStore.getState().toggleGroup("external");
    renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    grid.scrollTop = 444;

    act(() => useStore.getState().jumpToResource("r-ext"));
    expect(useStore.getState().ui.collapsedGroups).not.toContain("external");
    expect(screen.getByText("Kord Industries")).toBeInTheDocument();
    expect(grid.scrollTop).not.toBe(444);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);
  });
});

describe("SchedulerGrid visible-window utilisation", () => {
  // A single Mon–Fri resource (8h/day → 40h/week) with a different booking density each week, so the
  // displayed overall % must change EXACTLY with the 1/2/4/8-week toggle (and stay distinct across them).
  function densityDataset(): AppData {
    return schedulerDataset({
      resources: [makeResource({ accountId: ACC, disciplineId: "d1", name: "Dana", color: "#111" })],
      allocations: [
        makeAllocation({
          id: "w1",
          accountId: ACC,
          startDate: "2026-06-01",
          endDate: "2026-06-05",
        }), // wk1 100%
        makeAllocation({
          id: "w2",
          accountId: ACC,
          startDate: "2026-06-08",
          endDate: "2026-06-12",
          hoursPerDay: 4,
        }), // wk2 50%
        makeAllocation({
          id: "w34",
          accountId: ACC,
          startDate: "2026-06-15",
          endDate: "2026-06-26",
          hoursPerDay: 2,
        }), // wk3–4 25%
        // wk5–8 idle
      ],
    });
  }

  // Anchor the timeline AND the focus date at Mon 2026-06-01 so the visible window starts there
  // (leftEdgeIdx stays -1 in jsdom — the container is never measured — so the % anchors at focusDate).
  const renderAtZoom = (zoom: 1 | 2 | 4 | 8) => {
    useStore.getState().replaceAll(densityDataset());
    useStore.getState().setActiveAccount(ACC);
    useStore.getState().clearFilters();
    useStore.setState((st) => ({
      ui: { ...st.ui, originDate: "2026-06-01", focusDate: "2026-06-01", zoom, collapsedGroups: [] },
    }));
    return renderGrid();
  };
  const overallPct = () => Number.parseInt(screen.getByTestId("overall-utilization").textContent ?? "", 10);

  it("the week-range toggle changes the overall % to reflect EXACTLY the visible span", () => {
    // 1w → 40/40 = 100%; 2w → 60/80 = 75%; 4w → 80/160 = 50%; 8w → 80/320 = 25%.
    const v1 = renderAtZoom(1);
    expect(overallPct()).toBe(100);
    v1.unmount();
    const v2 = renderAtZoom(2);
    expect(overallPct()).toBe(75);
    v2.unmount();
    const v4 = renderAtZoom(4);
    expect(overallPct()).toBe(50);
    v4.unmount();
    const v8 = renderAtZoom(8);
    expect(overallPct()).toBe(25);
    v8.unmount();
  });

  it('the label tracks the zoom (no longer a fixed "next 2w")', () => {
    const v = renderAtZoom(4);
    expect(screen.getByText("Utilisation · 4w")).toBeInTheDocument();
    v.unmount();
  });
});

describe("SchedulerGrid account-local day rollover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const data = dataset();
    data.accounts = data.accounts.map((account) => ({ ...account, timezone: "Pacific/Kiritimati" }));
    data.allocations.push({
      id: "boundary-over",
      accountId: ACC,
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-15",
      endDate: "2026-06-15",
      hoursPerDay: 9,
      status: "confirmed",
    });
    useStore.getState().replaceAll(data);
    useStore.getState().setActiveAccount(ACC);
    useStore.setState((state) => ({
      ui: { ...state.ui, originDate: "2026-06-01", focusDate: "2026-06-01", zoom: 1 },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances the today marker and fixed over-soon window at company-local midnight", () => {
    // Pacific/Kiritimati is UTC+14: this instant is 23:59:59 on 1 June for the account even when
    // the test host is in another timezone.
    vi.setSystemTime(new Date("2026-06-01T09:59:59.000Z"));
    const view = renderGrid();
    const currentHeader = () => view.container.querySelector('[role="columnheader"] .bg-brand-soft');
    expect(currentHeader()).toHaveTextContent("1");
    const lineBefore = screen.getByTestId("today-line").style.left;
    expect(screen.queryByText(/Overbooked in the next two weeks/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(currentHeader()).toHaveTextContent("2");
    expect(screen.getByTestId("today-line").style.left).not.toBe(lineBefore);
    expect(screen.getByText(/Overbooked in the next two weeks/)).toBeInTheDocument();
  });

  it("refreshes immediately when a visible page resumes without its timer firing", () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    useStore.getState().updateAccount(ACC, { timezone: "Etc/GMT" });
    const view = renderGrid();
    const currentHeader = () => view.container.querySelector('[role="columnheader"] .bg-brand-soft');
    expect(currentHeader()).toHaveTextContent("1");

    vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(currentHeader()).toHaveTextContent("2");

    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
    });
    expect(currentHeader()).toHaveTextContent("3");
    visibility.mockRestore();
  });
});

describe("SchedulerGrid filters", () => {
  it('hides tentative allocations when "hide tentative" is on', () => {
    useStore.getState().addAllocation({
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      hoursPerDay: 2,
      status: "tentative",
    });
    const view = renderGrid();
    expect(screen.getAllByTestId("allocation-bar")).toHaveLength(2);
    view.unmount();

    useStore.getState().setFilters({ hideTentative: true });
    renderGrid();
    expect(screen.getAllByTestId("allocation-bar")).toHaveLength(1);
  });

  it("shows an empty state when the search matches nobody", () => {
    useStore.getState().setFilters({ search: "no-such-person" });
    renderGrid();
    const emptyRow = screen.getByTestId("scheduler-empty");
    const grid = screen.getByRole("grid", { name: "Resource schedule" });
    expect(emptyRow).toBeInTheDocument();
    expect(emptyRow).toHaveAttribute("aria-rowindex", "2");
    expect(grid).toHaveAttribute("aria-rowcount", String(screen.getAllByRole("row").length));
  });

  it("collapsing a discipline hides its rows but keeps the header", () => {
    renderGrid();
    expect(screen.getByText("Bruce")).toBeInTheDocument();
    act(() => useStore.getState().toggleGroup("d1"));
    expect(screen.queryByText("Bruce")).not.toBeInTheDocument();
    expect(screen.getByTestId("discipline-group")).toBeInTheDocument();
  });
});

// Feature 2 (the device-global "Snap to week start" pref) — the scroll-idle floor wired through
// onScroll. The PURE floor math is unit-tested in weekSnap.test.ts; here we pin the COMPONENT
// WIRING: the debounce, the drag-freeze respect, the convergence no-op, and the unmount cleanup.
//
// jsdom never lays the grid out (clientWidth === 0), so the geometry effect and the scroll-idle snap
// both early-return (see the "leftEdgeIdx stays -1 in jsdom" note above). We therefore (1) mock
// clientWidth/clientHeight so timelineWidth > 0 and didScroll flips, (2) run rAF synchronously so
// onScroll's body executes inside the dispatched scroll event, and (3) drive WEEK_SNAP_IDLE_MS with
// fake timers. Minimise-weekends is forced OFF; the fitted grid may distribute a few remainder
// pixels across its columns, so the tests read the rendered integer offsets instead of duplicating
// that geometry here.
describe("SchedulerGrid — snap to week start (Feature 2 wiring)", () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Make the grid measure so timelineWidth > 0 (didScroll flips) and the snap actually runs.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
    // Run the onScroll rAF synchronously so its body executes within the dispatched scroll event; the
    // setTimeout(WEEK_SNAP_IDLE_MS) it arms is still driven by the fake timers below.
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    // Uniform columns → predictable week-multiple offsets.
    useStore.getState().setMinimiseWeekends(false);
    // Anchor BOTH origin and focus on Mon 2026-06-01 so first-paint scrollLeft (focusX) is 0.
    useStore.setState((st) => ({
      ui: { ...st.ui, originDate: "2026-06-01", focusDate: "2026-06-01", zoom: 1, collapsedGroups: [] },
    }));
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.useRealTimers();
    delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
    useStore.getState().setSnapToWeekStart(true); // restore the default for other suites
    useStore.getState().setMinimiseWeekends(true);
    useStore.setState({ draggingAllocationId: null });
  });

  // Scroll the grid to `px` and fire the scroll event (the component's onScroll listens for it).
  const scrollTo = (px: number) => {
    const grid = screen.getByTestId("scheduler-grid");
    act(() => {
      grid.scrollLeft = px;
      grid.dispatchEvent(new Event("scroll"));
    });
  };

  const fittedOffsets = () => {
    const cells = Array.from(screen.getByTestId("scheduler-day-tier").children) as HTMLElement[];
    const x = (index: number) =>
      cells.slice(0, index).reduce((sum, cell) => sum + Number.parseFloat(cell.style.width), 0);
    return {
      week: x(7),
      // A mid-week nudge: Wed of week 2 (origin index 9). It floors back to that week's Monday.
      nudge: x(9),
      snapped: x(7),
    };
  };

  it("pref ON: a mid-week nudge floors back to the week start after the idle (and not before)", () => {
    useStore.getState().setSnapToWeekStart(true);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge, snapped } = fittedOffsets();

    scrollTo(nudge);
    expect(grid.scrollLeft).toBe(nudge); // debounce: nothing has moved yet
    act(() => {
      vi.advanceTimersByTime(50);
    }); // still inside the idle window
    expect(grid.scrollLeft).toBe(nudge);

    act(() => {
      vi.advanceTimersByTime(100);
    }); // past WEEK_SNAP_IDLE_MS (120) total
    expect(grid.scrollLeft).toBe(snapped); // floored back to week 2's Monday
    view.unmount();
  });

  it("re-arms on each scroll: two quick scrolls fire only ONE snap, after the final idle", () => {
    useStore.getState().setSnapToWeekStart(true);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge, snapped, week } = fittedOffsets();

    scrollTo(nudge); // arms timer A (would fire at t=120)
    act(() => {
      vi.advanceTimersByTime(40);
    }); // t=40, under the idle — no snap yet
    expect(grid.scrollLeft).toBe(nudge);
    scrollTo(nudge + week); // a second scroll (Wed of week 3) clears A and re-arms timer B (fires t=160)
    act(() => {
      vi.advanceTimersByTime(40);
    }); // t=80, still under BOTH idles (A cleared, B fires at 160)
    expect(grid.scrollLeft).toBe(nudge + week); // no premature snap

    act(() => {
      vi.advanceTimersByTime(120);
    }); // t=200, past timer B → exactly one snap
    expect(grid.scrollLeft).toBe(snapped + week); // floored to week 3's Monday
    view.unmount();
  });

  it("pref OFF: a nudge is left where it lands (no snap timer armed)", () => {
    useStore.getState().setSnapToWeekStart(false);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge } = fittedOffsets();

    scrollTo(nudge);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(grid.scrollLeft).toBe(nudge); // stays put
    view.unmount();
  });

  it("does not arm a horizontal snap for a purely vertical scroll", () => {
    useStore.getState().setSnapToWeekStart(false);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge } = fittedOffsets();

    // Establish a mid-week horizontal position while snapping is disabled, then enable the pref.
    // The next event changes scrollTop only and must not reinterpret that existing scrollLeft as a
    // fresh horizontal gesture.
    scrollTo(nudge);
    act(() => useStore.getState().setSnapToWeekStart(true));
    act(() => {
      grid.scrollTop = 400;
      grid.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(500);
    });

    expect(grid.scrollTop).toBe(400);
    expect(grid.scrollLeft).toBe(nudge);
    view.unmount();
  });

  it("drag-freeze: a snap armed before a drag bails when it fires mid-drag", () => {
    useStore.getState().setSnapToWeekStart(true);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge } = fittedOffsets();

    scrollTo(nudge); // arms the snap timer
    // A drag begins before the idle elapses; the timeout re-checks live draggingAllocationId and bails.
    act(() => useStore.setState({ draggingAllocationId: "x" }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(grid.scrollLeft).toBe(nudge); // not snapped — the drag-freeze held
    view.unmount();
  });

  it("convergence: a scroll that lands exactly on a week start writes nothing back", () => {
    useStore.getState().setSnapToWeekStart(true);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { week } = fittedOffsets();

    scrollTo(week); // already a Monday offset → helper returns null → no write
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(grid.scrollLeft).toBe(week);
    view.unmount();
  });

  it("clears the pending snap timer on unmount (no late write to a detached node)", () => {
    useStore.getState().setSnapToWeekStart(true);
    const view = renderGrid();
    const grid = screen.getByTestId("scheduler-grid");
    const { nudge } = fittedOffsets();

    scrollTo(nudge); // arm the snap
    view.unmount(); // cleanup effect clears snapTimer
    // Advancing past the idle must NOT throw or write (the timer was cleared). The detached node's
    // scrollLeft stays at the nudged value.
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(500);
      }),
    ).not.toThrow();
    expect(grid.scrollLeft).toBe(nudge);
  });
});
