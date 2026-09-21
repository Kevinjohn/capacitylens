import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { makeResourceDraft } from "../../test/fixtures";
import { chooseOption } from "./__tests__/schedulerTestKit";
import { required, first, person, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

type CapacityAdvisoryMockInput =
  | Parameters<typeof import("../../lib/capacity").buildCapacityAdvisory>[0]
  | Parameters<typeof import("../../lib/capacity").buildCapacityAdvisoryFromLoad>[0];
const capacityAdvisoryMock = vi.hoisted(() =>
  vi.fn<(input: CapacityAdvisoryMockInput) => { overDays: number; timeOffDays: number }>(() => ({
    overDays: 0,
    timeOffDays: 0,
  })),
);
const lastAdvisoryProposal = () => capacityAdvisoryMock.mock.calls.at(-1)?.[0]?.proposal;
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

describe("AllocationModal create", () => {
  it("orders project scopes and activities, and exposes status as a labelled radiogroup", async () => {
    useStore.getState().addClient({ name: "Zeta", color: "#123456" });
    const zetaClient = required(
      useStore.getState().data.clients.find((client) => client.name === "Zeta"),
      "Expected the newly added Zeta client.",
    );
    useStore.getState().addProject({ name: "Alpha", clientId: zetaClient.id, color: "#123456" });
    useStore.getState().addActivity({ name: "Support", kind: "internal" });
    useStore.getState().addActivity({ name: "Admin", kind: "internal" });
    useStore.getState().addActivity({ name: "Strategy", kind: "repeatable" });
    useStore.getState().addActivity({ name: "Retrospective", kind: "repeatable" });
    const barbara = person("Barbara");
    const resource = useStore.getState().addResource({ ...barbara, workingDays: [...barbara.workingDays] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-02", endDate: "2026-06-02" }}
        onClose={vi.fn()}
      />,
    );

    const project = screen.getByRole("combobox", { name: "Project" });
    expect(project).toHaveTextContent("Internal");
    fireEvent.keyDown(project, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Internal",
      "No specific project",
      "Acme / Lightning",
      "Acme / Other",
      "Zeta / Alpha",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Internal" }));

    const activity = screen.getByRole("combobox", { name: "Activity" });
    fireEvent.keyDown(activity, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Admin", "Support"]);
    fireEvent.click(screen.getByRole("option", { name: "Admin" }));

    await chooseOption(user, "Project", "No specific project");
    fireEvent.keyDown(activity, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Retrospective", "Strategy"]);
    await user.keyboard("{Escape}");

    const status = screen.getByRole("radiogroup", { name: "Status" });
    expect(
      within(status)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Confirmed", "Tentative", "Completed"]);
    expect(within(status).getByRole("radio", { name: "Confirmed" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(status).getByRole("radio", { name: "Tentative" }));
    expect(within(status).getByRole("radio", { name: "Tentative" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Note").tagName).toBe("INPUT");
  });

  it("defaults hourly load to four hours when creation starts on a half day", () => {
    const resource = useStore
      .getState()
      .addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5], halfDays: [2] });
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-02", endDate: "2026-06-02" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Hours / day" })).toHaveTextContent("4 h - half day");
  });

  it("gives same-named activity options distinct accessible labels", async () => {
    useStore.getState().addActivity({ name: "Wireframes", kind: "project", projectId: "p1" });
    const resource = useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-03",
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    const activity = screen.getByRole("combobox", { name: "Activity" });
    fireEvent.keyDown(activity, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Wireframes / Lightning (1)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Wireframes / Lightning (2)" })).toBeInTheDocument();
  });

  it("creates an allocation for a person after picking project + activity", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = first(useStore.getState().data.resources).id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    const allocs = useStore.getState().data.allocations;
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({
      resourceId,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
    });
    expect(allocs[0]).not.toHaveProperty("projectId");
  });

  it.each([
    ["Internal", "Operations", undefined],
    ["No specific project", "Planning", undefined],
    ["Acme / Lightning", "Planning", "p1"],
  ] as const)("derives create attribution for the %s scope", async (scope, activityName, expectedProjectId) => {
    useStore.getState().addActivity({ name: "Operations", kind: "internal" });
    useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const resource = useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", scope);
    await chooseOption(user, "Activity", activityName);
    if (scope === "Acme / Lightning") {
      expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(scope);
    }
    if (expectedProjectId) expect(lastAdvisoryProposal()).toHaveProperty("projectId", expectedProjectId);
    else expect(lastAdvisoryProposal()).not.toHaveProperty("projectId");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const allocation = useStore.getState().data.allocations[0];
    if (expectedProjectId) expect(allocation).toHaveProperty("projectId", expectedProjectId);
    else expect(allocation).not.toHaveProperty("projectId");
  });

  it.each([
    ["1 h", 1],
    ["2 h - quarter day", 2],
    ["4 h - half day", 4],
    ["8 h - full day", 8],
  ] as const)("creates an allocation with the %s hours option", async (option, expectedHours) => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = first(useStore.getState().data.resources).id;
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await chooseOption(user, "Hours / day", option);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations).toHaveLength(1);
    expect(useStore.getState().data.allocations[0]).toMatchObject({ hoursPerDay: expectedHours });
  });

  it("rejects an empty date instead of saving a broken allocation", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = first(useStore.getState().data.resources).id;
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    // Clearing a date must NOT produce a NaN-geometry allocation.
    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/start and end dates are required/i);
    expect(screen.getByLabelText("Start Date")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Start Date")).toHaveFocus();
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("books an All-projects activity for a bound placeholder under its locked project", async () => {
    const planning = useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const ph = useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a855f7",
      projectId: "p1",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: ph.id,
          startDate: "2026-06-01",
          endDate: "2026-06-02",
        }}
        onClose={onClose}
      />,
    );

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    expect(projectSelect).toHaveTextContent("Acme / Lightning");
    // Invalid scopes remain visible so the lock is explicit, but cannot be selected.
    fireEvent.keyDown(projectSelect, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Internal" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("option", { name: "No specific project" })).toHaveAttribute("data-disabled");
    expect(screen.queryByRole("option", { name: "Acme / Other" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const activitySelect = screen.getByRole("combobox", { name: "Activity" });
    fireEvent.keyDown(activitySelect, { key: "ArrowDown" });
    const allProjectsGroup = screen.getByRole("group", { name: "All projects" });
    const projectGroup = screen.getByRole("group", { name: "Project-specific" });
    expect(allProjectsGroup.compareDocumentPosition(projectGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(allProjectsGroup).getByRole("option", { name: "Planning" })).toBeInTheDocument();
    expect(within(projectGroup).getByRole("option", { name: "Wireframes" })).toBeInTheDocument();
    fireEvent.click(within(allProjectsGroup).getByRole("option", { name: "Planning" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      resourceId: ph.id,
      activityId: planning.id,
      projectId: "p1",
    });
  });

  it("cannot attribute an All-projects activity for an unbound placeholder", async () => {
    useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const placeholder = useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a855f7",
    });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: placeholder.id, startDate: "2026-06-01", endDate: "2026-06-02" }}
        onClose={vi.fn()}
      />,
    );

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    fireEvent.keyDown(projectSelect, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Internal" })).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("option", { name: "No specific project" })).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("option", { name: "Acme / Lightning" })).not.toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Planning");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This placeholder is not bound to a project yet.");
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });
});

describe("AllocationModal advisory work bounds", () => {
  it("does not recompute the advisory when only the note changes", () => {
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-03",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(capacityAdvisoryMock).toHaveBeenCalledTimes(1);

    capacityAdvisoryMock.mockClear();
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Unrelated edit" },
    });

    expect(capacityAdvisoryMock).not.toHaveBeenCalled();
  });

  it("skips the advisory and rejects an over-limit Hours-mode date span", async () => {
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-03",
        }}
        onClose={onClose}
      />,
    );
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    capacityAdvisoryMock.mockClear();

    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "9999-12-31" },
    });
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Still responsive" },
    });
    expect(capacityAdvisoryMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Date span cannot exceed 36,500 calendar days.");
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("rejects the same over-limit date span for an External resource", async () => {
    const resource = useStore.getState().addResource({
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
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-03",
        }}
        onClose={onClose}
      />,
    );
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "9999-12-31" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Date span cannot exceed 36,500 calendar days.");
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("keeps Ignore working days hidden for an External while preserving its literal calendar span", async () => {
    const resource = useStore.getState().addResource({
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 3, 5],
      halfDays: [],
      color: "#9ca3af",
    });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-04" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("checkbox", { name: "Ignore working days" })).not.toBeInTheDocument();
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      hoursPerDay: 0,
      ignoreWeekends: true,
    });
  });
});
