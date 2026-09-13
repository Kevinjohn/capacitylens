import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationBar } from "./AllocationBar";
import { PermissionContext } from "../../auth/permissionContext";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount } from "../../test/fixtures";
import { buildVisibleRange } from "../../store/selectors";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import { barFor, getStoredAllocation, seedAllocation } from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

function registerViewerPopoverTest() {
  it("keeps Viewer details in the tab order without enabling allocation edits", async () => {
    const user = userEvent.setup();
    const allocation = seedAllocation({ note: "Call the client before kickoff" });
    const onEdit = vi.fn();
    useStore.getState().setBarLabelPref("showClient", false);
    useStore.getState().setBarLabelPref("showProject", false);
    render(
      <PermissionContext.Provider value={{ role: "viewer", status: "resolved" }}>
        <AllocationBar
          bar={{ ...barFor(allocation), project: "Project Watchtower", client: "Acme" }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={onEdit}
        />
      </PermissionContext.Provider>,
    );
    const bar = screen.getByTestId("allocation-bar");

    expect(bar).toHaveAttribute("role", "img");
    expect(bar).toHaveAttribute("tabindex", "0");
    expect(bar).not.toHaveTextContent("Project Watchtower");
    expect(bar).not.toHaveTextContent("Acme");
    expect(screen.queryByTestId("resize-start")).toBeNull();
    expect(screen.queryByTestId("resize-end")).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(bar);
    const popover = screen.getByTestId("allocation-popover");
    expect(popover).toHaveTextContent("Project Watchtower");
    expect(popover).toHaveTextContent("Call the client before kickoff");
    expect(popover.querySelector(".text-2xs.text-faint")).toBeNull();
    expect(bar).toHaveAccessibleDescription("Read-only allocation details");
    expect(popover).not.toHaveTextContent(/drag|resize|reassign/i);
    expect(bar).toHaveAccessibleName(
      /Wires, Project Watchtower · Acme, 8h per day, 1 Jun to 3 Jun, note: Call the client before kickoff\./,
    );
    expect(bar).not.toHaveAccessibleName(/Confirmed/);
    const details = [...popover.querySelectorAll("div.text-muted-foreground")].find((element) =>
      element.textContent.includes("h/day"),
    );
    expect(details).toBeDefined();
    expect(details).toHaveTextContent("1 – 3 Jun · 8h/day");
    expect(details).not.toHaveTextContent("Confirmed");

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("allocation-popover")).toBeNull();
    expect(document.activeElement).toBe(bar);

    await user.keyboard("{Enter}{Space}{ArrowRight}");
    expect(onEdit).not.toHaveBeenCalled();
    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toEqual(
      allocation,
    );
  });

  it("omits the confirmed annotation cleanly when hours are hidden", () => {
    const allocation = seedAllocation();
    render(
      <AllocationBar
        bar={{ ...barFor(allocation), external: true }}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.mouseEnter(bar);
    const popover = screen.getByTestId("allocation-popover");
    const details = popover.querySelector("div.text-muted-foreground");
    expect(details).toHaveTextContent("1 – 3 Jun");
    expect(details).not.toHaveTextContent(/Confirmed| ·/);
    expect(bar).toHaveAccessibleName(/Wires, 1 Jun to 3 Jun\./);
    expect(bar).not.toHaveAccessibleName(/Confirmed|, ,/);
  });

  it.each([
    ["tentative", "Tentative"],
    ["completed", "Completed"],
  ] as const)("keeps the %s annotation in popover and accessible name", (status, label) => {
    const allocation = seedAllocation({ status });
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.mouseEnter(bar);
    expect(screen.getByTestId("allocation-popover").querySelector("div.text-muted-foreground")).toHaveTextContent(
      `1 – 3 Jun · 8h/day · ${label}`,
    );
    expect(bar).toHaveAccessibleName(new RegExp(`8h per day, ${label}, 1 Jun to 3 Jun\\.`));
  });
}

function registerFocusPopoverTests() {
  it("closes an open popover on Escape while KEEPING focus on the bar", () => {
    const allocation = seedAllocation();
    render(
      <AllocationBar
        bar={{ ...barFor(allocation), project: "Project Watchtower", client: "Acme" }}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("allocation-bar");

    act(() => bar.focus());
    expect(document.activeElement).toBe(bar);
    expect(screen.getByTestId("allocation-popover")).toBeInTheDocument();

    fireEvent.keyDown(bar, { key: "Escape" });
    expect(screen.queryByTestId("allocation-popover")).toBeNull();
    expect(document.activeElement).toBe(bar);
  });

  it("reopens on a fresh focus EDGE (blur then refocus) after an Escape-close", () => {
    const allocation = seedAllocation();
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    act(() => bar.focus());
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(screen.queryByTestId("allocation-popover")).toBeNull();

    act(() => bar.blur());
    act(() => bar.focus());
    expect(screen.getByTestId("allocation-popover")).toBeInTheDocument();
  });
}

function registerEscapeRoutingTests() {
  it("does NOT swallow Escape mid-drag — the gesture hook still cancels the drag", () => {
    const allocation = seedAllocation();
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(allocation.id);

    fireEvent.keyDown(bar, { key: "Escape" });
    expect(getStoredAllocation(allocation.id).startDate).toBe("2026-06-01");
    expect(useStore.getState().draggingAllocationId).toBeNull();

    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 300, bubbles: true }));
    expect(getStoredAllocation(allocation.id).startDate).toBe("2026-06-01");
  });

  it("lets Escape PROPAGATE to ancestor handlers when the popover is closed", () => {
    const allocation = seedAllocation();
    const ancestorEsc = vi.fn();
    render(
      <div data-testid="ancestor" onKeyDown={(event) => event.key === "Escape" && ancestorEsc()}>
        <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </div>,
    );
    const bar = screen.getByTestId("allocation-bar");

    expect(screen.queryByTestId("allocation-popover")).toBeNull();
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(ancestorEsc).toHaveBeenCalledTimes(1);

    act(() => bar.focus());
    expect(screen.getByTestId("allocation-popover")).toBeInTheDocument();
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(screen.queryByTestId("allocation-popover")).toBeNull();
    expect(ancestorEsc).toHaveBeenCalledTimes(1);
  });
}

