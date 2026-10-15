import { describe, it, expect, beforeEach, vi } from "vitest";
import { memo } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAllocation } from "@/test/fixtures";
import { schedulerDataset } from "./__tests__/schedulerTestKit";

// A draw-mode toggle updates the bars layer's inert state without rerendering memoized AllocationBar children. The fixture keeps the real grid and lane boundaries and replaces only the leaf bar with a render counter; it tests callback stability, not every possible geometry invalidation.
const barRenderCount = vi.fn();
vi.mock("./AllocationBar", () => ({
  AllocationBar: memo(function AllocationBarSpy({ bar }: { bar: { allocation: { id: string } } }) {
    barRenderCount();
    return <div data-testid="allocation-bar" data-alloc-id={bar.allocation.id} />;
  }),
}));

const ACC = DEFAULT_ACCOUNT_ID;

function dataset() {
  return schedulerDataset({
    allocations: [
      makeAllocation({ accountId: ACC }),
      makeAllocation({ id: "a2", accountId: ACC, startDate: "2026-06-04", endDate: "2026-06-05" }),
    ],
  });
}

beforeEach(() => {
  barRenderCount.mockClear();
  useStore.getState().replaceAll(dataset());
  useStore.getState().setActiveAccount(ACC);
  useStore.getState().setOriginDate("2026-06-01");
  useStore.getState().setZoom(1);
  useStore.getState().setDrawMode("work");
  useStore.getState().clearFilters();
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [] } }));
});

describe("draw-mode toggle does not re-render allocation bars", () => {
  it("toggling to Time off re-renders only the BarsLayer (inert) — the bars bail", async () => {
    const { SchedulerGrid } = await import("./SchedulerGrid");
    // The scheduler uses router navigation, so render the fixture inside a Router.
    render(<SchedulerGrid />, { wrapper: MemoryRouter });

    expect(screen.getAllByTestId("allocation-bar")).toHaveLength(2);
    const beforeToggle = barRenderCount.mock.calls.length;
    expect(beforeToggle).toBeGreaterThan(0);

    act(() => {
      useStore.getState().setDrawMode("timeoff");
    });

    expect(barRenderCount.mock.calls.length).toBe(beforeToggle);

    const bar = screen.getAllByTestId("allocation-bar")[0];
    expect(bar).toBeDefined();
    if (!bar) throw new Error("Expected the allocation bar to render.");
    const barsLayer = bar.parentElement;
    expect(barsLayer).not.toBeNull();
    if (!barsLayer) throw new Error("Expected the allocation bar container to render.");
    expect(barsLayer).toHaveAttribute("inert");

    act(() => {
      useStore.getState().setDrawMode("work");
    });
    expect(barRenderCount.mock.calls.length).toBe(beforeToggle);
    expect(barsLayer).not.toHaveAttribute("inert");
  });
});
