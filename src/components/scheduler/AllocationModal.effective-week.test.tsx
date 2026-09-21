import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "../../store/useStore";
import { chooseOption, GEOM, indexAtClientX, renderWithTooltip } from "./__tests__/schedulerTestKit";
import { required, ACC, resetAllocationModalStore, person, enableDays } from "./__tests__/allocationModalTestKit";

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
    const modal = render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Days over"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const modalAllocation = required(
      useStore.getState().data.allocations.find(({ id }) => id === allocation.id),
      "Expected the modal-resized allocation.",
    );
    modal.unmount();

    useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-04", hoursPerDay: 8 });
    const resetAllocation = required(
      useStore.getState().data.allocations.find(({ id }) => id === allocation.id),
      "Expected the reset allocation.",
    );
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
    const gestureAllocation = required(
      useStore.getState().data.allocations.find(({ id }) => id === allocation.id),
      "Expected the gesture-resized allocation.",
    );

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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);

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
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);

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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});