function registerEscapePopoverTests() {
  registerViewerPopoverTest();
  registerFocusPopoverTests();
  registerEscapeRoutingTests();
}

function registerPopoverAndEditorTests() {
  it("shows a detail popover on hover and hides it on leave", () => {
    const a = seedAllocation();
    render(
      <AllocationBar
        bar={{ ...barFor(a), project: "Project Watchtower", client: "Acme" }}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("allocation-bar");

    expect(screen.queryByTestId("allocation-popover")).toBeNull();
    fireEvent.mouseEnter(bar);
    const pop = screen.getByTestId("allocation-popover");
    expect(pop).toHaveTextContent("Project Watchtower");
    expect(pop).toHaveTextContent("Acme");
    expect(pop.querySelector(".text-2xs.text-faint")).toBeNull();
    expect(bar).toHaveAccessibleDescription("Drag to move · edges to resize · drop on another row to reassign");
    fireEvent.mouseLeave(bar);
    expect(screen.queryByTestId("allocation-popover")).toBeNull();
  });

  describe("Escape closes the focus popover (keyboard accessibility)", registerEscapePopoverTests);

  it("opens the editor on Enter (keyboard operable)", () => {
    const a = seedAllocation();
    const onEdit = vi.fn();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "Enter" });
    expect(onEdit).toHaveBeenCalled();
  });
}

