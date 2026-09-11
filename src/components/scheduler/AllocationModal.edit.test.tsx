import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import type { Activity } from "@capacitylens/shared/types/entities";
import { setExternalEnabled, setPlaceholdersEnabled } from "../../test/fixtures";
import { chooseOption } from "./__tests__/schedulerTestKit";
import { ACC, person, required, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

interface AllocationScopeCaseInput {
  caseName: string;
  activityKind: Activity["kind"];
  allocationProjectId?: "p1" | undefined;
  expectedScope: string;
  activityName: string;
}

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

function resolveScopeActivity(activityKind: AllocationScopeCaseInput["activityKind"], activityName: string) {
  if (activityKind !== "project") return useStore.getState().addActivity({ name: activityName, kind: activityKind });
  return required(
    useStore.getState().data.activities.find((candidate) => candidate.id === "t1"),
    "Expected the seeded project activity.",
  );
}

describe("AllocationModal edit", () => {
  it.each([
    {
      caseName: "attributed All-projects",
      activityKind: "repeatable",
      allocationProjectId: "p1",
      expectedScope: "Acme / Lightning",
      activityName: "Planning",
    },
    {
      caseName: "legacy unattributed All-projects",
      activityKind: "repeatable",
      allocationProjectId: undefined,
      expectedScope: "No specific project",
      activityName: "Planning",
    },
    {
      caseName: "internal",
      activityKind: "internal",
      allocationProjectId: undefined,
      expectedScope: "Internal",
      activityName: "Operations",
    },
    {
      caseName: "project-specific",
      activityKind: "project",
      allocationProjectId: undefined,
      expectedScope: "Acme / Lightning",
      activityName: "Wireframes",
    },
  ] satisfies readonly AllocationScopeCaseInput[])(
    "reverse-maps and saves an $caseName allocation",
    async ({ activityKind, allocationProjectId, expectedScope, activityName }: AllocationScopeCaseInput) => {
      const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
      const activity = resolveScopeActivity(activityKind, activityName);
      const allocation = useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        ...(allocationProjectId ? { projectId: allocationProjectId } : {}),
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      });
      const user = userEvent.setup();
      render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

      expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(expectedScope);
      expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent(activityName);
      await user.click(screen.getByRole("button", { name: "Save" }));

      const saved = required(
        useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id),
        "Expected the edited allocation to remain saved.",
      );
      if (allocationProjectId) expect(saved).toHaveProperty("projectId", allocationProjectId);
      else expect(saved).not.toHaveProperty("projectId");
    },
  );

  it("allows a metadata-only full-form save for a retained availability conflict", async () => {
    const resource = useStore.getState().addResource({ ...person("Clark Kent"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    useStore.getState().updateResource(resource.id, { firstAvailableDate: "2026-06-08" });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Retained scheduling context" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      note: "Retained scheduling context",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
  });

  it("clears attributed All-projects work when its scope changes", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const activity = useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: activity.id,
      projectId: "p1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await chooseOption(user, "Project", "No specific project");
    await chooseOption(user, "Activity", "Planning");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).not.toHaveProperty(
      "projectId",
    );
  });

  it("shows an unmatched hours value and preserves it through an unrelated save", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 6.4,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    const hours = screen.getByRole("combobox", { name: "Hours / day" });
    expect(hours).toHaveTextContent("6.4");
    fireEvent.keyDown(hours, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "1 h",
      "2 h - quarter day",
      "4 h - half day",
      "8 h - full day",
    ]);
    await user.keyboard("{Escape}");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Unrelated edit" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      hoursPerDay: 6.4,
      note: "Unrelated edit",
    });
  });

  it("replaces an unmatched hours value when a listed option is chosen", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 5,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Hours / day" })).toHaveTextContent("5");
    await chooseOption(user, "Hours / day", "4 h - half day");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)?.hoursPerDay).toBe(4);
  });

  it("preserves an untouched historical multiline note but saves a direct note edit as one line", async () => {
    const alice = person("Alice");
    const resource = useStore.getState().addResource({ ...alice, workingDays: [...alice.workingDays] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
      note: "First line\nSecond line",
    });
    const user = userEvent.setup();
    const view = render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    const note = screen.getByLabelText("Note");
    expect(note.tagName).toBe("INPUT");
    expect(note).toHaveAttribute("maxlength", "2000");
    await chooseOption(user, "Hours / day", "4 h - half day");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)?.note).toBe(
      "First line\nSecond line",
    );

    view.unmount();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "First line Second line" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)?.note).toBe(
      "First line Second line",
    );
  });

  it("keeps the modal open and surfaces the reason when deletion is rejected", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const deleteAllocation = vi.spyOn(useStore.getState(), "deleteAllocation").mockImplementation(() => {
      throw new Error("The allocation is protected by an integrity rule.");
    });
    const onClose = vi.fn();
    const user = userEvent.setup();

    try {
      render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

      expect(deleteAllocation).toHaveBeenCalledWith(allocation.id);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Edit allocation" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("The allocation is protected by an integrity rule.");
      expect(useStore.getState().data.allocations).toContainEqual(allocation);
    } finally {
      deleteAllocation.mockRestore();
    }
  });

  it("offers one-or-future deletion for a linked occurrence and closes after the atomic removal", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const seriesId = "series-weekly";
    const [earlier, selected, later] = useStore.getState().addAllocations([
      {
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
        seriesId,
      },
      {
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-08",
        endDate: "2026-06-09",
        hoursPerDay: 8,
        status: "confirmed",
        seriesId,
      },
      {
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        hoursPerDay: 8,
        status: "confirmed",
        seriesId,
      },
    ]);
    expect(earlier).toBeDefined();
    expect(selected).toBeDefined();
    expect(later).toBeDefined();
    if (!earlier || !selected || !later) throw new Error("Expected all repeated allocations to be created.");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={selected.id} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete repeated allocation?" });
    expect(within(dialog).getByRole("button", { name: "Delete this occurrence" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete this and future occurrences" }));

    expect(useStore.getState().data.allocations.map(({ id }) => id)).toContain(earlier.id);
    expect(useStore.getState().data.allocations.map(({ id }) => id)).not.toContain(selected.id);
    expect(useStore.getState().data.allocations.map(({ id }) => id)).not.toContain(later.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("deletes only the selected linked occurrence when that scope is chosen", async () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const [selected, later] = useStore.getState().addAllocations([
      {
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-08",
        endDate: "2026-06-09",
        hoursPerDay: 8,
        status: "confirmed",
        seriesId: "series-weekly",
      },
      {
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        hoursPerDay: 8,
        status: "confirmed",
        seriesId: "series-weekly",
      },
    ]);
    expect(selected).toBeDefined();
    expect(later).toBeDefined();
    if (!selected || !later) throw new Error("Expected both repeated allocations to be created.");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={selected.id} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("alertdialog", { name: "Delete repeated allocation?" })).getByRole("button", {
        name: "Delete this occurrence",
      }),
    );

    expect(useStore.getState().data.allocations.map(({ id }) => id)).toEqual([later.id]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reassigns an allocation to another resource", async () => {
    const a = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const b = useStore.getState().addResource({ ...person("Bob"), workingDays: [1, 2, 3, 4, 5] });
    const alloc = useStore.getState().addAllocation({
      resourceId: a.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    await chooseOption(user, "Assignee", "Bob");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const reassigned = required(
      useStore.getState().data.allocations.find((candidate) => candidate.id === alloc.id),
      "Expected the reassigned allocation to remain saved.",
    );
    expect(reassigned.resourceId).toBe(b.id);
  });

  it("rejects reassigning a normal allocation to a zero-overlap person", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const source = useStore.getState().addResource({ ...person("Alice"), workingDays: [2] });
    const destination = useStore.getState().addResource({ ...person("Bob"), workingDays: [1] });
    const allocation = useStore.getState().addAllocation({
      resourceId: source.id,
      activityId: "t1",
      startDate: "2026-06-02",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);

    await chooseOption(user, "Assignee", "Bob");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      resourceId: source.id,
    });
    expect(destination.id).not.toBe(source.id);
  });

  it("rejects reassigning even an ignored allocation to a zero-overlap person (decision 6)", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const source = useStore.getState().addResource({ ...person("Alice"), workingDays: [2] });
    useStore.getState().addResource({ ...person("Bob"), workingDays: [1] });
    const allocation = useStore.getState().addAllocation({
      resourceId: source.id,
      activityId: "t1",
      startDate: "2026-06-02",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
      ignoreWeekends: true,
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await chooseOption(user, "Assignee", "Bob");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      resourceId: source.id,
      ignoreWeekends: true,
    });
    expect(
      screen.getByText("This person has no working days within the company's current working week."),
    ).toBeInTheDocument();
  });

  it("snaps the project to the placeholder bound project when reassigned, restricting options", async () => {
    const a = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a",
      projectId: "p2",
    });
    const alloc = useStore.getState().addAllocation({
      resourceId: a.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    await chooseOption(user, "Assignee", "Placeholder (slot)");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Acme / Other");
    // The non-bound project (p1 / "Lightning") is no longer offered to the placeholder.
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), {
      key: "ArrowDown",
    });
    expect(screen.queryByRole("option", { name: "Acme / Lightning" })).not.toBeInTheDocument();
  });

  it("risk A: editing an allocation on a HIDDEN placeholder still offers that placeholder so the value is preserved", async () => {
    const ph = useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a",
      projectId: "p1",
    });
    const alloc = useStore.getState().addAllocation({
      resourceId: ph.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    // Turn placeholders OFF — they're hidden everywhere, but an allocation already on one must not
    // silently reassign when edited: the picker keeps the currently-selected (hidden) placeholder.
    setPlaceholdersEnabled(false);
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    const assignee = screen.getByRole("combobox", { name: "Assignee" });
    expect(assignee).toHaveTextContent("Placeholder (slot)");
    // The placeholder option is present (labelled "Placeholder (slot)") even though placeholders are
    // hidden — without it the picker would silently reassign to another available option.
    fireEvent.keyDown(assignee, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Placeholder (slot)" })).toBeInTheDocument();
  });

  it("risk A: editing an allocation on a HIDDEN external still offers that external so the value is preserved", async () => {
    // Externals default OFF too; the suite-wide beforeEach only turns placeholders on. Create an
    // external, book it, then assert the picker keeps it as an option even with the pref OFF.
    const ext = useStore.getState().addResource({
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#9ca3af",
    });
    const alloc = useStore.getState().addAllocation({
      resourceId: ext.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 0,
      status: "confirmed",
    });
    // External pref OFF (its default) — hidden everywhere, but an allocation already on one must not
    // silently reassign when edited: the picker keeps the currently-selected (hidden) external.
    setExternalEnabled(false);
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    const assignee = screen.getByRole("combobox", { name: "Assignee" });
    expect(assignee).toHaveTextContent("Kord Industries (external)");
    // The external option is present (labelled "Kord Industries (external)") even though externals are
    // hidden — without it the picker would silently reassign to another available option.
    fireEvent.keyDown(assignee, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Kord Industries (external)" })).toBeInTheDocument();
  });

  it("reopens and saves a legacy unattributed placeholder allocation unchanged", async () => {
    const ph = useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a",
      projectId: "p1",
    });
    const gen = useStore.getState().addActivity({ name: "Admin", kind: "repeatable" });
    const alloc = useStore.getState().addAllocation({
      resourceId: ph.id,
      activityId: gen.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("No specific project");
    expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent("Admin");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "No specific project" })).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === alloc.id)).not.toHaveProperty(
      "projectId",
    );
  });

  it("uses a bound placeholder's project when an edited allocation has a dangling activity", () => {
    const ph = useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a",
      projectId: "p1",
    });
    const activity = useStore.getState().addActivity({ name: "Temporary", kind: "repeatable" });
    const alloc = useStore.getState().addAllocation({
      resourceId: ph.id,
      activityId: activity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    useStore.setState((current) => ({
      data: {
        ...current.data,
        activities: current.data.activities.filter((candidate) => candidate.id !== activity.id),
      },
    }));

    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Acme / Lightning");
  });

  it("duplicates the current validated form values without changing the saved allocation", async () => {
    const a = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const alloc = useStore.getState().addAllocation({
      resourceId: a.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
      note: "Saved note",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "2026-06-05" },
    });
    await chooseOption(user, "Hours / day", "4 h - half day");
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Draft note" },
    });

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(onClose).toHaveBeenCalledOnce();
    const allocations = useStore.getState().data.allocations;
    expect(allocations).toHaveLength(2);
    expect(allocations.find((candidate) => candidate.id === alloc.id)).toMatchObject({
      endDate: "2026-06-02",
      hoursPerDay: 8,
      note: "Saved note",
    });
    expect(allocations.find((candidate) => candidate.id !== alloc.id)).toMatchObject({
      endDate: "2026-06-05",
      hoursPerDay: 4,
      note: "Draft note",
    });
  });

  it("keeps Duplicate for an unlinked all-projects allocation and hides it for a linked occurrence", () => {
    const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    const activity = useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const oneOff = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: activity.id,
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const linked = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: activity.id,
      startDate: "2026-06-08",
      endDate: "2026-06-08",
      hoursPerDay: 8,
      status: "confirmed",
      seriesId: "series-weekly",
    });

    const oneOffView = render(<AllocationModal kind="edit" allocationId={oneOff.id} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    oneOffView.unmount();

    render(<AllocationModal kind="edit" allocationId={linked.id} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
  });

  it("rejects duplicating a zero-hour block after the account switches to Hours mode", async () => {
    const a = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
    useStore.getState().updateAccount(ACC, { schedulingMode: "blocks" });
    const alloc = useStore.getState().addAllocation({
      resourceId: a.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 0,
      status: "confirmed",
    });
    useStore.getState().updateAccount(ACC, { schedulingMode: "hourly" });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/hours per day must be greater than 0/i);
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});
