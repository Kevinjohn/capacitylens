import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "../../store/useStore";
import type { AppData, Weekday } from "@capacitylens/shared/types/entities";
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAppData,
  makeClient,
  makeProject,
  makeResourceDraft,
  setExternalEnabled,
  setPlaceholdersEnabled,
} from "../../test/fixtures";
import { PermissionContext } from "../../auth/permissionContext";
import { addDaysISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { chooseOption, GEOM, indexAtClientX, renderWithTooltip } from "./__tests__/schedulerTestKit";

const capacityAdvisoryMock = vi.hoisted(() => vi.fn(() => ({ overDays: 0, timeOffDays: 0 })));
// The mock is declared without a parameter list, so reach its recorded arguments through a cast:
// tests assert on the `otherAllocations` the modal passes (its scheduling-mode projection of the
// existing load), not merely on how often the advisory ran. It is the THIRD argument — the second
// is the proposed allocation itself.
const lastAdvisoryOthers = () => (capacityAdvisoryMock.mock.calls.at(-1) as unknown as unknown[] | undefined)?.[2];
const lastAdvisoryProposal = () =>
  (capacityAdvisoryMock.mock.calls.at(-1) as unknown as unknown[] | undefined)?.[1] as
    { projectId?: string } | undefined;
// Both entry points share one mock: the repeat path advises against a batch-shared load bucket
// (`capacityAdvisoryFromLoad`), the single-allocation path buckets its own window, and these tests
// care only about the advisory VERDICTS the modal renders.
vi.mock("../../lib/capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/capacity")>()),
  capacityAdvisory: capacityAdvisoryMock,
  capacityAdvisoryFromLoad: capacityAdvisoryMock,
}));

const ACC = DEFAULT_ACCOUNT_ID;
const originalAddAllocation = useStore.getState().addAllocation;
const originalAddAllocations = useStore.getState().addAllocations;

function base(): AppData {
  return makeAppData({
    clients: [makeClient({ accountId: ACC, color: "#111" })],
    projects: [
      makeProject({ accountId: ACC }),
      makeProject({ id: "p2", accountId: ACC, name: "Other", color: "#06b6d4" }),
    ],
    activities: [
      makeActivity({ accountId: ACC }),
      makeActivity({ id: "t2", accountId: ACC, name: "Other activity", projectId: "p2" }),
    ],
  });
}

beforeEach(() => {
  // Zustand state writes replace the state object while retaining action references. Restore these
  // explicitly so a spy installed in one test cannot survive on a later state object.
  useStore.setState({ addAllocation: originalAddAllocation, addAllocations: originalAddAllocations });
  capacityAdvisoryMock.mockClear();
  capacityAdvisoryMock.mockImplementation(() => ({ overDays: 0, timeOffDays: 0 }));
  useStore.getState().replaceAll(base());
  useStore.getState().setActiveAccount(ACC);
  // Placeholders default OFF (per-account pref). Several tests reassign to / from a placeholder
  // via the Assignee picker, which only offers placeholders when the pref is on — enable it for
  // the suite. The risk-A case (editing an allocation already ON a placeholder while the pref is
  // OFF still shows that placeholder) has its own dedicated test below.
  setPlaceholdersEnabled(true);
});

