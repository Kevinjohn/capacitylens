import type { StateCreator, StoreApi } from "zustand";
import type { PlanningIntent } from "@capacitylens/backend/planning";
import { assertAllocationWithinResourceAvailability, assertDateRange } from "@capacitylens/shared/domain/mutations";
import { assertAllocationPlacement } from "@capacitylens/shared/domain/placement";
import { newId } from "@capacitylens/shared/lib/id";
import { clampHoursPerDay, emptyAppData } from "@capacitylens/shared/types/entities";
import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { Allocation, AppData, ID } from "@capacitylens/shared/types/entities";
import { createPlanningCacheController, createPlanningCacheState } from "@/data/planning/planningCacheController";
import type { PlanningCacheState, PlanningTransport } from "@/data/planning/planningCacheController";
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
} from "@/data/planning/planningCommands";
import type { PlanningCommand } from "@/data/planning/planningCommands";
import type { StoreInternals } from "@/store/storeInternal";
import type { Draft, Patch, StoreState } from "@/store/types";

type AllocationSlice = Pick<
  StoreState,
  | "planning"
  | "addAllocation"
  | "addAllocations"
  | "duplicateAllocation"
  | "updateAllocation"
  | "deleteAllocation"
  | "deleteAllocationSeriesFrom"
  | "refreshPlanning"
  | "undoPlanning"
  | "redoPlanning"
>;

/** Store capabilities used by allocation actions. */
export type AllocationSliceInternals = Pick<
  StoreInternals,
  "requireAccount" | "blockedByViewer" | "assertAllocation" | "resolveOwnedRow" | "applyPatch"
>;

// Planning identity is page-local: sign-in and sign-out reload the page, and authority changes
// within it arrive through the transport's access key.
const PAGE_IDENTITY = Symbol("page planning identity");

// A delete's Undo uses the server's restoration handle, which the controller fills from the receipt.
const RESTORE_FROM_RECEIPT: PlanningIntent = { operation: "planning.restoreGroup", restorationGroupId: "" };

/**
 * Publishes the controller's view into the one store. The controller owns allocations and its
 * metadata; legacy persistence still owns every other table, so ordinary publications replace only
 * the planning company's allocations. Losing authority clears the whole cache and both histories.
 */
function publishPlanning(state: StoreState, next: Partial<PlanningCacheState>): Partial<StoreState> {
  const planning = next.planning ?? state.planning;
  if (!next.data) return { planning };
  if (planning.context === null) {
    return {
      data: emptyAppData(),
      planning,
      past: [],
      future: [],
      activeAccountId: null,
      previousAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
    };
  }
  // A new context publishes nothing yet: its first canonical read replaces its allocations.
  if (state.planning.context?.companyId !== planning.context.companyId) return { planning };
  const companyId = planning.context.companyId;
  return {
    planning,
    data: {
      ...state.data,
      allocations: [
        ...state.data.allocations.filter((allocation) => allocation.accountId !== companyId),
        ...next.data.allocations.filter((allocation) => allocation.accountId === companyId),
      ],
    },
  };
}

function validateNewAllocations(
  internals: AllocationSliceInternals,
  data: AppData,
  accountId: ID,
  inputs: readonly Draft<Allocation>[],
): void {
  const account = data.accounts.find((candidate) => candidate.id === accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? 1);
  for (const input of inputs) {
    const allocation = { ...NULLABLE_FIELDS.allocations, ...input, accountId };
    internals.assertAllocation(
      data,
      accountId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId,
    );
    assertDateRange(allocation.startDate, allocation.endDate);
    const resource = data.resources.find(
      (candidate) => candidate.accountId === accountId && candidate.id === allocation.resourceId,
    );
    if (resource) assertAllocationWithinResourceAvailability({ allocation, resource, accountWorkingDays });
  }
}

function assertAvailabilityAfterPlacementChange(data: AppData, effective: Allocation, existing: Allocation): void {
  const resource = data.resources.find(
    (candidate) => candidate.accountId === existing.accountId && candidate.id === effective.resourceId,
  );
  const account = data.accounts.find((candidate) => candidate.id === existing.accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? 1);
  if (resource) assertAllocationPlacement({ allocation: effective, existing, resource, accountWorkingDays });
}

function requireCommand(command: PlanningCommand | null): PlanningCommand {
  if (!command) throw new Error("The allocation could not be prepared for saving.");
  return command;
}

function createdRows(get: StoreApi<StoreState>["getState"], ids: readonly ID[]): Allocation[] {
  const rows = ids.map((id) => get().data.allocations.find((allocation) => allocation.id === id));
  if (rows.some((row) => !row)) throw new Error("Allocation creation produced no row.");
  return rows as Allocation[];
}

