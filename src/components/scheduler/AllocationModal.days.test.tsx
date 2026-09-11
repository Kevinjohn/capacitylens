import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { chooseOption } from "./__tests__/schedulerTestKit";
import {
  required,
  closestForm,
  ACC,
  resetAllocationModalStore,
  person,
  enableDays,
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

describe("AllocationModal days mode", () => {
  it("keeps a missing resource distinct from a resource with no effective working days", async () => {
    enableDays();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: "missing-resource", startDate: "2026-06-01", endDate: "2026-06-05" }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("counts and derives spans through a company-narrowed effective week", async () => {
    enableDays([1, 2, 3, 4]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1, 2, 3, 4, 5] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
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
        kind="create"
        create={{ resourceId: resource.id, startDate: "9999-12-27", endDate: "9999-12-27" }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, "Project", "Acme / Lightning");
    await chooseOption(user, "Activity", "Wireframes");

    const daysOver = screen.getByLabelText("Days over");
    expect(daysOver).toHaveAttribute("max", "4");
    fireEvent.change(daysOver, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Days of work"), { target: { value: "0" } });
    fireEvent.submit(closestForm(daysOver));

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot extend beyond 31 December 9999/i);
    expect(daysOver).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Days of work")).not.toHaveAttribute("aria-invalid", "true");
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it("keeps zero-overlap date math finite but rejects creating a normal allocation", async () => {
    enableDays([2]);
    const resource = useStore.getState().addResource({ ...person("Barbara"), workingDays: [1] });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
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
        kind="create"
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
        kind="create"
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
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

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
        kind="create"
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
        kind="create"
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
        kind="create"
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
        kind="create"
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
        kind="create"
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
    fireEvent.submit(closestForm(daysOver));

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
        kind="create"
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
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));
    const after = required(
      useStore.getState().data.allocations.find((candidate) => candidate.id === alloc.id),
      "Expected the unchanged allocation to remain saved.",
    );
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

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
    render(<AllocationModal kind="edit" allocationId={alloc.id} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Days of work")).toHaveValue(5);
    expect(screen.getByLabelText("Days over")).toHaveValue(10);
  });
});