describe("AllocationModal create", () => {
  it("orders project scopes and activities, and exposes status as a labelled radiogroup", async () => {
    useStore.getState().addClient({ name: "Zeta", color: "#123456" });
    const zetaClient = useStore.getState().data.clients.find((client) => client.name === "Zeta")!;
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
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
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
    const resourceId = useStore.getState().data.resources[0].id;
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />,
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
    const resourceId = useStore.getState().data.resources[0].id;
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />,
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

const person = (name: string) => makeResourceDraft({ name, role: "Dev", color: "#111" });

function expectLabelControl(control: HTMLElement) {
  expect(control.closest('[data-slot="field"]')).toHaveAttribute("data-product-layout", "label-control");
}

function expectInAllocationControlColumn(control: HTMLElement) {
  expect(control.closest("[data-allocation-control-column]")).toBeInTheDocument();
}

function expectAllocationSpanRow(controls: HTMLElement[]) {
  const row = controls[0]?.closest("[data-allocation-span-row]");
  expect(row).toBeInTheDocument();
  expect(row?.querySelectorAll(":scope > [data-allocation-span-controls] > [data-slot='field']")).toHaveLength(
    controls.length,
  );
  for (const control of controls) {
    expect(control.closest("[data-allocation-span-row]")).toBe(row);
    expect(control.closest("[data-allocation-control-column]")).not.toBeInTheDocument();
  }
}

describe("AllocationModal compact layout", () => {
  it("aligns Hours-mode create fields, the full-width scheduling row, inline creation and repeat hints", async () => {
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );

    for (const control of [
      screen.getByRole("combobox", { name: "Project" }),
      screen.getByRole("combobox", { name: "Activity" }),
      screen.getByRole("combobox", { name: "Repeat" }),
      screen.getByRole("radiogroup", { name: "Status" }),
      screen.getByLabelText("Note"),
      screen.getByRole("checkbox", { name: "Ignore working days" }),
    ]) {
      expectLabelControl(control);
    }
    expect(screen.getByRole("radiogroup", { name: "Status" })).toHaveClass("w-full");
    expectAllocationSpanRow([
      screen.getByLabelText("Start Date"),
      screen.getByLabelText("End"),
      screen.getByLabelText("Hours / day"),
    ]);
    expectInAllocationControlColumn(screen.getByRole("textbox", { name: "New activity name" }));

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await chooseOption(user, "Repeat", "Weekly");
    expectLabelControl(screen.getByLabelText("Repeat until"));
    expectInAllocationControlColumn(screen.getByText(/Creates \d+ linked allocations/));
  });

  it("adds Assignee to the shared rows in edit mode without adding Repeat", () => {
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    expectLabelControl(screen.getByRole("combobox", { name: "Assignee" }));
    expect(screen.queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
    expectAllocationSpanRow([
      screen.getByLabelText("Start Date"),
      screen.getByLabelText("End"),
      screen.getByLabelText("Hours / day"),
    ]);
  });

  it.each([
    ["days", ["Start Date", "Days of work", "Days over"]],
    ["blocks", ["Start Date", "Days over"]],
  ] as const)("uses a full-width scheduling row for %s mode", (mode, labels) => {
    useStore.getState().updateAccount(ACC, { schedulingMode: mode });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    expectAllocationSpanRow(labels.map((label) => screen.getByLabelText(label)));
    expect(screen.getByText(/^Ends /).closest("[data-allocation-span-row]")).toBeInTheDocument();
  });

  it("keeps External dates aligned and the placeholder hint under the control area", () => {
    const external = useStore.getState().addResource({
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#9ca3af",
    });
    const externalView = render(
      <AllocationModal
        create={{ resourceId: external.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    expectAllocationSpanRow([screen.getByLabelText("Start Date"), screen.getByLabelText("End")]);
    expect(screen.queryByRole("checkbox", { name: "Ignore working days" })).not.toBeInTheDocument();
    externalView.unmount();

    const placeholder = useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#a855f7",
      projectId: "p1",
    });
    render(
      <AllocationModal
        create={{ resourceId: placeholder.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    expectInAllocationControlColumn(screen.getByText("Placeholder — locked to its bound project."));
  });
});

describe("AllocationModal advisory work bounds", () => {
  it("does not recompute the advisory when only the note changes", () => {
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    render(
      <AllocationModal
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

const enableDays = (workingDays?: Weekday[]) =>
  useStore.getState().updateAccount(ACC, { schedulingMode: "days", ...(workingDays && { workingDays }) });

describe("AllocationModal days mode", () => {
  it("counts and derives spans through a company-narrowed effective week", async () => {
    enableDays([1, 2, 3, 4]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-05" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Days over")).toHaveValue(4);
    expect(screen.getByLabelText("Days of work")).toHaveValue(4);
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-08",
      hoursPerDay: 6.4,
    });
  });

  it("validates the maximum working span against the narrowed company week", async () => {
    enableDays([1, 2, 3, 4]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "9999-12-27", endDate: "9999-12-27" }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    const daysOver = screen.getByLabelText("Days over");
    expect(daysOver).toHaveAttribute("max", "4");
    fireEvent.change(daysOver, { target: { value: "5" } });
    fireEvent.submit(daysOver.closest("form")!);

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot extend beyond 31 December 9999/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("keeps zero-overlap date math finite but rejects creating a normal allocation", async () => {
    enableDays([2]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "5" } });
    expect(screen.getByText("Ends Wed 3 Jun 2026 · 1.6h/day")).toBeInTheDocument();
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument();
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("rejects even an ignored creation for a zero-overlap person (no escape hatch, decision 6)", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("checkbox", { name: "Ignore working days" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations).toHaveLength(0);
    expect(
      screen.getByText("This person has no working days within the company's current working week."),
    ).toBeInTheDocument();
  });

  it("leaves Ignore working days unchecked and skips personal non-working weekdays", async () => {
    enableDays();
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 3, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-01" }}
        onClose={vi.fn()}
      />,
    );

    const ignoreWorkingDays = screen.getByRole("checkbox", { name: "Ignore working days" });
    expect(ignoreWorkingDays).not.toBeChecked();
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      ignoreWeekends: false,
    });
  });

  it("includes every calendar day when Ignore working days is checked", async () => {
    enableDays();
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 3, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-01" }}
        onClose={vi.fn()}
      />,
    );

    const ignoreWorkingDays = screen.getByRole("checkbox", { name: "Ignore working days" });
    await user.click(ignoreWorkingDays);
    expect(ignoreWorkingDays).toBeChecked();
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      ignoreWeekends: true,
    });
  });

  it("reopens and resaves an existing checked allocation without changing its span or semantics", async () => {
    enableDays();
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 3, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
      ignoreWeekends: true,
    });
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "Ignore working days" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      ignoreWeekends: true,
    });
  });

  it("derives end date + hours/day from start, days of work and days over", async () => {
    enableDays();
    const r = useStore
      .getState()
      .addResource({ ...person("Bruce"), workingHoursPerDay: 6, workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={onClose}
      />,
    );

    // Days mode swaps the End / Hours-per-day fields for Days of work / Days over.
    expect(screen.queryByLabelText("End")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hours / day")).not.toBeInTheDocument();

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days of work"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    // 10 working days from Mon 2026-06-01 (Mon–Fri) lands on Fri 2026-06-12;
    // 5 days of work spread over 10 at the fixed 8h day = 4h/day. The legacy stored 6h value
    // deliberately has no effect on scheduling math.
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-12",
      hoursPerDay: 4,
    });
  });

  it("rejects zero days of work", async () => {
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days of work"), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/days of work must be greater than 0/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("rejects a derived span that would leave the four-digit-year date domain", async () => {
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "9999-12-31",
          endDate: "9999-12-31",
        }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "2" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot extend beyond 31 December 9999/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("rejects a work volume that would derive more than 24h/day (no silent clamp)", async () => {
    // 5 days of work crammed into a 1-day span = 40h/day, which the store would clamp to 24 —
    // silently discarding the entered volume. The modal must reject so preview === saved.
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days of work"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/more than 24h a day/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it('rejects an EMPTY "Days over" submitted via Enter (no blur) instead of saving a 0-hour allocation', async () => {
    // The NaN hole: a valid "Days of work" but a "Days over" left empty/part-typed emits NaN
    // (NumberField only clamps to min on blur). hoursPerDayFor(daysOfWork, NaN, whpd) is NaN, the
    // store's clampHoursPerDay(NaN) → 0, so a SILENT 0-hour allocation would save. Submitting via
    // Enter directly from the field skips the blur-clamp, exercising exactly that path. The load
    // guard must reject (NaN fails Number.isFinite) and persist nothing.
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const addAllocation = vi.spyOn(useStore.getState(), "addAllocation");
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days of work"), {
      target: { value: "5" },
    });
    // Empty the "Days over" field — emits NaN — then submit the form directly (Enter from a
    // single number input), which skips the field's on-blur clamp.
    const daysOver = screen.getByLabelText("Days over");
    fireEvent.change(daysOver, { target: { value: "" } });
    fireEvent.submit(daysOver.closest("form")!);

    expect(onClose).not.toHaveBeenCalled();
    expect(addAllocation).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/days over must be a whole number from 1/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
    addAllocation.mockRestore();
  });

  it("honours the drawn span when creating (days over = the dragged-out length)", async () => {
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    // The grid hands the modal a 5-working-day span (Mon 06-01 … Fri 06-05).
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-05",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Days over")).toHaveValue(5);
    expect(screen.getByLabelText("Days of work")).toHaveValue(5); // full-time across the span

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
    });
  });

  it("seeds a half day as half a day of work in days mode", () => {
    enableDays();
    const resource = useStore
      .getState()
      .addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5], halfDays: [2] });
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-02", endDate: "2026-06-02" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Days over")).toHaveValue(1);
    expect(screen.getByLabelText("Days of work")).toHaveValue(0.5);
  });

  it("does not drift hours when an unevenly-dividing allocation is re-saved unchanged", async () => {
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    // 5h/day over 3 working days = 1.875 days of work — a value 2-dp rounding would distort.
    const alloc = useStore.getState().addAllocation({
      resourceId: r.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 5,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));
    const after = useStore.getState().data.allocations.find((a) => a.id === alloc.id)!;
    expect(after.endDate).toBe("2026-06-03");
    expect(after.hoursPerDay).toBeCloseTo(5, 6);
  });

  it("preserves a stored non-working end date when an existing allocation is saved unchanged", async () => {
    enableDays();
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)?.endDate).toBe(
      "2026-06-07",
    );
  });

  it("seeds the days inputs by inverting an existing allocation", () => {
    enableDays();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    // 4h/day over 2026-06-01..06-12 (10 working days) = 5 days of work.
    const alloc = useStore.getState().addAllocation({
      resourceId: r.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-12",
      hoursPerDay: 4,
      status: "confirmed",
    });
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Days of work")).toHaveValue(5);
    expect(screen.getByLabelText("Days over")).toHaveValue(10);
  });
});

