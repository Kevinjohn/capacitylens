import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import type { AppData } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeAppData, setExternalEnabled, setPlaceholdersEnabled } from "../../test/fixtures";
import { PermissionContext } from "../../auth/permissionContext";

const capacityAdvisoryMock = vi.hoisted(() => vi.fn(() => ({ overDays: 0, timeOffDays: 0 })));
// The mock is declared without a parameter list, so reach its recorded arguments through a cast:
// tests assert on the `otherAllocations` the modal passes (its scheduling-mode projection of the
// existing load), not merely on how often the advisory ran.
const lastAdvisoryOthers = () => (capacityAdvisoryMock.mock.calls.at(-1) as unknown as unknown[] | undefined)?.[1];
vi.mock("../../lib/capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/capacity")>()),
  capacityAdvisory: capacityAdvisoryMock,
}));

const ACC = DEFAULT_ACCOUNT_ID;
const originalAddAllocation = useStore.getState().addAllocation;
const originalAddAllocations = useStore.getState().addAllocations;

async function chooseOption(_user: ReturnType<typeof userEvent.setup>, label: string, optionName: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function base(): AppData {
  return makeAppData({
    clients: [
      {
        id: "c1",
        accountId: ACC,
        createdAt: "t",
        updatedAt: "t",
        name: "Acme",
        color: "#111",
      },
    ],
    projects: [
      {
        id: "p1",
        accountId: ACC,
        createdAt: "t",
        updatedAt: "t",
        name: "Lightning",
        clientId: "c1",
        color: "#ec4899",
      },
      {
        id: "p2",
        accountId: ACC,
        createdAt: "t",
        updatedAt: "t",
        name: "Other",
        clientId: "c1",
        color: "#06b6d4",
      },
    ],
    activities: [
      {
        id: "t1",
        accountId: ACC,
        createdAt: "t",
        updatedAt: "t",
        name: "Wireframes",
        kind: "project",
        projectId: "p1",
      },
      {
        id: "t2",
        accountId: ACC,
        createdAt: "t",
        updatedAt: "t",
        name: "Other activity",
        kind: "project",
        projectId: "p2",
      },
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
      "Any Project",
      "Acme / Lightning",
      "Acme / Other",
      "Zeta / Alpha",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Internal" }));

    const activity = screen.getByRole("combobox", { name: "Activity" });
    fireEvent.keyDown(activity, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Admin", "Support"]);
    fireEvent.click(screen.getByRole("option", { name: "Admin" }));

    await chooseOption(user, "Project", "Any Project");
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

    expect(screen.getByLabelText("Hours / day")).toHaveValue(4);
  });

  it("gives same-named activity options distinct accessible labels", async () => {
    useStore.getState().addActivity({ name: "Wireframes", kind: "project", projectId: "p1" });
    const resource = useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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
  });

  it("rejects an empty date or zero hours instead of saving a broken allocation", async () => {
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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

    // Zero hours is rejected too (would silently occupy a lane with no load).
    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2026-06-01" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hours / day"), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/greater than 0/i);
    expect(screen.getByLabelText("Hours / day")).toHaveFocus();
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("rejects hours/day above the 24h cap submitted via Enter (no silent clamp)", async () => {
    // The field caps at MAX_HOURS_PER_DAY on blur, but an Enter-submit without a blur can still
    // carry a larger value the store would quietly clamp. The submit-path guard must reject it.
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    const hours = screen.getByLabelText("Hours / day");
    fireEvent.change(hours, { target: { value: "40" } });
    fireEvent.submit(hours.closest("form")!); // Enter-submit, no blur clamp

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/can’t exceed 24/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("restricts a placeholder to its bound project plus the two general scopes, defaulting to it", async () => {
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
    // Bound project + both project-less scopes are offered; another project (p2 / "Other") is not.
    fireEvent.keyDown(projectSelect, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Internal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Any Project" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Acme / Other" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Only the bound project's activity is offered.
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      resourceId: ph.id,
      activityId: "t1",
    });
  });
});

const person = (name: string) => ({
  kind: "person" as const,
  name,
  role: "Dev",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as const,
  halfDays: [],
  color: "#111",
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
});

describe("AllocationModal days mode", () => {
  const enableDays = () => useStore.getState().updateAccount(ACC, { schedulingMode: "days" });

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
    fireEvent.change(screen.getByLabelText("Hours / day"), { target: { value: "6" } });
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

  it("reopens a placeholder cross-project allocation with its exact scope still selected", async () => {
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
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Any Project");
    expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent("Admin");
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
    fireEvent.change(screen.getByLabelText("Hours / day"), {
      target: { value: "4" },
    });
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

describe("AllocationModal inline activity creation pref", () => {
  const addPerson = () => {
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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
  it("submits when Enter is pressed in the Hours/day input (hourly mode)", async () => {
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
    const resourceId = useStore.getState().data.resources[0].id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }} onClose={onClose} />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    // Pressing Enter in the Hours/day number input should submit
    await user.click(screen.getByLabelText("Hours / day"));
    await user.keyboard("{Enter}");

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });

  it("submits when Enter is pressed in the single-line Note input", async () => {
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111",
    });
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

describe("AllocationModal repeat creation", () => {
  const addPerson = () =>
    useStore.getState().addResource({
      kind: "person",
      name: "Tyler",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#111111",
    });

  const completeAssignment = async (user: ReturnType<typeof userEvent.setup>) => {
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
  };

  it("shows all six create-only options, defaults to one-off and dirty-tracks repeat changes", async () => {
    const resource = addPerson();
    const { unmount } = render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
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

  it("previews every cadence with formatShortDate and creates weekly through one bulk call", async () => {
    const resource = addPerson();
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const oneSpy = vi.spyOn(useStore.getState(), "addAllocation");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
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
      expect(
        screen.getByText(`Creates ${count} independent allocations. Last start: ${lastStart}.`),
      ).toBeInTheDocument();
    }

    await chooseOption(user, "Repeat", "Weekly");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(oneSpy).not.toHaveBeenCalled();
    expect(bulkSpy).toHaveBeenCalledTimes(1);
    const drafts = bulkSpy.mock.calls[0][0];
    expect(drafts).toHaveLength(14);
    expect(drafts[0]).toMatchObject({ startDate: "2026-06-01", endDate: "2026-06-03" });
    expect(drafts.at(-1)).toMatchObject({ startDate: "2026-08-31", endDate: "2026-09-02" });
    expect(onClose).toHaveBeenCalledTimes(1);
    bulkSpy.mockRestore();
    oneSpy.mockRestore();
  });

  it("keeps the original monthly numeric day while preserving a multi-day span", async () => {
    const resource = addPerson();
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2027-01-31", endDate: "2027-02-02" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Monthly");
    expect(screen.getByText("Creates 4 independent allocations. Last start: Fri 30th Apr.")).toBeInTheDocument();
    expect(screen.queryByText(/clamp|month-end|fallback/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(bulkSpy.mock.calls[0][0].map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ["2027-01-31", "2027-02-02"],
      ["2027-02-28", "2027-03-02"],
      ["2027-03-31", "2027-04-02"],
      ["2027-04-30", "2027-05-02"],
    ]);
    bulkSpy.mockRestore();
  });

  it.each(["days", "blocks"] as const)(
    "rejects a %s repeat when a later occurrence cannot fit the complete working span",
    async (schedulingMode) => {
      useStore.getState().updateAccount(ACC, { schedulingMode });
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
      expect(screen.queryByText(/creates 4 independent allocations/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Repeating allocations cannot extend beyond the supported date range.",
      );
      expect(screen.getByRole("dialog", { name: /new allocation/i })).toBeInTheDocument();
      expect(bulkSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      bulkSpy.mockRestore();
    },
  );

  it("keeps one-off on addAllocation and leaves a rejected bulk dialog open", async () => {
    const resource = addPerson();
    const oneSpy = vi.spyOn(useStore.getState(), "addAllocation");
    const bulkSpy = vi.spyOn(useStore.getState(), "addAllocations");
    const user = userEvent.setup();
    const first = render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
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
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Every 3 weeks");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: /new allocation/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The generated batch was rejected.");
    expect(onClose).not.toHaveBeenCalled();
    rejectBulk.mockRestore();
  });

  it("aggregates singular/plural repeat advisory fragments and keeps saving advisory-only", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    capacityAdvisoryMock.mockClear();
    let call = 0;
    capacityAdvisoryMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return { overDays: 1, timeOffDays: 1 };
      if (call === 2) return { overDays: 0, timeOffDays: 1 };
      return { overDays: 0, timeOffDays: 0 };
    });
    await chooseOption(user, "Repeat", "Weekly");
    expect(screen.getByRole("status")).toHaveTextContent(
      "For this repeat, 1 allocation may exceed capacity and 2 allocations overlap time off. Saving is still allowed.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
