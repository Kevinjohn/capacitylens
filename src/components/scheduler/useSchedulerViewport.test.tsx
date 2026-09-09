import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useSchedulerViewport } from "./useSchedulerViewport";
import { useStore } from "../../store/useStore";

// resolveWeekStartSnapTarget uses resolveLeftEdgeDate, which delegates rounding to indexAtScroll
// (see resolveWeekStartSnapTarget.ts's "SUB-PIXEL ROUNDING" note and its corresponding test file).
// This file pins the same rounding for onScroll's leftEdgeIdx, visibleStartDate and the dragging-end
// effect. Each resolves a fractional scrollLeft to the column it is essentially already at rather
// than the previous (narrower, under minimised weekends) one.

// A minimal DOM harness: useSchedulerViewport owns a ref, not a rendered element, so the hook
// must be driven through a real scrollable node (renderHook alone never attaches one). Mirrors
// SchedulerGrid.test.tsx's "Feature 2" wiring tests — same clientWidth stub + synchronous rAF —
// but stripped to just the viewport hook, no grid chrome.
function Harness({
  minimiseWeekends = false,
  snapToWeekStart = false,
  calendarWeekStartsOn = 1,
}: {
  minimiseWeekends?: boolean;
  snapToWeekStart?: boolean;
  calendarWeekStartsOn?: 0 | 1;
}) {
  const ui = useStore((s) => s.ui);
  const { scrollRef, leftEdgeIdx, onScroll, visibleStartDate, geom } = useSchedulerViewport({
    ui,
    minimiseWeekends,
    snapToWeekStart,
    calendarWeekStartsOn,
  });
  return (
    <div ref={scrollRef} data-testid="scroll" onScroll={onScroll} style={{ overflow: "auto" }}>
      <div data-testid="left-edge-idx">{leftEdgeIdx}</div>
      <div data-testid="visible-start">{visibleStartDate()}</div>
      <div data-testid="focus-x">{geom.xForDateInGeom(ui.focusDate)}</div>
      <div data-testid="boundary-2">{geom.x(2)}</div>
      <div data-testid="boundary-3">{geom.x(3)}</div>
    </div>
  );
}

function setupViewport() {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  useStore.setState((state) => ({
    ui: {
      ...state.ui,
      originDate: "2026-06-01",
      focusDate: "2026-06-01",
      zoom: 1,
      rangeDays: 120,
      collapsedGroups: [],
    },
    draggingAllocationId: null,
  }));
}

function teardownViewport() {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
}

describe("useSchedulerViewport — HiDPI sub-pixel scrollLeft rounding", () => {
  beforeEach(setupViewport);
  afterEach(teardownViewport);

  it("onScroll resolves a scrollLeft fractionally below a column boundary to that column, not the previous one", () => {
    render(<Harness />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-2").textContent); // index 2 → 2026-06-03

    act(() => {
      grid.scrollLeft = boundary - 0.4;
      grid.dispatchEvent(new Event("scroll"));
    });

    // Without rounding, indexAt's strict floor would resolve boundary - 0.4 to index 1
    // (2026-06-02) — the previous column. Rounded first, it lands on the boundary column.
    expect(screen.getByTestId("left-edge-idx").textContent).toBe("2");
    expect(screen.getByTestId("visible-start").textContent).toBe("2026-06-03");
    expect(grid.style.getPropertyValue("--sched-scroll-left")).toBe(`${boundary - 0.4}px`);
  });

  it("onScroll still resolves an exact boundary scrollLeft to that column (rounding is a no-op there)", () => {
    render(<Harness />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-2").textContent);

    act(() => {
      grid.scrollLeft = boundary;
      grid.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByTestId("left-edge-idx").textContent).toBe("2");
    expect(screen.getByTestId("visible-start").textContent).toBe("2026-06-03");
  });

  it("the drag-end resync effect (a third unrounded indexAt call site) resolves the same sub-pixel scrollLeft correctly", () => {
    // Drives the `!dragging` effect (leftEdgeIdx resync when a drag ends) rather than onScroll —
    // it reads scrollRef.current.scrollLeft directly through the same geom.indexAt call.
    useStore.setState({ draggingAllocationId: "a1" });
    render(<Harness />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-3").textContent); // index 3 → 2026-06-04

    act(() => {
      grid.scrollLeft = boundary - 0.4;
    });
    act(() => {
      useStore.setState({ draggingAllocationId: null }); // drag ends → resync effect fires
    });

    expect(screen.getByTestId("left-edge-idx").textContent).toBe("3");
    expect(screen.getByTestId("visible-start").textContent).toBe("2026-06-04");
  });
});

describe("useSchedulerViewport — viewport changes", () => {
  beforeEach(setupViewport);
  afterEach(teardownViewport);

  it("recenters with the new commit's focus offset after origin and focus change together", () => {
    render(<Harness />);
    const grid = screen.getByTestId("scroll");
    expect(grid.scrollLeft).toBe(0);

    act(() => {
      useStore.setState((state) => ({
        ui: {
          ...state.ui,
          originDate: "2026-08-01",
          focusDate: "2026-08-15",
          recenterToken: state.ui.recenterToken + 1,
        },
      }));
    });

    const currentFocusX = Number(screen.getByTestId("focus-x").textContent);
    expect(currentFocusX).toBeGreaterThan(0);
    expect(grid.scrollLeft).toBe(currentFocusX);
    expect(grid.style.getPropertyValue("--sched-scroll-left")).toBe(`${currentFocusX}px`);
  });

  it("clamps a zoom anchor whose week start falls before the timeline origin", () => {
    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        originDate: "2026-06-03", // Wednesday; Monday week-start lies before column zero
        focusDate: "2026-06-03",
      },
    }));
    render(<Harness calendarWeekStartsOn={1} />);
    const grid = screen.getByTestId("scroll");

    act(() => {
      grid.scrollLeft = 0;
      grid.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      useStore.setState((state) => ({ ui: { ...state.ui, zoom: 2 } }));
    });

    expect(grid.scrollLeft).toBe(0);
  });
});