describe("AllocationModal blocks mode", () => {
  const enableBlocks = () => useStore.getState().updateAccount(ACC, { schedulingMode: "blocks" });

  it("asks only for start + days over, and persists a zero-load span", async () => {
    enableBlocks();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={onClose}
      />,
    );

    // Blocks drops every load field — no End, no Hours/day, no Days of work.
    expect(screen.queryByLabelText("End")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hours / day")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Days of work")).not.toBeInTheDocument();

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    // 10 working days from Mon 2026-06-01 lands on Fri 2026-06-12; load is 0.
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-12",
      hoursPerDay: 0,
    });
  });

  it("counts the existing load through the blocks projection, like the grid and the drag path", () => {
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    // Legacy hourly allocation persisted BEFORE the account switched to blocks: it keeps its stored
    // 8h/day, and every capacity surface must read it as zero load while the account is in blocks.
    useStore.getState().addAllocation({
      resourceId: r.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    });

    const renderCreate = () =>
      render(
        <AllocationModal
          create={{
            resourceId: r.id,
            startDate: "2026-06-01",
            endDate: "2026-06-05",
          }}
          onClose={vi.fn()}
        />,
      );

    // Hourly mode: the stored load counts as-is.
    const hourly = renderCreate();
    expect(lastAdvisoryOthers()).toEqual([expect.objectContaining({ hoursPerDay: 8 })]);
    hourly.unmount();

    enableBlocks();
    capacityAdvisoryMock.mockClear();
    renderCreate();
    // Blocks carry placement but no hourly load — the advisory must not see the legacy 8h and warn
    // "over capacity" on days the grid's over-markers leave clean.
    expect(lastAdvisoryOthers()).toEqual([expect.objectContaining({ hoursPerDay: 0 })]);
  });

  it("rejects a block span that would leave the four-digit-year date domain", async () => {
    enableBlocks();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "9999-12-31",
          endDate: "9999-12-31",
        }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "2" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot extend beyond 31 December 9999/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("seeds days over from the drawn span and saves with start alone", async () => {
    enableBlocks();
    const r = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    // Grid hands a 5-working-day span (Mon 06-01 … Fri 06-05).
    render(
      <AllocationModal
        create={{
          resourceId: r.id,
          startDate: "2026-06-01",
          endDate: "2026-06-05",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Days over")).toHaveValue(5);

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 0,
    });
  });

  it("preserves historical hours when editing an existing allocation", async () => {
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      hoursPerDay: 8,
      status: "confirmed",
    });
    enableBlocks();
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Note"), "Still scheduled");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toMatchObject({
      endDate: "2026-06-07",
      hoursPerDay: 8,
      note: "Still scheduled",
    });
  });

  it("rejects a fractional Days over value instead of rounding the saved span", async () => {
    enableBlocks();
    const resource = useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "1.5" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/whole number from 1/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });
});

