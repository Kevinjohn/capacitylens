import type { PlanningIntent, PlanningMutationSuccess } from "@capacitylens/backend/planning";
import { newId } from "@capacitylens/shared/lib/id";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import type { Allocation, AppData } from "@capacitylens/shared/types/entities";
import { isServerConfigured } from "@/data/apiConfig";
import { stamp, touchAfter } from "@/store/revisions";
import { PlanningControllerError } from "./planningCacheController";
import type { PlanningTransport } from "./planningCacheController";
import { createPlanningTransport } from "./planningTransport";

type Committed = { allocations: Allocation[]; removed: string[]; replacementGroupId: string | null };

const missing = () => new PlanningControllerError("The allocation no longer exists.", "validation_error", 404);

function companySlice(data: AppData, companyId: string): AppData {
  const slice = { ...data, accounts: data.accounts.filter((account) => account.id === companyId) };
  for (const key of SCOPED_KEYS)
    Object.assign(slice, { [key]: data[key].filter((row) => row.accountId === companyId) });
  return slice;
}

/**
 * The demo build's page-lifetime planning transport. It applies typed allocation intents to the live
 * store rows and returns patch receipts; the controller publishes them. Only revision, commitment and
 * restoration metadata live here, so a reload discards every demo change.
 */
export function createVolatilePlanningTransport(readData: () => AppData): PlanningTransport {
  let revision = 0;
  // Allocation revisions as of the last read or commit. A legacy cascade (for example deleting a
  // resource) changes allocations outside this transport, so the next read advances the revision.
  let known = new Map<string, string>();
  const commitments = new Map<string, { revision: number; restorationGroupId?: string }>();
  const restorations = new Map<string, Allocation[]>();

  const apply = (allocations: Allocation[], companyId: string, intent: PlanningIntent): Committed => {
    const find = (id: string) => allocations.find((row) => row.id === id) ?? null;
    const create = (fields: object, seriesId: string | null = null): Allocation =>
      ({ ...NULLABLE_FIELDS.allocations, ...fields, seriesId, accountId: companyId, ...stamp() }) as Allocation;
    const copy = (sourceId: string, occurrences: Array<{ id: string; startDate: string; endDate: string }>) => {
      const source = find(sourceId);
      if (!source) throw missing();
      const seriesId = intent.operation === "allocation.repeat" ? newId() : null;
      return occurrences.map((occurrence) => create({ ...source, ...occurrence }, seriesId));
    };
    const remove = (ids: string[]): Committed => {
      const rows = ids.map((id) => find(id));
      if (rows.some((row) => row === null)) throw missing();
      const groupId = newId();
      restorations.set(groupId, rows as Allocation[]);
      return { allocations: [], removed: ids, replacementGroupId: groupId };
    };
    const upserts = (rows: Allocation[]): Committed => ({ allocations: rows, removed: [], replacementGroupId: null });
    switch (intent.operation) {
      case "allocation.create":
        return upserts([create(intent.allocation)]);
      case "allocation.createGroup": {
        const seriesId = newId();
        return upserts(intent.allocations.map((allocation) => create(allocation, seriesId)));
      }
      case "allocation.update": {
        const existing = find(intent.id);
        if (!existing) throw missing();
        return upserts([Object.assign({}, existing, intent.changes, { updatedAt: touchAfter(existing.updatedAt) })]);
      }
      case "allocation.duplicate":
        return upserts(copy(intent.sourceAllocationId, [intent.occurrence]));
      case "allocation.repeat":
        return upserts(copy(intent.sourceAllocationId, intent.occurrences));
      case "allocation.delete":
        return remove([intent.id]);
      case "allocation.deleteGroup":
        return remove(intent.ids);
      case "planning.restoreGroup": {
        const rows = restorations.get(intent.restorationGroupId);
        if (!rows || rows.some((row) => find(row.id)))
          throw new PlanningControllerError("This change can no longer be restored.", "validation_error", 409);
        restorations.delete(intent.restorationGroupId);
        return upserts(rows.map((row) => ({ ...row, updatedAt: touchAfter(row.updatedAt) })));
      }
      // The demo still writes these tables through legacy persistence.
      case "catalogue.create":
      case "catalogue.update":
      case "catalogue.archive":
      case "catalogue.unarchive":
      case "catalogue.delete":
      case "resource.create":
      case "resource.update":
      case "resource.archive":
      case "resource.unarchive":
      case "timeOff.create":
      case "timeOff.repeat":
      case "timeOff.deleteGroup":
      case "timeOff.update":
      case "timeOff.delete":
      case "closure.create":
      case "closure.update":
      case "closure.delete":
      case "settings.update":
        throw new PlanningControllerError("This planning operation is not available.", "validation_error", 400);
    }
  };

  return {
    async read(context) {
      const data = companySlice(readData(), context.companyId);
      const current = new Map(data.allocations.map((row) => [row.id, row.updatedAt]));
      if (current.size !== known.size || [...current].some(([id, updatedAt]) => known.get(id) !== updatedAt))
        revision += 1;
      known = current;
      return { revision, canWrite: true, data };
    },
    async execute(context, execution) {
      if (execution.baseRevision !== revision)
        throw new PlanningControllerError("The schedule changed before this edit was saved.", "stale_revision", 409);
      const allocations = readData().allocations.filter((row) => row.accountId === context.companyId);
      const committed = apply(allocations, context.companyId, execution.intent);
      revision += 1;
      for (const id of committed.removed) known.delete(id);
      for (const row of committed.allocations) known.set(row.id, row.updatedAt);
      const restorationGroupId = committed.replacementGroupId ?? undefined;
      commitments.set(execution.mutationId, { revision, ...(restorationGroupId ? { restorationGroupId } : {}) });
      const consumedGroupId =
        execution.intent.operation === "planning.restoreGroup" ? execution.intent.restorationGroupId : null;
      return {
        status: "committed",
        mutationId: execution.mutationId,
        revision,
        restoration: { consumedGroupId, replacementGroupId: committed.replacementGroupId },
        projection: {
          mode: "patch",
          history: "retain",
          changed: {
            upserts: committed.allocations.map((row) => ({ entity: "allocations" as const, row })),
            removed: committed.removed.map((id) => ({ entity: "allocations" as const, id })),
          },
        },
      } as PlanningMutationSuccess;
    },
    async lookup(_context, mutationId) {
      const commitment = commitments.get(mutationId);
      return commitment ? { status: "committed", mutationId, ...commitment } : { status: "unknown", mutationId };
    },
  };
}

/** Server builds use the typed API; the demo build keeps planning writes in this page's memory. */
export function createStorePlanningTransport(readData: () => AppData): PlanningTransport {
  return isServerConfigured() ? createPlanningTransport() : createVolatilePlanningTransport(readData);
}
