import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { PermissionContext } from "../../auth/permissionContext";
import { useStore } from "../../store/useStore";
import { type Allocation, type Weekday } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, makeResourceDraft } from "../../test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import {
  barFor,
  getStoredAllocation,
  laneRect,
  rect,
  seedAllocation,
} from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

function registerBasicPointerTests() {
  it("commits a move drag to the store (shifts both dates by a day)", () => {
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true })); // +48px ≈ +1 day
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    const moved = getStoredAllocation(a.id);
    expect(moved.startDate).toBe("2026-06-02");
    expect(moved.endDate).toBe("2026-06-04");
  });

  it("does not report a successful move when permission drops to Viewer mid-drag", () => {
    const a = seedAllocation();
    const barUi = (role: "editor" | "viewer") => (
      <PermissionContext.Provider value={{ role, status: "resolved" }}>
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </PermissionContext.Provider>
    );
    const { rerender } = render(barUi("editor"));
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    act(() => useStore.getState().setActiveRole("viewer"));
    rerender(barUi("viewer"));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    expect(useStore.getState().data.allocations.find((row) => row.id === a.id)).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
    });
    expect(useStore.getState().notice).toMatchObject({ tone: "error" });
    expect(useStore.getState().notice?.message).not.toMatch(/moved|reassigned|undo/i);
  });

  it("a click (no movement) opens the editor instead of moving", () => {
    const a = seedAllocation();
    const onEdit = vi.fn();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />);
    const bar = screen.getByTestId("allocation-bar");

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 50, bubbles: true }));

    expect(onEdit).toHaveBeenCalled();
    const unchanged = getStoredAllocation(a.id);
    expect(unchanged.startDate).toBe("2026-06-01");
  });
}

function registerRejectedReassignmentTest() {
  it("leaves assignee, dates and hours unchanged when a diagonal reassign is rejected", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p1 = st.addProject({ name: "P1", clientId: c.id, color: "#2" });
    const p2 = st.addProject({ name: "P2", clientId: c.id, color: "#3" });
    const t1 = st.addActivity({ name: "Wires", kind: "project", projectId: p1.id });
    const person = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    // A placeholder bound to p2 cannot take a p1 activity — dropping onto it must be rejected.
    const slot = st.addResource({
      kind: "placeholder",
      role: "Slot",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#4",
      projectId: p2.id,
    });
    const a = st.addAllocation({
      resourceId: person.id,
      activityId: t1.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    render(
      <>
        <div data-resource-id={person.id} data-testid="lane-src" />
        <div data-resource-id={slot.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    // Cross both a row and a date boundary: rejecting the target must reject the complete gesture,
    // not silently retain its horizontal source-row move.
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, clientY: 125, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, clientY: 125, bubbles: true }));

    const alloc = getStoredAllocation(a.id);
    expect(alloc).toMatchObject({
      resourceId: person.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
    });
    expect(useStore.getState().notice?.message).toMatch(/placeholder/i);
  });
}

function registerValidReassignmentTest() {
  it("reassigns to another row (and highlights it mid-drag) when dropped on a valid lane", () => {
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r1 = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    const r2 = st.addResource({
      kind: "person",
      name: "Sam",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#4",
    });
    const a = st.addAllocation({
      resourceId: r1.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    render(
      <>
        <div data-resource-id={r1.id} data-testid="lane-src" />
        <div data-resource-id={r2.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 55, clientY: 125, bubbles: true }));
    // resourceLaneAt picks lane-dst, markDropTarget highlights exactly that lane.
    expect(screen.getByTestId("lane-dst").hasAttribute("data-droptarget")).toBe(true);
    expect(screen.getByTestId("lane-src").hasAttribute("data-droptarget")).toBe(false);
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 55, clientY: 125, bubbles: true }));

    expect(getStoredAllocation(a.id).resourceId).toBe(r2.id);
    expect(screen.getByTestId("lane-dst").hasAttribute("data-droptarget")).toBe(false); // cleared on commit
  });
}

const workingDayRejectionCases = [
  {
    boundary: "personal",
    accountWorkingDays: [1, 2, 3, 4, 5] as Weekday[],
    targetWorkingDays: [1, 2, 3] as Weekday[],
  },
  {
    boundary: "company",
    accountWorkingDays: [1, 2, 3, 4] as Weekday[],
    targetWorkingDays: [1, 2, 3, 4, 5] as Weekday[],
  },
  {
    boundary: "zero-overlap",
    accountWorkingDays: [1, 2, 3, 4] as Weekday[],
    targetWorkingDays: [5] as Weekday[],
  },
];