describe("AllocationModal edit", () => {
  it.each([
    ["attributed All-projects", "repeatable", "p1", "Acme / Lightning", "Planning"],
    ["legacy unattributed All-projects", "repeatable", undefined, "No specific project", "Planning"],
    ["internal", "internal", undefined, "Internal", "Operations"],
    ["project-specific", "project", undefined, "Acme / Lightning", "Wireframes"],
  ] as const)(
    "reverse-maps and saves an %s allocation",
    async (_caseName, activityKind, allocationProjectId, expectedScope, activityName) => {
      const resource = useStore.getState().addResource({ ...person("Alice"), workingDays: [1, 2, 3, 4, 5] });
      const activity =
        activityKind === "project"
          ? useStore.getState().data.activities.find((candidate) => candidate.id === "t1")!
          : useStore.getState().addActivity({ name: activityName, kind: activityKind });
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
      render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

      expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(expectedScope);
      expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent(activityName);
      await user.click(screen.getByRole("button", { name: "Save" }));

      const saved = useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)!;
      if (allocationProjectId) expect(saved).toHaveProperty("projectId", allocationProjectId);
      else expect(saved).not.toHaveProperty("projectId");
    },
  );

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
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

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
    const view = render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    const note = screen.getByLabelText("Note");
    expect(note.tagName).toBe("INPUT");
    expect(note).toHaveAttribute("maxlength", "2000");
    await chooseOption(user, "Hours / day", "4 h - half day");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)?.note).toBe(
      "First line\nSecond line",
    );

    view.unmount();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);
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
      render(<AllocationModal allocationId={allocation.id} onClose={onClose} />);
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
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal allocationId={selected.id} onClose={onClose} />);

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
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal allocationId={selected.id} onClose={onClose} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

    await chooseOption(user, "Assignee", "Bob");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((x) => x.id === alloc.id)!.resourceId).toBe(b.id);
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
    render(<AllocationModal allocationId={allocation.id} onClose={onClose} />);

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
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

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

    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

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
    render(<AllocationModal allocationId={alloc.id} onClose={onClose} />);

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

    const oneOffView = render(<AllocationModal allocationId={oneOff.id} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    oneOffView.unmount();

    render(<AllocationModal allocationId={linked.id} onClose={vi.fn()} />);
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
    render(<AllocationModal allocationId={alloc.id} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/hours per day must be greater than 0/i);
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});

