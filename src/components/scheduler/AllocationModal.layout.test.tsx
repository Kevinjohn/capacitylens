import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationModal } from "./AllocationModal";
import { useStore } from "../../store/useStore";
import { chooseOption } from "./__tests__/schedulerTestKit";
import { ACC, person, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

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
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
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
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

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
        kind="create"
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
        kind="create"
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
        kind="create"
        create={{ resourceId: placeholder.id, startDate: "2026-06-01", endDate: "2026-06-03" }}
        onClose={vi.fn()}
      />,
    );
    expectInAllocationControlColumn(screen.getByText("Placeholder — locked to its bound project."));
  });
});
