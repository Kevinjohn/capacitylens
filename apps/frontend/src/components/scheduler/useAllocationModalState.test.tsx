import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Activity, Allocation } from "@capacitylens/shared/types/entities";
import { makeActivity, makeAllocation, makeResourceDraft } from "@/test/fixtures";
import { requireCreated } from "@/test/requireCreated";
import { attachPlanningRuntime } from "@/data/planning/planningRuntime";
import type { PlanningTransport } from "@/data/planning/planningCacheController";
import { createProductionPlanningActions } from "@/data/planning/productionPlanningActions";
import { planningActions, registerPlanningExecutor } from "@/data/planning/planningActions";
import { useStore } from "@/store/useStore";
import { AllocationModal } from "./AllocationModal";
import { ACC, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

const disposers: Array<() => void> = [];
const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const nullableFlag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

beforeEach(() => resetAllocationModalStore());
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

async function setupProductionRuntime() {
  const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce" })));
  useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });

  let canonicalData = useStore.getState().data;
  let revision = 0;
  const read = vi.fn<PlanningTransport["read"]>(async () => ({
    revision,
    canWrite: true,
    data: canonicalData,
  }));
  const execute = vi.fn<PlanningTransport["execute"]>(async (_context, execution) => {
    let projected: { entity: "activities"; row: Activity } | { entity: "allocations"; row: Allocation };
    if (execution.intent.operation === "catalogue.create" && execution.intent.entity.entity === "activities") {
      const { id, fields } = execution.intent.entity;
      projected = {
        entity: "activities",
        row: makeActivity({ ...fields, id, accountId: ACC }),
      };
    } else if (execution.intent.operation === "allocation.create") {
      const allocation = execution.intent.allocation;
      projected = {
        entity: "allocations",
        row: makeAllocation({
          ...allocation,
          projectId: nullableText(allocation.projectId),
          note: nullableText(allocation.note),
          task: nullableText(allocation.task),
          ignoreWeekends: nullableFlag(allocation.ignoreWeekends),
          accountId: ACC,
        }),
      };
    } else {
      throw new Error(`Unexpected planning intent: ${execution.intent.operation}`);
    }
    if (projected.entity === "activities") {
      canonicalData = { ...canonicalData, activities: [...canonicalData.activities, projected.row] };
    } else {
      canonicalData = { ...canonicalData, allocations: [...canonicalData.allocations, projected.row] };
    }
    revision += 1;
    return {
      status: "committed",
      mutationId: execution.mutationId,
      revision,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: {
        mode: "patch",
        history: "retain",
        changed: { upserts: [projected], removed: [] },
      },
    };
  });
  const runtime = attachPlanningRuntime(useStore, { read, execute, lookup: vi.fn() });
  const actions = createProductionPlanningActions(useStore, runtime.controller);
  const detachActions = registerPlanningExecutor(async (name, parameters, draft) =>
    Reflect.apply(actions[name], actions, [...parameters, draft]),
  );
  disposers.push(() => {
    detachActions();
    runtime.dispose();
  });
  await act(async () => {
    await runtime.ready();
  });
  return {
    resource,
    runtime,
    execute,
    async advanceExternalRevision() {
      revision += 1;
      if (!(await runtime.controller.refresh())) throw new Error("Expected external refresh to succeed.");
    },
  };
}

describe("allocation form continuation after inline activity acknowledgement", () => {
  it("advances its captured draft after the inverse-free create and saves against that revision", async () => {
    const { resource, execute } = await setupProductionRuntime();

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={onClose}
      />,
    );
    await user.type(screen.getByLabelText("New activity name"), "Canonical internal activity");
    await user.click(screen.getByRole("button", { name: "Add activity" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Activity" })).toHaveTextContent("Canonical internal activity"),
    );
    expect(useStore.getState().planning.revision).toBe(1);
    expect(useStore.getState().planning.history.tipRevision).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledTimes(2);
    const allocationExecution = execute.mock.calls[1]?.[1];
    expect(allocationExecution).toMatchObject({
      baseRevision: 1,
      intent: { operation: "allocation.create" },
    });
    expect(useStore.getState().data.allocations).toEqual([
      expect.objectContaining({ activityId: useStore.getState().data.activities.at(-1)?.id }),
    ]);
  });

  it("does not rebase the modal when an external revision lands after activity acknowledgement", async () => {
    const { resource, advanceExternalRevision } = await setupProductionRuntime();
    const createActivity = planningActions.addActivity;
    vi.spyOn(planningActions, "addActivity").mockImplementation(async (...parameters) => {
      const result = await createActivity(...parameters);
      await advanceExternalRevision();
      return result;
    });

    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: "2099-06-01", endDate: "2099-06-03" }}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("New activity name"), "Activity before external update");
    await user.click(screen.getByRole("button", { name: "Add activity" }));

    await waitFor(() => expect(useStore.getState().planning.revision).toBe(2));
    expect(screen.getByRole("combobox", { name: "Activity" })).not.toHaveTextContent("Activity before external update");
    expect(screen.getByRole("alert")).toHaveTextContent("Company data changed while adding the activity");
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });
});