/** Create allocation actions backed by the planning cache controller. */
export function createAllocationSlice(
  internals: AllocationSliceInternals,
  transport: PlanningTransport,
): StateCreator<StoreState, [], [], AllocationSlice> {
  return (set, get) => {
    const { requireAccount, blockedByViewer, assertAllocation, resolveOwnedRow, applyPatch } = internals;
    const controller = createPlanningCacheController({
      getState: () => ({ data: get().data, planning: get().planning }),
      setState: (update) =>
        set((state) => publishPlanning(state, update({ data: state.data, planning: state.planning }))),
      transport,
    });
    const send = async (command: PlanningCommand, original: unknown = null): Promise<void> => {
      await controller.execute(controller.begin(original), command.intent, command.inverse);
    };
    const prepareNew = (inputs: readonly Draft<Allocation>[]) => {
      if (inputs.length === 0) throw new Error("At least one allocation is required.");
      const accountId = requireAccount();
      if (blockedByViewer()) return null;
      const data = get().data;
      const clamped = inputs.map((input) => ({ ...input, hoursPerDay: clampHoursPerDay(input.hoursPerDay) }));
      validateNewAllocations(internals, data, accountId, clamped);
      // Row ids are minted here, on the typed command path; the server assigns any series id.
      return { accountId, data, drafts: clamped.map((fields) => ({ id: newId(), fields })) };
    };

    return {
      planning: createPlanningCacheState().planning,
      addAllocation: async (input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: "blocked" };
        const [draft] = prepared.drafts;
        if (!draft) throw new Error("Allocation creation produced no row.");
        await send(requireCommand(buildAllocationCreate({ ...prepared, args: draft })));
        const [created] = createdRows(get, [draft.id]);
        if (!created) throw new Error("Allocation creation produced no row.");
        return { kind: "created", value: created };
      },
      addAllocations: async (inputs) => {
        const prepared = prepareNew(inputs);
        if (!prepared) return { kind: "blocked" };
        const allocations = prepared.drafts.map((draft) => {
          const command = requireCommand(buildAllocationCreate({ ...prepared, args: draft }));
          if (command.intent.operation !== "allocation.create") throw new Error("Unexpected allocation command.");
          return command.intent.allocation;
        });
        const ids = prepared.drafts.map((draft) => draft.id);
        await send({
          intent: { operation: "allocation.createGroup", allocations },
          inverse: { operation: "allocation.deleteGroup", ids },
        });
        return { kind: "created", value: createdRows(get, ids) };
      },
      duplicateAllocation: async (sourceId, input) => {
        const prepared = prepareNew([input]);
        if (!prepared) return { kind: "blocked" };
        const [draft] = prepared.drafts;
        const original = resolveOwnedRow(prepared.data, "allocations", sourceId);
        if (!draft || !original) throw new Error("The allocation to duplicate no longer exists.");
        await send(
          requireCommand(
            buildAllocationDuplicate({ ...prepared, original, args: { sourceId, id: draft.id, fields: draft.fields } }),
          ),
        );
        const [created] = createdRows(get, [draft.id]);
        if (!created) throw new Error("Allocation creation produced no row.");
        return { kind: "created", value: created };
      },
      updateAllocation: async (id, patch) => {
        const data = get().data;
        const existing = resolveOwnedRow(data, "allocations", id);
        if (!existing || blockedByViewer()) return false;
        // Clamp first (same shared clamp as creation and import) so validation sees the value
        // that would actually be stored. A drag-resize rescale past 24h must land on 24 like
        // every other write boundary, not reject after the fact.
        const changes: Patch<Allocation> =
          patch.hoursPerDay !== undefined ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) } : patch;
        const effective = applyPatch(existing, changes);
        // Validate the merged row so unrelated edits cannot preserve invalid external-resource
        // load that the server would reject.
        assertAllocation(
          data,
          existing.accountId,
          effective.resourceId,
          effective.activityId,
          effective.hoursPerDay,
          effective.projectId,
          existing,
        );
        assertDateRange(effective.startDate, effective.endDate);
        assertAvailabilityAfterPlacementChange(data, effective, existing);
        const command = buildAllocationUpdate({
          data,
          accountId: existing.accountId,
          original: existing,
          args: { id, changes },
        });
        if (!command) return false;
        await send(command, existing);
        return true;
      },
      deleteAllocation: async (id) => {
        if (blockedByViewer() || !resolveOwnedRow(get().data, "allocations", id)) return;
        await send({ intent: { operation: "allocation.delete", id }, inverse: RESTORE_FROM_RECEIPT });
      },
      deleteAllocationSeriesFrom: async (id) => {
        if (blockedByViewer()) return;
        const target = resolveOwnedRow(get().data, "allocations", id);
        if (!target) return;
        if (!target.seriesId) throw new Error("This allocation is not part of a repeat series.");
        const { accountId, seriesId, startDate } = target;
        // One typed write deletes the whole tail, so a single Undo restores it.
        const ids = get()
          .data.allocations.filter(
            (allocation) =>
              allocation.accountId === accountId &&
              allocation.seriesId === seriesId &&
              allocation.startDate >= startDate,
          )
          .map((allocation) => allocation.id);
        await send({ intent: { operation: "allocation.deleteGroup", ids }, inverse: RESTORE_FROM_RECEIPT });
      },
      refreshPlanning: async () => {
        const companyId = get().activeAccountId;
        if (companyId === null) return false;
        controller.setContext({ identity: PAGE_IDENTITY, companyId });
        // A canonical read alone never settles an uncertain write; only its commitment lookup can,
        // so every refresh trigger (focus, interval, legacy save) reconciles first.
        if (get().planning.outcome?.kind === "uncertain" && (await controller.reconcile())) return true;
        return controller.refresh();
      },
      undoPlanning: () => (blockedByViewer() ? Promise.resolve(false) : controller.undo()),
      redoPlanning: () => (blockedByViewer() ? Promise.resolve(false) : controller.redo()),
    };
  };
}
