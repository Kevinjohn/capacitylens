import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { PermissionContext } from "../../auth/permissionContext";
import type { BarLayout } from "./schedulerModel";
import { useStore } from "../../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Allocation } from "@capacitylens/shared/types/entities";
import { makeAccount, makeAllocation as makeAllocationBase, makeBar as makeBarBase } from "../../test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";
import { LAYOUT } from "./layout";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  // Device-global prefs persist across tests via localStorage — reset to defaults.
  useStore.getState().setBarLabelPref("showClient", true);
  useStore.getState().setBarLabelPref("showProject", true);
});

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return makeAllocationBase({
    id: "alloc-1",
    accountId: "acct-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    resourceId: "res-1",
    activityId: "activity-1",
    startDate: "2026-06-01",
    endDate: "2026-06-07",
    ...overrides,
  });
}

function makeBar(allocation: Allocation, labelOverride?: string): BarLayout {
  return makeBarBase({ allocation, width: 336, color: "#ec4899", label: labelOverride ?? "My Activity" });
}

function setTaskFieldVisibility(enabled: boolean) {
  useStore.getState().replaceAll({ ...emptyAppData(), accounts: [makeAccount({ showTaskFieldInSchedule: enabled })] });
  useStore.getState().setActiveAccount("acct-test");
}