function registerKeyboardMovementTests() {
  it("moves with arrow keys and resizes with Shift+arrow (keyboard equivalent of drag)", () => {
    const a = seedAllocation(); // 2026-06-01 → 2026-06-03
    const { rerender } = render(
      <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    let moved = getStoredAllocation(a.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-02", "2026-06-04"]);

    // Reflect the new dates in the bar prop (as the grid would re-render), then resize the end.
    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    moved = getStoredAllocation(a.id);
    expect([moved.startDate, moved.endDate]).toEqual(["2026-06-02", "2026-06-05"]); // end extended, start fixed
  });

  it("rejects and announces a keyboard move beyond the person's availability", () => {
    const allocation = seedAllocation();
    useStore.getState().updateResource(allocation.resourceId, { lastAvailableDate: "2026-06-03" });
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });

    expect(getStoredAllocation(allocation.id)).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
    });
    expect(useStore.getState().notice).toMatchObject({ tone: "error" });
    expect(useStore.getState().notice?.message).toMatch(/after this person is available/i);
  });

  it("refuses a keyboard nudge that would unmount the bar beyond the visible timeline", () => {
    useStore.getState().setOriginDate("2026-06-01");
    useStore.getState().setZoom(1);
    const lastVisibleDay = buildVisibleRange(useStore.getState().ui).end;
    const allocation = seedAllocation({
      startDate: lastVisibleDay,
      endDate: lastVisibleDay,
      ignoreWeekends: true,
    });
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toMatchObject({
      startDate: lastVisibleDay,
      endDate: lastVisibleDay,
    });
    expect(useStore.getState().notice?.message).toMatch(/outside the visible timeline/i);
  });
}

function registerKeyboardFocusTests() {
  it("keeps a keyboard-moved bar focused and scrolls it to the nearest visible position", () => {
    useStore.getState().setOriginDate("2026-06-01");
    useStore.getState().setZoom(1);
    const allocation = seedAllocation();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const scrollIntoView = vi.fn();
    try {
      render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
      const bar = screen.getByTestId("allocation-bar");
      bar.scrollIntoView = scrollIntoView;
      bar.focus();

      fireEvent.keyDown(bar, { key: "ArrowRight" });

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      expect(bar).toHaveFocus();
    } finally {
      raf.mockRestore();
    }
  });
}

function registerKeyboardFocusRaceTests() {
  it("cancels replaced focus work and runs only the latest keyboard operation", () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const allocation = seedAllocation();
    const { unmount } = render(
      <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );

    try {
      const bar = screen.getByTestId("allocation-bar");
      fireEvent.keyDown(bar, { key: "ArrowRight" });
      fireEvent.keyDown(bar, { key: "ArrowRight" });

      expect(cancelFrame).toHaveBeenCalledWith(1);
      expect(requestFrame).toHaveBeenCalledTimes(2);
      callbacks[1]?.(0);
      expect(bar).toHaveFocus();
    } finally {
      unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("cancels pending keyboard focus when the allocation bar unmounts", () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 41);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const allocation = seedAllocation();
    const { unmount } = render(
      <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />,
    );

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    unmount();

    expect(cancelFrame).toHaveBeenCalledWith(41);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("does not focus a matching allocation id after the active account changes", () => {
    let callback: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 51;
    });
    const allocation = seedAllocation();
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");
    const focus = vi.spyOn(bar, "focus");

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    useStore.setState({ activeAccountId: "other-account" });
    callback?.(0);

    expect(focus).not.toHaveBeenCalled();
    requestFrame.mockRestore();
  });
}

function registerKeyboardPinnedTest() {
  it("does not write, add undo history or announce when a keyboard resize is pinned", () => {
    const allocation = seedAllocation({ startDate: "2026-06-06", endDate: "2026-06-07" });
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const before = useStore.getState();
    const storedBefore = before.data.allocations.find((candidate) => candidate.id === allocation.id);

    // Alt resizes the start edge. Advancing within this weekend-only span must pin to the original
    // Saturday rather than snapping backward to Friday and widening the allocation.
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", altKey: true });

    const after = useStore.getState();
    expect(after.data.allocations.find((candidate) => candidate.id === allocation.id)).toBe(storedBefore);
    expect(after.past).toBe(before.past);
    expect(after.srAnnouncement).toBeNull();
  });
}

describe("AllocationBar keyboard focus and popover interactions", () => {
  registerPopoverAndEditorTests();
  registerKeyboardMovementTests();
  registerKeyboardFocusTests();
  registerKeyboardFocusRaceTests();
  registerKeyboardPinnedTest();
});