describe("#257: modal and gesture effective-week agreement", () => {
  it("saves the same end and hours/day as a resize commit for the same five-day span", async () => {
    enableDays([1, 2, 3, 4]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    const modal = render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const modalAllocation = useStore.getState().data.allocations.find(({ id }) => id === allocation.id)!;
    modal.unmount();

    useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-04", hoursPerDay: 8 });
    const resetAllocation = useStore.getState().data.allocations.find(({ id }) => id === allocation.id)!;
    renderWithTooltip(
      <AllocationBar
        bar={{
          allocation: resetAllocation,
          x: 0,
          width: 192,
          top: 0,
          color: "#3b82f6",
          label: "Wireframes",
          external: false,
        }}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const gestureAllocation = useStore.getState().data.allocations.find(({ id }) => id === allocation.id)!;

    expect(modalAllocation).toMatchObject({ endDate: "2026-06-08", hoursPerDay: 6.4 });
    expect(gestureAllocation).toMatchObject({
      endDate: modalAllocation.endDate,
      hoursPerDay: modalAllocation.hoursPerDay,
    });
  });
});

describe("#257: stale-start edit and duplicate creation gates", () => {
  it("still saves an existing allocation after its assignee loses every effective working day", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={onClose} />);

    await user.type(screen.getByLabelText("Note"), "Still editable");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      resourceId: resource.id,
      startDate: "2026-06-01",
      note: "Still editable",
    });
  });

  // The typed-date create path must enforce the same start rule as the gesture gate: new normal
  // allocations begin on an effective working day, whatever field the date arrived through.
  it("rejects creating an allocation whose typed start is company-non-working", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [1, 2, 3, 4] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-05", endDate: "2026-06-05" }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New allocations must begin on a company and personal working day. Move the start date.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  // Phase 1 pinned the ungated duplicate; Phase 5 flips it to a rejected record-creation action.
  it("rejects duplicating an allocation whose start is company-non-working", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [1, 2, 3, 4] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New allocations must begin on a company and personal working day. Move the start date.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });

  it("rejects duplicating even an ignored allocation whose start is non-effective (no escape hatch)", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [1, 2, 3, 4] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
      ignoreWeekends: true,
    });
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(useStore.getState().data.allocations).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "New allocations must begin on a company and personal working day. Move the start date.",
    );
  });

  it("rejects duplicating a normal allocation for a zero-overlap person", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1] });
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});

describe("AllocationModal inline activity creation pref", () => {
  const addPerson = () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    return useStore.getState().data.resources[0].id;
  };

  it('renders the inline "Add activity" input + button by default (pref absent → enabled)', () => {
    const resourceId = addPerson();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText("New activity name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add activity" })).toBeInTheDocument();
  });

  it("places an inline-created project activity in the project-specific group", async () => {
    useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
    const resourceId = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />,
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

  it('hides the inline "Add activity" input + button when inlineActivityCreateEnabled is false — the Activity picker still works', () => {
    const resourceId = addPerson();
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: false });
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />,
    );
    // The inline creator is gone…
    expect(screen.queryByLabelText("New activity name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add activity" })).not.toBeInTheDocument();
    // …but the Activity SelectField is still rendered and usable.
    expect(screen.getByRole("combobox", { name: "Activity" })).toBeInTheDocument();
  });

  it("removes inline activity creation when an open editor modal is downgraded to viewer", async () => {
    const resourceId = addPerson();
    const user = userEvent.setup();
    const view = render(
      <PermissionContext.Provider value={{ role: "editor" }}>
        <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />
      </PermissionContext.Provider>,
    );
    await user.type(screen.getByLabelText("New activity name"), "Unsaved viewer activity");

    view.rerender(
      <PermissionContext.Provider value={{ role: "viewer" }}>
        <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={vi.fn()} />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByLabelText("New activity name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add activity" })).not.toBeInTheDocument();
    expect(useStore.getState().data.activities).toHaveLength(2);
  });
});