function renderReassignmentLanes(sourceId: string, destinationId: string, allocation: Allocation) {
  render(
    <>
      <div data-resource-id={sourceId} data-testid="lane-src" />
      <div data-resource-id={destinationId} data-testid="lane-dst" />
      <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
    </>,
  );
  screen.getByTestId("lane-src").getBoundingClientRect = () => laneRect(0, 50);
  screen.getByTestId("lane-dst").getBoundingClientRect = () => laneRect(100, 150);
}

function verifyWorkingDayRejection({
  accountWorkingDays,
  targetWorkingDays,
}: (typeof workingDayRejectionCases)[number]) {
  const st = useStore.getState();
  st.updateAccount(DEFAULT_ACCOUNT_ID, { workingDays: accountWorkingDays });
  const client = st.addClient({ name: "Acme", color: "#1" });
  const project = st.addProject({ name: "P", clientId: client.id, color: "#2" });
  const activity = st.addActivity({ name: "Wires", kind: "project", projectId: project.id });
  const source = st.addResource({
    kind: "person",
    name: "Jess Chambers",
    role: "Dev",
    employmentType: "permanent",
    engagement: "studio" as const,
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#3",
  });
  const destination = st.addResource({
    kind: "person",
    name: "Marie Moreau",
    role: "PM",
    employmentType: "permanent",
    engagement: "studio" as const,
    workingHoursPerDay: 8,
    workingDays: targetWorkingDays,
    halfDays: [],
    color: "#4",
  });
  const allocation = st.addAllocation({
    resourceId: source.id,
    activityId: activity.id,
    startDate: "2026-06-05", // Friday
    endDate: "2026-06-05",
    hoursPerDay: 8,
    status: "confirmed",
  });

  renderReassignmentLanes(source.id, destination.id, allocation);

  const bar = screen.getByTestId("allocation-bar");
  fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
  document.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 125, bubbles: true }));
  expect(screen.getByTestId("lane-dst")).not.toHaveAttribute("data-droptarget");
  document.dispatchEvent(new MouseEvent("pointerup", { clientX: 50, clientY: 125, bubbles: true }));

  expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toMatchObject({
    resourceId: source.id,
    startDate: "2026-06-05",
    endDate: "2026-06-05",
  });
  expect(useStore.getState().notice).toMatchObject({
    message: "That allocation cannot start there because it is not a working day.",
    tone: "error",
  });
}

function registerWorkingDayRejectionTests() {
  it.each(workingDayRejectionCases)(
    "rejects a purely vertical drop onto a $boundary non-working start date",
    verifyWorkingDayRejection,
  );
}

function registerIgnoredWorkingDayTest() {
  it("allows that literal vertical drop when the allocation ignores working days", () => {
    const st = useStore.getState();
    st.updateAccount(DEFAULT_ACCOUNT_ID, { workingDays: [1, 2, 3, 4] });
    const client = st.addClient({ name: "Acme", color: "#1" });
    const project = st.addProject({ name: "P", clientId: client.id, color: "#2" });
    const activity = st.addActivity({ name: "Wires", kind: "project", projectId: project.id });
    const source = st.addResource({
      kind: "person",
      name: "Jess Chambers",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#3",
    });
    const destination = st.addResource({
      kind: "person",
      name: "Marie Moreau",
      role: "PM",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [5], // no overlap with the company's Mon–Thu week
      halfDays: [],
      color: "#4",
    });
    const allocation = st.addAllocation({
      resourceId: source.id,
      activityId: activity.id,
      startDate: "2026-06-05", // Friday; destination has no effective weekdays under Mon–Thu company days
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
      ignoreWeekends: true,
    });

    render(
      <>
        <div data-resource-id={source.id} data-testid="lane-src" />
        <div data-resource-id={destination.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => laneRect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => laneRect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 125, bubbles: true }));
    expect(screen.getByTestId("lane-dst")).toHaveAttribute("data-droptarget", "");
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 50, clientY: 125, bubbles: true }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toMatchObject({
      resourceId: destination.id,
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      ignoreWeekends: true,
    });
  });
}