describe("AllocationBar rendering", () => {
  it('shows the label and hours and has data-status="confirmed"', () => {
    const allocation = makeAllocation();
    const bar = makeBar(allocation);
    const onEdit = vi.fn();

    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveAttribute("data-status", "confirmed");
    expect(el).toHaveTextContent("My Activity");
    expect(el).toHaveTextContent("8h");
  });

  // #786: a bar that began before the visible window used to carry its label off-screen with it.
  // The bar publishes its own geometry and the label overlay clamps to the intersection of that
  // geometry with the scroll container's viewport, so no bar needs its own scroll listener.
  it("positions the label over the bar's visible portion rather than its start", () => {
    const bar = makeBar(makeAllocation());

    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const barElement = screen.getByTestId("allocation-bar");
    expect(barElement.style.getPropertyValue("--bar-left")).toBe(`${LAYOUT.barInset}px`);
    expect(barElement.style.getPropertyValue("--bar-width")).toBe(`${bar.width - LAYOUT.barInset * 2}px`);

    const label = screen.getByTestId("allocation-bar-label");
    const insets = buildVisibleSpanInsets("x", "var(--bar-left)", "var(--bar-width)");
    expect(label.style.left).toBe(insets.leading);
    expect(label.style.right).toBe(insets.trailing);
    // Centred within that clamped box, and inert so the resize grips underneath stay hittable.
    expect(label).toHaveClass("justify-center", "pointer-events-none");
  });

  it("shows the label from the bar object", () => {
    const allocation = makeAllocation();
    const bar = makeBar(allocation, "Sprint Planning");
    const onEdit = vi.fn();

    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveTextContent("Sprint Planning");
  });

  it("shows a linked-series icon without crowding narrow bars and omits it for legacy unlinked repeats", () => {
    const linked = makeBar(makeAllocation({ seriesId: "series-1" }));
    linked.seriesEnd = "2026-08-31";
    const { rerender } = render(
      <AllocationBar bar={linked} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.getByTestId("allocation-series-icon")).toBeInTheDocument();

    rerender(
      <AllocationBar bar={{ ...linked, width: 40 }} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.queryByTestId("allocation-series-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("allocation-bar")).toHaveAccessibleName(/series through 31 Aug/i);

    rerender(
      <AllocationBar bar={makeBar(makeAllocation())} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );
    expect(screen.queryByTestId("allocation-series-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("allocation-bar")).not.toHaveAccessibleName(/series through/i);
  });

  it("shows the last surviving series end in the hover and focus details", () => {
    const bar = makeBar(makeAllocation({ seriesId: "series-1" }));
    bar.seriesEnd = "2026-08-31";
    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByTestId("allocation-bar"));
    expect(screen.getByTestId("allocation-popover")).toHaveTextContent("Series through 31 Aug");
    expect(screen.getByTestId("allocation-bar")).toHaveAccessibleName(/series through 31 Aug/i);
  });
  registerAllocationBarRenderingModeTests();
});

function registerAllocationBarRenderingModeTests() {
  it("shows just the activity when the bar carries no client/project metadata", () => {
    render(
      <AllocationBar bar={makeBar(makeAllocation())} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );

    // No stray "·" separator ahead of the activity name.
    const el = screen.getByTestId("allocation-bar");
    expect(el.textContent).toMatch(/^My Activity/);
  });

  it("hides hours in blocks mode, showing the activity name only", () => {
    const data = emptyAppData();
    data.accounts = [
      { id: "acct-test", createdAt: "t", updatedAt: "t", name: "Co", color: "#111", schedulingMode: "blocks" },
    ];
    useStore.getState().replaceAll(data);
    useStore.getState().setActiveAccount("acct-test");

    const bar = makeBar(makeAllocation());
    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveTextContent("My Activity");
    expect(el).not.toHaveTextContent("8h");
    // The accessible name must not announce a meaningless load either.
    expect(el.getAttribute("aria-label")).not.toMatch(/per day/);
  });
}

describe("AllocationBar client/project context", () => {
  const barWithContext = (): BarLayout => ({
    ...makeBar(makeAllocation()),
    client: "Queen Consolidated",
    project: "Watchtower",
  });

  it("prefixes the label with client and project by default", () => {
    render(<AllocationBar bar={barWithContext()} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveTextContent("Queen Consolidated · Watchtower · My Activity");
    // The accessible name carries the same context.
    expect(el.getAttribute("aria-label")).toContain("Queen Consolidated · Watchtower · My Activity");
  });

  it("omits the client when showClient is off", () => {
    useStore.getState().setBarLabelPref("showClient", false);
    render(<AllocationBar bar={barWithContext()} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveTextContent("Watchtower · My Activity");
    expect(el).not.toHaveTextContent("Queen Consolidated");
  });

  it("omits the project when showProject is off", () => {
    useStore.getState().setBarLabelPref("showProject", false);
    render(<AllocationBar bar={barWithContext()} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el).toHaveTextContent("Queen Consolidated · My Activity");
    expect(el).not.toHaveTextContent("Watchtower");
  });

  it("shows only the activity when both toggles are off", () => {
    useStore.getState().setBarLabelPref("showClient", false);
    useStore.getState().setBarLabelPref("showProject", false);
    render(<AllocationBar bar={barWithContext()} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const el = screen.getByTestId("allocation-bar");
    expect(el.textContent).toMatch(/^My Activity/);
    expect(el).not.toHaveTextContent("Queen Consolidated");
    expect(el).not.toHaveTextContent("Watchtower");
  });
});

describe("AllocationBar accessible name (status / dates / note)", () => {
  it("speaks the HUMANISED status and FORMATTED dates, not the raw enum + ISO (WCAG 1.1.1)", () => {
    const bar = makeBar(makeAllocation({ status: "tentative", startDate: "2026-06-01", endDate: "2026-06-05" }));
    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    const label = screen.getByTestId("allocation-bar").getAttribute("aria-label") ?? "";
    // Humanised status (allocationStatusLabels) + 'd MMM' dates — matches the hover popover.
    expect(label).toContain("Tentative");
    expect(label).toContain("1 Jun");
    expect(label).toContain("5 Jun");
    // The raw enum + ISO must NOT leak into the accessible name.
    expect(label).not.toContain("tentative");
    expect(label).not.toContain("2026-06-01");
  });

  it('appends a "has note" cue when the allocation carries a note (WCAG 1.1.1)', () => {
    const withNote = makeBar(makeAllocation({ note: "Call the client first" }));
    render(<AllocationBar bar={withNote} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    expect(screen.getByTestId("allocation-bar").getAttribute("aria-label")).toContain("has note");
  });

  it('omits the "has note" cue when there is no note', () => {
    const noNote = makeBar(makeAllocation());
    render(<AllocationBar bar={noNote} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    expect(screen.getByTestId("allocation-bar").getAttribute("aria-label")).not.toContain("has note");
  });

  it("announces task text to a viewer only when the account setting enables it", () => {
    const allocation = makeAllocation({ task: "Review a deliberately long task description" });
    setTaskFieldVisibility(true);
    const { rerender } = render(
      <PermissionContext.Provider value={{ role: "viewer", status: "resolved" }}>
        <AllocationBar bar={makeBar(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </PermissionContext.Provider>,
    );
    expect(screen.getByTestId("allocation-bar")).toHaveAccessibleName(
      /task: Review a deliberately long task description/i,
    );

    setTaskFieldVisibility(false);
    rerender(
      <PermissionContext.Provider value={{ role: "viewer", status: "resolved" }}>
        <AllocationBar bar={makeBar(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </PermissionContext.Provider>,
    );
    expect(screen.getByTestId("allocation-bar")).not.toHaveAccessibleName(/task:/i);
  });

  it("wraps a long task token in the fixed-width popover", () => {
    setTaskFieldVisibility(true);
    const task = "a".repeat(180);
    const allocation = makeAllocation({ task });
    render(<AllocationBar bar={makeBar(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByTestId("allocation-bar"));
    expect(screen.getByTestId("allocation-popover").querySelector("div.break-words")).toHaveTextContent(task);
  });
});

describe("AllocationBar click interaction", () => {
  it("calls onEdit when pointerDown and pointerUp occur at the same clientX (no movement)", () => {
    const allocation = makeAllocation();
    const bar = makeBar(allocation);
    const onEdit = vi.fn();

    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);

    const el = screen.getByTestId("allocation-bar");

    // pointerDown on the bar body (not a resize handle) with button 0
    fireEvent.pointerDown(el, { clientX: 100, button: 0 });

    // pointerUp on document at the same clientX — no movement, so onClick fires
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, bubbles: true }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not call onEdit when pointerDown uses a non-primary button", () => {
    const allocation = makeAllocation();
    const bar = makeBar(allocation);
    const onEdit = vi.fn();

    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);

    const el = screen.getByTestId("allocation-bar");

    // button: 2 is right-click — the handler early-returns
    fireEvent.pointerDown(el, { clientX: 100, button: 2 });
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, bubbles: true }));

    expect(onEdit).not.toHaveBeenCalled();
  });
});