describe("useSchedulerViewport — pending week snapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupViewport();
  });
  afterEach(() => {
    teardownViewport();
    vi.useRealTimers();
  });

  it("cancels an idle snap when snapping is disabled before the timer fires", () => {
    const { rerender } = render(<Harness snapToWeekStart />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-2").textContent);

    act(() => {
      grid.scrollLeft = boundary;
      grid.dispatchEvent(new Event("scroll"));
    });
    rerender(<Harness snapToWeekStart={false} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.runAllTimers();
    });

    expect(grid.scrollLeft).toBe(boundary);
  });

  it("cancels an idle snap when the calendar week changes", () => {
    const { rerender } = render(<Harness snapToWeekStart calendarWeekStartsOn={1} />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-2").textContent);

    act(() => {
      grid.scrollLeft = boundary;
      grid.dispatchEvent(new Event("scroll"));
    });
    rerender(<Harness snapToWeekStart calendarWeekStartsOn={0} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.runAllTimers();
    });

    expect(grid.scrollLeft).toBe(boundary);
  });

  it("cancels an idle snap when zoom changes semantic geometry", () => {
    render(<Harness snapToWeekStart />);
    const grid = screen.getByTestId("scroll");

    act(() => {
      grid.scrollLeft = Number(screen.getByTestId("boundary-2").textContent);
      grid.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      useStore.setState((state) => ({ ui: { ...state.ui, zoom: 2 } }));
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useSchedulerViewport — week snap lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupViewport();
  });
  afterEach(() => {
    teardownViewport();
    vi.useRealTimers();
  });

  it("cancels a pending animation frame and permits new scroll work after semantics change", () => {
    const requestFrame = vi.mocked(window.requestAnimationFrame).mockImplementation(() => 42);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const { rerender } = render(<Harness snapToWeekStart />);
    const grid = screen.getByTestId("scroll");

    act(() => {
      grid.dispatchEvent(new Event("scroll"));
    });
    rerender(<Harness snapToWeekStart={false} />);

    expect(cancelFrame).toHaveBeenCalledWith(42);
    act(() => {
      grid.dispatchEvent(new Event("scroll"));
    });
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("snaps normally when its semantics remain current", () => {
    render(<Harness snapToWeekStart />);
    const grid = screen.getByTestId("scroll");
    const boundary = Number(screen.getByTestId("boundary-2").textContent);

    act(() => {
      grid.scrollLeft = boundary;
      grid.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });

    expect(grid.scrollLeft).toBe(0);
  });

  it("clears an idle snap when the viewport unmounts", () => {
    const { unmount } = render(<Harness snapToWeekStart />);
    const grid = screen.getByTestId("scroll");

    act(() => {
      grid.scrollLeft = Number(screen.getByTestId("boundary-2").textContent);
      grid.dispatchEvent(new Event("scroll"));
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
