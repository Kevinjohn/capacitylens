import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { makeResourceDraft } from "../../test/fixtures";
import { chooseOption } from "./__tests__/schedulerTestKit";
import {
  ACC,
  addPerson,
  closestForm,
  completeAssignment,
  first,
  person,
  resetAllocationModalStore,
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

describe("AllocationModal Enter key submission", () => {
  it("operates the Hours / day select with the keyboard", async () => {
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

    const noteInput = screen.getByLabelText("Note");
    expect(noteInput).toHaveAttribute("type", "text");
    await user.click(noteInput);
    await user.keyboard("{Enter}");

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });

  it("pressing Enter in the new-activity input calls onAddActivity, not submit", async () => {
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce", color: "#111" }));
    const resourceId = first(useStore.getState().data.resources).id;
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
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

describe("AllocationModal submit exclusion", () => {
  it("saves once when two real submit events target a form closed by the first", async () => {
    const resource = addPerson();
    const addAllocation = vi.spyOn(useStore.getState(), "addAllocation");
    const user = userEvent.setup();
    let closeModal = () => {};
    const view = render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={() => closeModal()}
      />,
    );
    closeModal = view.unmount;
    await completeAssignment(user);
    const form = closestForm(screen.getByRole("button", { name: "Save" }));

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(addAllocation).toHaveBeenCalledOnce();
    expect(useStore.getState().data.allocations).toHaveLength(1);
    addAllocation.mockRestore();
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);

    act(() => useStore.getState().deleteAllocation(allocation.id));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves a partially edited draft across equivalent parent props", () => {
    const resource = useStore.getState().addResource(person("Barbara"));
    const onClose = vi.fn();
    const view = render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-06-05" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Hours / day" }));
    fireEvent.click(screen.getByRole("option", { name: "4 h - half day" }));

    view.rerender(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("End")).toHaveValue("2026-06-05");
    expect(screen.getByRole("combobox", { name: "Hours / day" })).toHaveTextContent("4 h - half day");
  });
});