describe("AllocationModal Enter key submission", () => {
  it("operates the Hours / day select with the keyboard", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    const hours = screen.getByRole("combobox", { name: "Hours / day" });
    hours.focus();
    fireEvent.keyDown(hours, { key: "ArrowDown" });
    await user.keyboard("2{Enter}");
    expect(hours).toHaveTextContent("2 h - quarter day");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toEqual([expect.objectContaining({ hoursPerDay: 2 })]);
  });

  it("submits when Enter is pressed in the single-line Note input", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    const noteInput = screen.getByLabelText("Note");
    expect(noteInput).toHaveAttribute("type", "text");
    await user.click(noteInput);
    await user.keyboard("{Enter}");

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });

  it("pressing Enter in the new-activity input calls onAddActivity, not submit", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
    );

    // Type an activity name into the inline "add new activity" input and press Enter
    await user.click(screen.getByLabelText("New activity name"));
    await user.type(screen.getByLabelText("New activity name"), "Brand new activity");
    await user.keyboard("{Enter}");

    // The activity should have been created, modal not closed
    expect(onClose).not.toHaveBeenCalled();
    const activities = useStore.getState().data.activities;
    expect(activities.find((activity) => activity.name === "Brand new activity")).toMatchObject({ kind: "internal" });
    expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent("Brand new activity");
  });
});