function registerDragPreviewTests() {
  it("updates a vertical drag without a trailing transform transition", () => {
    const allocation = seedAllocation();
    render(<AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    const bar = screen.getByTestId("allocation-bar");

    expect(bar).toHaveClass("transition-shadow");
    expect(bar.className).not.toContain("transition-[box-shadow,transform]");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    act(() => {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 75, bubbles: true }));
    });
    expect(bar).toHaveStyle({ transform: "translateY(50px)" });
    act(() => {
      document.dispatchEvent(new Event("pointercancel"));
    });
  });

  it("assigns a shared lane-boundary drop to the following lane", () => {
    const st = useStore.getState();
    const client = st.addClient({ name: "Acme", color: "#1" });
    const project = st.addProject({ name: "P", clientId: client.id, color: "#2" });
    const activity = st.addActivity({ name: "Wires", kind: "project", projectId: project.id });
    const source = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    const destination = st.addResource({
      kind: "person",
      name: "Sam",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#4",
    });
    const allocation = st.addAllocation({
      resourceId: source.id,
      activityId: activity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    render(
      <>
        <div data-resource-id={source.id} data-testid="lane-src" />
        <div data-resource-id={destination.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(allocation)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(50, 100);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 55, clientY: 50, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 55, clientY: 50, bubbles: true }));

    expect(useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.resourceId).toBe(
      destination.id,
    );
  });
}

function registerExternalReassignmentTest() {
  it("keeps an External block at zero hours when it is reassigned to a person", () => {
    const st = useStore.getState();
    st.updateAccount(DEFAULT_ACCOUNT_ID, { schedulingMode: "blocks" });
    const client = st.addClient({ name: "Acme", color: "#1" });
    const project = st.addProject({ name: "P", clientId: client.id, color: "#2" });
    const activity = st.addActivity({ name: "Wires", kind: "project", projectId: project.id });
    const external = st.addResource({
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#3",
    });
    const person = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#4" }));
    const allocation = st.addAllocation({
      resourceId: external.id,
      activityId: activity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 0,
      status: "confirmed",
      ignoreWeekends: true,
    });

    render(
      <>
        <div data-resource-id={external.id} data-testid="lane-src" />
        <div data-resource-id={person.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{ ...barFor(allocation), external: true }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("lane-src").getBoundingClientRect = () => rect(0, 50);
    screen.getByTestId("lane-dst").getBoundingClientRect = () => rect(100, 150);

    const bar = screen.getByTestId("allocation-bar");
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 55, clientY: 125, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 55, clientY: 125, bubbles: true }));

    expect(useStore.getState().data.allocations.find((row) => row.id === allocation.id)).toMatchObject({
      resourceId: person.id,
      hoursPerDay: 0,
    });
  });
}

function registerGeometryRefreshTests() {
  it.each(["scroll", "resize"] as const)(
    "uses post-%s lane rectangles when pointerup precedes the queued animation frame",
    (geometryEvent) => {
      const requestFrame = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 47);
      const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
      try {
        const st = useStore.getState();
        const c = st.addClient({ name: "Acme", color: "#1" });
        const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
        const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
        const r1 = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
        const r2 = st.addResource({
          kind: "person",
          name: "Sam",
          role: "Dev",
          employmentType: "permanent",
          engagement: "studio" as const,
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          color: "#4",
        });
        const a = st.addAllocation({
          resourceId: r1.id,
          activityId: t.id,
          startDate: "2026-06-01",
          endDate: "2026-06-03",
          hoursPerDay: 8,
          status: "confirmed",
        });

        render(
          <>
            <div data-resource-id={r1.id} data-testid="lane-src" />
            <div data-resource-id={r2.id} data-testid="lane-dst" />
            <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
          </>,
        );
        let geometryChanged = false;
        screen.getByTestId("lane-src").getBoundingClientRect = () => (geometryChanged ? rect(100, 150) : rect(0, 50));
        screen.getByTestId("lane-dst").getBoundingClientRect = () =>
          geometryChanged ? rect(200, 250) : rect(100, 150);

        const bar = screen.getByTestId("allocation-bar");
        fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 });
        document.dispatchEvent(new MouseEvent("pointermove", { clientX: 55, clientY: 125, bubbles: true }));
        expect(screen.getByTestId("lane-dst")).toHaveAttribute("data-droptarget");

        geometryChanged = true;
        const eventTarget = geometryEvent === "scroll" ? document : window;
        eventTarget.dispatchEvent(new Event(geometryEvent));
        expect(requestFrame).toHaveBeenCalledOnce();
        document.dispatchEvent(new MouseEvent("pointerup", { clientX: 55, clientY: 225, bubbles: true }));

        expect(cancelFrame).toHaveBeenCalledWith(47);
        expect(getStoredAllocation(a.id).resourceId).toBe(r2.id);
      } finally {
        requestFrame.mockRestore();
        cancelFrame.mockRestore();
      }
    },
  );
}

describe("AllocationBar pointer drag and reassignment interactions", () => {
  registerBasicPointerTests();
  registerRejectedReassignmentTest();
  registerValidReassignmentTest();
  registerWorkingDayRejectionTests();
  registerIgnoredWorkingDayTest();
  registerDragPreviewTests();
  registerExternalReassignmentTest();
  registerGeometryRefreshTests();
});
