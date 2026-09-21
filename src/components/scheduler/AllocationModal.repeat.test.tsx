import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { addDaysISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import { chooseOption } from "./__tests__/schedulerTestKit";
import {
  ACC,
  person,
  addPerson,
  completeAssignment,
  resetAllocationModalStore,
  restoreStoreAllocationActions,
} from "./__tests__/allocationModalTestKit";

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

// These cases drive many sequential user interactions and can exceed Vitest's 5 s default on CI hardware.
describe("AllocationModal repeat creation", { timeout: 15_000 }, () => {
  it("shows all six create-only options, defaults to one-off and dirty-tracks repeat changes", async () => {
    const resource = addPerson();
    const { unmount } = render(
      <AllocationModal
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
  });

  it("defaults from the allocation start, follows untouched starts, and preserves a hand-edited cutoff", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
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
        kind="create"
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
        kind="create"
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
    const drafts = bulkSpy.mock.calls[0]?.[0];
    expect(drafts).toBeDefined();
    if (!drafts) throw new Error("Expected repeated allocation drafts.");
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
          kind="create"
          create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
          onClose={vi.fn()}
        />,
      );

      await chooseOption(user, "Project", scope);
      await chooseOption(user, "Activity", activityName);
      await chooseOption(user, "Repeat", "Weekly");
      await user.click(screen.getByRole("button", { name: "Save" }));

      const drafts = bulkSpy.mock.calls[0]?.[0];
      expect(drafts).toBeDefined();
      if (!drafts) throw new Error("Expected repeated allocation drafts.");
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
        kind="create"
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
    expect(bulkSpy.mock.calls[0]?.[0]?.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
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
          kind="create"
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
        kind="create"
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
        kind="create"
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
    restoreStoreAllocationActions();

    const rejectBulk = vi.spyOn(useStore.getState(), "addAllocations").mockImplementation(() => {
      throw new Error("The generated batch was rejected.");
    });
    const onClose = vi.fn();
    render(
      <AllocationModal
        kind="create"
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
        kind="create"
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
        kind="create"
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

  it("dates both ends of the preview once the repeat runs into the next year", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2099-12-21", endDate: "2099-12-23" }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, "Repeat", "Weekly");
    const repeatUntil = screen.getByLabelText("Repeat until");

    await user.clear(repeatUntil);
    await user.type(repeatUntil, "2100-01-11");
    // Undated, this reads "through Mon 11th Jan. Last start: Mon 11th Jan." — a forward repeat that
    // appears to end eleven months before it starts.
    expect(
      await screen.findByText("Creates 4 linked allocations through Mon 11th Jan 2100. Last start: Mon 11th Jan 2100."),
    ).toBeInTheDocument();
  });

  it("aggregates singular/plural repeat advisory fragments and keeps saving advisory-only", async () => {
    const resource = addPerson();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
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
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(oneSpy).toHaveBeenCalledTimes(1);
    expect(bulkSpy).not.toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(2);
    oneSpy.mockRestore();
    bulkSpy.mockRestore();
  });

  it("surfaces an availability error when duplication would recreate retained conflicting dates", async () => {
    const resource = addPerson();
    const allocation = useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });
    useStore.getState().updateResource(resource.id, { firstAvailableDate: "2026-06-08" });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/before this person is available/i);
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});