// These cases drive many sequential user interactions and can exceed Vitest's 5 s default on CI hardware.
describe("AllocationModal repeat creation", { timeout: 15_000 }, () => {
  const addPerson = () => useStore.getState().addResource(makeResourceDraft({ name: "Tyler", color: "#111111" }));

  const completeAssignment = async (user: ReturnType<typeof userEvent.setup>) => {
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
  };

  it("shows all six create-only options, defaults to one-off and dirty-tracks repeat changes", async () => {
    const resource = addPerson();
    const { unmount } = render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    const repeat = screen.getByRole("combobox", { name: "Repeat" });
    expect(repeat).toHaveTextContent("Doesn’t repeat");
    fireEvent.keyDown(repeat, { key: "ArrowDown" });
    for (const option of ["Doesn’t repeat", "Weekly", "Every 2 weeks", "Every 3 weeks", "Every 4 weeks", "Monthly"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("option", { name: "Weekly" }));
    const repeatUntil = screen.getByLabelText("Repeat until");
    expect(repeatUntil).toHaveValue("2099-08-31");
    expect(repeatUntil).toHaveAttribute("aria-required", "true");
    expect(repeatUntil).toHaveAttribute("min", "2099-06-01");
    expect(repeatUntil).toHaveAttribute("max", "2099-12-01");
    expect(useStore.getState().dirtyForm).toBe(true);
    unmount();

    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
  });

  it("defaults from the allocation start, follows untouched starts, and preserves a hand-edited cutoff", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2027-12-03", endDate: "2027-12-05" }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, "Repeat", "Weekly");
    const repeatUntil = screen.getByLabelText("Repeat until");
    expect(repeatUntil).toHaveValue("2028-02-29");

    const start = screen.getByLabelText("Start Date");
    await user.clear(start);
    await user.type(start, "2028-01-10");
    expect(repeatUntil).toHaveValue("2028-03-31");

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2028-04-15");
    await user.clear(start);
    await user.type(start, "2028-02-10");
    expect(repeatUntil).toHaveValue("2028-04-15");
  });

  it("clamps the suggested cutoff at the supported date boundary", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "9999-11-15", endDate: "9999-11-16" }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, "Repeat", "Monthly");
    expect(screen.getByLabelText("Repeat until")).toHaveValue("9999-12-31");
    expect(screen.getByLabelText("Repeat until")).toHaveAttribute("max", "9999-12-31");
  });

  it("previews every cadence with formatShortDate and creates weekly through one bulk call", async () => {
    const resource = addPerson();
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const oneSpy = vi.spyOn(useStore.getState(), "addAllocation");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);

    for (const [choice, count, lastStart] of [
      ["Weekly", 14, "Mon 31st Aug"],
      ["Every 2 weeks", 7, "Mon 24th Aug"],
      ["Every 3 weeks", 5, "Mon 24th Aug"],
      ["Every 4 weeks", 4, "Mon 24th Aug"],
      ["Monthly", 4, "Tue 1st Sep"],
    ] as const) {
      await chooseOption(user, "Repeat", choice);
      await user.clear(screen.getByLabelText("Repeat until"));
      await user.type(screen.getByLabelText("Repeat until"), "2099-09-01");
      expect(
        await screen.findByText(`Creates ${count} linked allocations through Tue 1st Sep. Last start: ${lastStart}.`),
      ).toBeInTheDocument();
    }

    await chooseOption(user, "Repeat", "Weekly");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(oneSpy).not.toHaveBeenCalled();
    expect(bulkSpy).toHaveBeenCalledTimes(1);
    const drafts = bulkSpy.mock.calls[0][0];
    expect(drafts).toHaveLength(14);
    expect(drafts[0]).toMatchObject({ startDate: "2099-06-01", endDate: "2099-06-03" });
    expect(drafts.at(-1)).toMatchObject({ startDate: "2099-08-31", endDate: "2099-09-02" });
    const seriesIds = drafts.map(({ seriesId }) => seriesId);
    expect(seriesIds[0]).toEqual(expect.any(String));
    expect(new Set(seriesIds).size).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    bulkSpy.mockRestore();
    oneSpy.mockRestore();
  });

  it.each([
    ["Internal", "Operations", undefined],
    ["No specific project", "Planning", undefined],
    ["Acme / Lightning", "Planning", "p1"],
  ] as const)(
    "derives every repeated allocation's attribution for the %s scope",
    async (scope, activityName, projectId) => {
      useStore.getState().addActivity({ name: "Operations", kind: "internal" });
      useStore.getState().addActivity({ name: "Planning", kind: "repeatable" });
      const resource = addPerson();
      const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
      const user = userEvent.setup();
      render(
        <AllocationModal
          create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
          onClose={vi.fn()}
        />,
      );

      await chooseOption(user, "Project", scope);
      await chooseOption(user, "Activity", activityName);
      await chooseOption(user, "Repeat", "Weekly");
      await user.click(screen.getByRole("button", { name: "Save" }));

      const drafts = bulkSpy.mock.calls[0][0];
      expect(drafts.length).toBeGreaterThan(1);
      for (const draft of drafts) {
        if (projectId) expect(draft).toHaveProperty("projectId", projectId);
        else expect(draft).not.toHaveProperty("projectId");
      }
      bulkSpy.mockRestore();
    },
  );

  it("keeps the original monthly numeric day while preserving a multi-day span", async () => {
    // A seven-day company and person make the Saturday day-31 anchor an effective start — the
    // creation gate has no override (no ignored-creation escape hatch), so the numeric-day
    // preservation under test needs a calendar that genuinely allows the anchor.
    useStore.getState().updateAccount(ACC, { workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-01-31", endDate: "2099-02-02" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Monthly");
    await user.clear(screen.getByLabelText("Repeat until"));
    await user.type(screen.getByLabelText("Repeat until"), "2099-04-30");
    expect(
      await screen.findByText("Creates 4 linked allocations through Thu 30th Apr. Last start: Thu 30th Apr."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/clamp|month-end|fallback/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(bulkSpy.mock.calls[0][0].map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ["2099-01-31", "2099-02-02"],
      ["2099-02-28", "2099-03-02"],
      ["2099-03-31", "2099-04-02"],
      ["2099-04-30", "2099-05-02"],
    ]);
    bulkSpy.mockRestore();
  });

  it.each(["days", "blocks"] as const)(
    "rejects a %s repeat when a later occurrence cannot fit the complete working span",
    async (schedulingMode) => {
      useStore.getState().updateAccount(ACC, { schedulingMode, workingDays: [0, 1, 2, 3, 4, 5, 6] });
      const resource = useStore.getState().addResource({
        ...person("Tyler"),
        workingDays: [0, 1, 2, 3, 4, 5, 6],
      });
      const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <AllocationModal
          create={{ resourceId: resource.id, startDate: "9999-09-30", endDate: "9999-10-02" }}
          onClose={onClose}
        />,
      );
      await completeAssignment(user);
      await chooseOption(user, "Repeat", "Monthly");
      await user.clear(screen.getByLabelText("Repeat until"));
      await user.type(screen.getByLabelText("Repeat until"), "9999-12-30");

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose an earlier Repeat until date or a longer cadence; this repeat cannot fit the supported date range.",
      );
      expect(screen.queryByText(/creates 4 linked allocations/i)).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: /new allocation/i })).toBeInTheDocument();
      expect(bulkSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      bulkSpy.mockRestore();
    },
  );

  it("routes a zero-overlap repeat to the assignee/form error instead of Repeat until", async () => {
    useStore.getState().updateAccount(ACC, { workingDays: [2] });
    const resource = useStore.getState().addResource({ ...person("Tyler"), workingDays: [1] });
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Weekly");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This person has no working days within the company's current working week.");
    expect(alert).not.toHaveTextContent(/repeat until|supported date range/i);
    expect(screen.getByLabelText("Repeat until")).not.toHaveAttribute("aria-invalid", "true");
    expect(bulkSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    bulkSpy.mockRestore();
  });

  it("keeps one-off on addAllocation and leaves a rejected bulk dialog open", async () => {
    const resource = addPerson();
    const oneSpy = vi.spyOn(useStore.getState(), "addAllocation");
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    const first = render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(oneSpy).toHaveBeenCalledTimes(1);
    expect(bulkSpy).not.toHaveBeenCalled();
    first.unmount();
    oneSpy.mockRestore();
    bulkSpy.mockRestore();
    useStore.setState({ addAllocation: originalAddAllocation, addAllocations: originalAddAllocations });

    const rejectBulk = vi.spyOn(useStore.getState(), "addAllocations").mockImplementation(() => {
      throw new Error("The generated batch was rejected.");
    });
    const onClose = vi.fn();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Every 3 weeks");
    await user.clear(screen.getByLabelText("Repeat until"));
    await user.type(screen.getByLabelText("Repeat until"), "2099-09-01");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: /new allocation/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The generated batch was rejected.");
    expect(onClose).not.toHaveBeenCalled();
    rejectBulk.mockRestore();
  });

  it("validates the required, temporal and six-month Repeat until boundaries", async () => {
    useStore.getState().updateAccount(ACC, { timezone: "UTC" });
    const resource = addPerson();
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Weekly");
    const repeatUntil = screen.getByLabelText("Repeat until");
    const save = screen.getByRole("button", { name: "Save" });

    await user.clear(repeatUntil);
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose when the repeat should end.");

    await user.type(repeatUntil, addDaysISO(todayISO("UTC"), -1));
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Repeat until cannot be before today.");

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2099-05-31");
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Repeat until cannot be before the allocation start.");

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2099-12-02");
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Repeat until cannot be later than Tue 1st Dec (six calendar months after the allocation start).",
    );

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2099-06-07");
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a later Repeat until date so this cadence includes at least one repeat.",
    );
    expect(bulkSpy).not.toHaveBeenCalled();
    bulkSpy.mockRestore();
  });

  it("includes an occurrence on the cutoff and supports the complete six-month weekly range", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Weekly");
    const repeatUntil = screen.getByLabelText("Repeat until");

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2099-06-08");
    expect(
      await screen.findByText("Creates 2 linked allocations through Mon 8th Jun. Last start: Mon 8th Jun."),
    ).toBeInTheDocument();

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2099-12-01");
    expect(
      await screen.findByText("Creates 27 linked allocations through Tue 1st Dec. Last start: Mon 30th Nov."),
    ).toBeInTheDocument();
  });

  it("aggregates singular/plural repeat advisory fragments and keeps saving advisory-only", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Weekly");
    capacityAdvisoryMock.mockClear();
    let call = 0;
    capacityAdvisoryMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return { overDays: 1, timeOffDays: 1 };
      if (call === 2) return { overDays: 0, timeOffDays: 1 };
      return { overDays: 0, timeOffDays: 0 };
    });
    await user.clear(screen.getByLabelText("Repeat until"));
    await user.type(screen.getByLabelText("Repeat until"), "2099-09-01");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "For this repeat, 1 allocation may exceed capacity and 2 allocations overlap time off. Saving is still allowed.",
    );
    expect(capacityAdvisoryMock).toHaveBeenCalledTimes(14);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("surfaces monthly occurrences whose starts fall outside the effective week", async () => {
    const resource = useStore.getState().addResource({ ...person("Tyler"), workingDays: [1] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-01" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Monthly");
    await user.clear(screen.getByLabelText("Repeat until"));
    await user.type(screen.getByLabelText("Repeat until"), "2099-09-01");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "For this repeat, 3 allocations start on a non-working day. Saving is still allowed.",
    );
  });

  it("duplicates exactly one allocation through the single-row path and never exposes Repeat", async () => {
    const resource = addPerson();
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const oneSpy = vi.spyOn(useStore.getState(), "addAllocation");
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    render(<AllocationModal allocationId={allocation.id} onClose={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(oneSpy).toHaveBeenCalledTimes(1);
    expect(bulkSpy).not.toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(2);
    oneSpy.mockRestore();
    bulkSpy.mockRestore();
  });
});

describe("AllocationModal lifecycle", () => {
  it("closes when the allocation being edited disappears from the store", () => {
    const resource = useStore.getState().addResource(person("Barbara"));
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const onClose = vi.fn();
    render(<AllocationModal allocationId={allocation.id} onClose={onClose} />);

    act(() => useStore.getState().deleteAllocation(allocation.id));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves a partially edited draft across equivalent parent props", () => {
    const resource = useStore.getState().addResource(person("Barbara"));
    const onClose = vi.fn();
    const view = render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-06-05" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Hours / day" }));
    fireEvent.click(screen.getByRole("option", { name: "4 h - half day" }));

    view.rerender(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("End")).toHaveValue("2026-06-05");
    expect(screen.getByRole("combobox", { name: "Hours / day" })).toHaveTextContent("4 h - half day");
  });
});
