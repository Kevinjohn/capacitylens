import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { makeResourceDraft } from "../../test/fixtures";
import { PermissionContext } from "../../auth/permissionContext";
import { chooseOption } from "./__tests__/schedulerTestKit";
import { first, ACC, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

type CapacityAdvisoryMockInput =
  | Parameters<typeof import("../../lib/capacity").buildCapacityAdvisory>[0]
  | Parameters<typeof import("../../lib/capacity").buildCapacityAdvisoryFromLoad>[0];
const capacityAdvisoryMock = vi.hoisted(() =>
  vi.fn<(input: CapacityAdvisoryMockInput) => { overDays: number; timeOffDays: number }>(() => ({
    overDays: 0,
    timeOffDays: 0,
  })),
);
// Both entry points share one mock: the repeat path advises against a batch-shared load bucket
// (`buildCapacityAdvisoryFromLoad`), the single-allocation path buckets its own window, and these tests
// care only about the advisory VERDICTS the modal renders.
vi.mock("../../lib/capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/capacity")>()),
  buildCapacityAdvisory: capacityAdvisoryMock,
  buildCapacityAdvisoryFromLoad: capacityAdvisoryMock,
}));

beforeEach(() => {
  resetAllocationModalStore();
  capacityAdvisoryMock.mockClear();
  capacityAdvisoryMock.mockImplementation(() => ({ overDays: 0, timeOffDays: 0 }));
});

function addInlineActivityTestPerson() {
  useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
  return first(useStore.getState().data.resources).id;
}

describe("AllocationModal inline activity creation pref", () => {
  it('renders the inline "Add activity" input + button when explicitly enabled', () => {
    const resourceId = addInlineActivityTestPerson();
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("New activity name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add activity" })).toBeInTheDocument();
  });

  it("places an inline-created project activity in the project-specific group", async () => {
    useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const resourceId = addInlineActivityTestPerson();
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await user.type(screen.getByLabelText("New activity name"), "Alpha delivery");
    await user.click(screen.getByRole("button", { name: "Add activity" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Activity" }), { key: "ArrowDown" });

    const allProjectsGroup = screen.getByRole("group", { name: "All projects" });
    const projectGroup = screen.getByRole("group", { name: "Project-specific" });
    expect(screen.getAllByRole("group", { name: "Project-specific" })).toHaveLength(1);
    expect(allProjectsGroup.compareDocumentPosition(projectGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Project-specific" })).getByRole("option", {
        name: "Alpha delivery",
      }),
    ).toBeInTheDocument();
  });
  it('hides the inline "Add activity" controls by default while retaining the Activity picker', () => {
    const resourceId = addInlineActivityTestPerson();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("New activity name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add activity" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Activity" })).toBeInTheDocument();
  });

  it('hides the inline "Add activity" input + button when inlineActivityCreateEnabled is false — the Activity picker still works', () => {
    const resourceId = addInlineActivityTestPerson();
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: false });
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    // The inline creator is gone…
    expect(screen.queryByLabelText("New activity name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add activity" })).not.toBeInTheDocument();
    // …but the Activity SelectField is still rendered and usable.
    expect(screen.getByRole("combobox", { name: "Activity" })).toBeInTheDocument();
  });

  it("removes inline activity creation when an open editor modal is downgraded to viewer", async () => {
    const resourceId = addInlineActivityTestPerson();
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    const view = render(
      <PermissionContext.Provider value={{ role: "editor" }}>
        <AllocationModal
          kind="create"
          create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
          onClose={vi.fn()}
        />
      </PermissionContext.Provider>,
    );
    await user.type(screen.getByLabelText("New activity name"), "Unsaved viewer activity");

    view.rerender(
      <PermissionContext.Provider value={{ role: "viewer" }}>
        <AllocationModal
          kind="create"
          create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
          onClose={vi.fn()}
        />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByLabelText("New activity name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add activity" })).not.toBeInTheDocument();
    expect(useStore.getState().data.activities).toHaveLength(2);
  });
});

describe("AllocationModal task field", () => {
  it("shows and saves an optional single-line task when the workspace setting is enabled", async () => {
    const resourceId = addInlineActivityTestPerson();
    useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Task"), "Launch review");
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.allocations[0]?.task).toBe("Launch review");
  });
  it("allows an existing task to be cleared", async () => {
    const resourceId = addInlineActivityTestPerson();
    const allocation = useStore.getState().addAllocation({
      resourceId,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
      task: "Original task",
    });
    useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText("Task"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.allocations[0]).not.toHaveProperty("task");
  });
  it("preserves a hidden task while an unrelated allocation is edited and restores it when enabled", async () => {
    const resourceId = addInlineActivityTestPerson();
    const taskAllocation = useStore.getState().addAllocation({
      resourceId,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
      task: "Keep this task",
    });
    const unrelated = useStore.getState().addAllocation({
      resourceId,
      activityId: "t1",
      startDate: "2026-06-08",
      endDate: "2026-06-10",
      hoursPerDay: 8,
      status: "confirmed",
    });
    useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: false });
    const user = userEvent.setup();
    const view = render(<AllocationModal kind="edit" allocationId={unrelated.id} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Task")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Tentative" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    view.unmount();

    useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    render(<AllocationModal kind="edit" allocationId={taskAllocation.id} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Task")).toHaveValue("Keep this task");
    expect(useStore.getState().data.allocations.find(({ id }) => id === taskAllocation.id)?.task).toBe(
      "Keep this task",
    );
  });
});
