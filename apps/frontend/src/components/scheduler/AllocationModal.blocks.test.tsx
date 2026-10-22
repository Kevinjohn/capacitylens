import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "@/store/useStore";
import { chooseOption } from "./__tests__/schedulerTestKit";
import { ACC, person, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

type CapacityAdvisoryMockInput =
  | Parameters<typeof import("@/lib/capacity").buildCapacityAdvisory>[0]
  | Parameters<typeof import("@/lib/capacity").buildCapacityAdvisoryFromLoad>[0];
const capacityAdvisoryMock = vi.hoisted(() =>
  vi.fn<(input: CapacityAdvisoryMockInput) => { overDays: number; timeOffDays: number }>(() => ({
    overDays: 0,
    timeOffDays: 0,
  })),
);

const lastAdvisoryOthers = () => {
  const input = capacityAdvisoryMock.mock.calls.at(-1)?.[0];
  return input && "otherAllocations" in input ? input.otherAllocations : undefined;
};

// Single and repeat advisory paths share one verdict stub so these modal tests exercise presentation rather than load calculations.
vi.mock("@/lib/capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capacity")>()),
  buildCapacityAdvisory: capacityAdvisoryMock,
  buildCapacityAdvisoryFromLoad: capacityAdvisoryMock,
}));

beforeEach(async () => {
  await resetAllocationModalStore();
  capacityAdvisoryMock.mockClear();
  capacityAdvisoryMock.mockImplementation(() => ({ overDays: 0, timeOffDays: 0 }));
});

const enableBlocks = () => useStore.getState().updateAccount(ACC, { schedulingMode: "blocks" });

describe("AllocationModal blocks mode", () => {
  it("asks only for start + days over, and persists a zero-load span", async () => {
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
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

    expect(screen.queryByLabelText("End")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hours / day")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Days of work")).not.toBeInTheDocument();

    await chooseOption(user, "Project", "Ferris / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-12",
      hoursPerDay: 0,
    });
  });

  it("counts the existing load through the blocks projection, like the grid and the drag path", async () => {
    const r = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
    // Legacy hourly allocation persisted before the account switched to blocks: it keeps its stored
    // 8h/day, and every capacity surface must read it as zero load while the account is in blocks.
    await useStore.getState().addAllocation({
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
          kind="create"
          create={{
            resourceId: r.id,
            startDate: "2026-06-01",
            endDate: "2026-06-05",
          }}
          onClose={vi.fn()}
        />,
      );

    const hourly = renderCreate();
    expect(lastAdvisoryOthers()).toEqual([expect.objectContaining({ hoursPerDay: 8 })]);
    hourly.unmount();

    await enableBlocks();
    capacityAdvisoryMock.mockClear();
    renderCreate();
    // Blocks carry placement but no hourly load. The advisory must not see the legacy 8h and warn
    // "over capacity" on days the grid's over-markers leave clean.
    expect(lastAdvisoryOthers()).toEqual([expect.objectContaining({ hoursPerDay: 0 })]);
  });

  it("rejects a block span that would leave the four-digit-year date domain", async () => {
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
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

    await chooseOption(user, "Project", "Ferris / Lightning");
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
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
    const user = userEvent.setup();

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

    await chooseOption(user, "Project", "Ferris / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 0,
    });
  });

  it("preserves historical hours when editing an existing allocation", async () => {
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: "t1",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    await enableBlocks();
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Note"), "Still scheduled");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)).toMatchObject({
      endDate: "2026-06-07",
      hoursPerDay: 8,
      note: "Still scheduled",
    });
  });

  it("rejects a fractional Days over value instead of rounding the saved span", async () => {
    await enableBlocks();
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person("Bruce"), workingDays: [1, 2, 3, 4, 5] }),
    );
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, "Project", "Ferris / Lightning");
    await chooseOption(user, "Activity", "Wireframes");
    fireEvent.change(screen.getByLabelText("Days over"), {
      target: { value: "1.5" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/whole number from 1/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });
});
