import type { StoreApi } from "zustand";
import type { AppDataKey } from "@capacitylens/shared/types/entities";
import type { StoreState } from "@/store/types";
import type { PlanningActions } from "./planningActions";
import type { PlanningDraft } from "./planningCacheController";
import { PlanningControllerError } from "./planningCacheController";
import type { createPlanningCacheController } from "./planningCacheController";
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
  buildTimeOffCreate,
  buildTimeOffUpdate,
  buildClosureCreate,
  buildClosureUpdate,
  buildResourceCreate,
  buildResourceUpdate,
  buildCatalogueCreate,
  buildCatalogueUpdate,
  buildSettingsUpdate,
  buildDelete,
} from "./planningCommands";
import type { PlanningCommand } from "./planningCommands";

type Controller = ReturnType<typeof createPlanningCacheController>;

/** Explicit user commands are the only production planning writer. */
export function createProductionPlanningActions(store: StoreApi<StoreState>, controller: Controller): PlanningActions {
  function context(draft: PlanningDraft | null | undefined, originalWritable: unknown) {
    if (draft === null)
      throw new PlanningControllerError("This form opened before planning was ready. Reopen it to try again.");
    const current = controller.begin(originalWritable);
    const captured = draft ?? current;
    const state = store.getState();
    if (
      !state.planning.context ||
      captured.context !== state.planning.context ||
      captured.generation !== current.generation
    )
      throw new PlanningControllerError("The company or access context changed. Reopen this form.");
    if (state.planning.pending)
      throw new PlanningControllerError("A planning change is pending or its commitment is still unknown.");
    return { draft: captured, data: state.data, accountId: captured.context.companyId };
  }

  function row<K extends AppDataKey>(key: K, id: string): StoreState["data"][K][number] {
    const state = store.getState();
    const existing = state.data[key].find((candidate) => candidate.id === id);
    if (!existing || ("accountId" in existing && existing.accountId !== state.activeAccountId))
      throw new PlanningControllerError("This item is no longer available in this company.");
    return existing;
  }

  function original<K extends AppDataKey>(key: K, id: string, draft: PlanningDraft | null | undefined) {
    const existing = row(key, id);
    if (!draft) return existing;
    const captured = draft.originalWritable;
    if (typeof captured !== "object" || captured === null || !("id" in captured) || captured.id !== id)
      throw new PlanningControllerError("The original item is unavailable. Reopen this form.");
    return captured as StoreState["data"][K][number];
  }

  async function run(command: PlanningCommand | null, captured: ReturnType<typeof context>): Promise<void> {
    if (!command) {
      if (captured.draft.baseRevision !== store.getState().planning.revision) {
        await controller.refresh();
        throw new PlanningControllerError(
          "Company data changed while this draft was open. Reopen it before trying again.",
          "stale_revision",
          409,
        );
      }
      return;
    }
    const executing = controller.execute(captured.draft, command.intent, command.inverse);
    const mutationId = store.getState().planning.pending?.execution.mutationId;
    await executing;
    const state = store.getState().planning;
    if (state.context !== captured.draft.context)
      throw new PlanningControllerError("The company or access context changed while saving.");
    if (state.pending || state.outcome?.kind !== "acknowledged" || state.outcome.mutationId !== mutationId)
      throw new PlanningControllerError(
        "The change's commitment or refreshed company data is still being resolved. Do not submit it again.",
        undefined,
        undefined,
        true,
      );
  }

  async function create<K extends AppDataKey>(
    key: K,
    command: PlanningCommand | null,
    captured: ReturnType<typeof context>,
  ) {
    if (!command?.created) throw new PlanningControllerError("The new item could not be prepared for this company.");
    await run(command, captured);
    const values = command.created.ids.map((id) => row(key, id));
    return values;
  }

  return {
    async addAllocation(fields, draft) {
      const captured = context(draft, undefined);
      const values = await create(
        "allocations",
        buildAllocationCreate({ ...captured, args: { id: crypto.randomUUID(), fields } }),
        captured,
      );
      const value = values[0];
      if (!value) throw new PlanningControllerError("The server did not return the created allocation.");
      return { kind: "created", value };
    },
    async duplicateAllocation(sourceId, fields, draft) {
      const before = original("allocations", sourceId, draft);
      const captured = context(draft, before);
      const [value] = await create(
        "allocations",
        buildAllocationDuplicate({
          ...captured,
          original: before,
          args: { sourceId, id: crypto.randomUUID(), fields },
        }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the duplicated allocation.");
      return { kind: "created", value };
    },
    async addAllocations(fields, draft) {
      if (fields.length === 1 && fields[0]) {
        const result = await this.addAllocation(fields[0], draft);
        return result.kind === "blocked" ? result : { kind: "created", value: [result.value] };
      }
      throw new PlanningControllerError("The atomic allocation creation contract has not been integrated.");
    },
    async updateAllocation(id, changes, draft) {
      const before = original("allocations", id, draft);
      const captured = context(draft, before);
      await run(buildAllocationUpdate({ ...captured, original: before, args: { id, changes } }), captured);
      return true;
    },
    async deleteAllocation(id, draft) {
      const captured = context(draft, row("allocations", id));
      await run(buildDelete({ ...captured, args: { entity: "allocations", id } }), captured);
    },
    async deleteAllocationSeriesFrom(id, draft) {
      const target = row("allocations", id);
      const captured = context(draft, target);
      if (!target.seriesId) throw new PlanningControllerError("This allocation is not part of a repeat series.");
      const ids = captured.data.allocations
        .filter(
          (item) =>
            item.seriesId === target.seriesId &&
            item.accountId === captured.accountId &&
            item.startDate >= target.startDate,
        )
        .map((item) => item.id);
      await run(
        {
          intent: { operation: "allocation.deleteGroup", ids },
          inverse: { operation: "planning.restoreGroup", restorationGroupId: "" },
        },
        captured,
      );
    },
    async addTimeOff(fields, draft) {
      const captured = context(draft, undefined);
      const values = await create(
        "timeOff",
        buildTimeOffCreate({ ...captured, args: { id: crypto.randomUUID(), fields } }),
        captured,
      );
      const value = values[0];
      if (!value) throw new PlanningControllerError("The server did not return the created absence.");
      return { kind: "created", value };
    },
    async addTimeOffs(fields, draft) {
      const captured = context(draft, undefined);
      const entries = fields.map((item) => ({
        id: crypto.randomUUID(),
        resourceId: item.resourceId,
        startDate: item.startDate,
        endDate: item.endDate,
        type: item.type,
        note: item.note ?? null,
      }));
      if (!entries.length) throw new PlanningControllerError("At least one absence is required.");
      const values = await create(
        "timeOff",
        {
          intent: { operation: "timeOff.repeat", entries },
          inverse: { operation: "timeOff.deleteGroup", ids: entries.map((item) => item.id) },
          created: { entity: "timeOff", ids: entries.map((item) => item.id) },
        },
        captured,
      );
      return { kind: "created", value: values };
    },
    async updateTimeOff(id, changes, draft) {
      const before = original("timeOff", id, draft);
      const captured = context(draft, before);
      await run(buildTimeOffUpdate({ ...captured, original: before, args: { id, changes } }), captured);
    },
    async deleteTimeOff(id, draft) {
      const captured = context(draft, row("timeOff", id));
      await run(buildDelete({ ...captured, args: { entity: "timeOff", id } }), captured);
    },
    async addClosure(fields, draft) {
      const captured = context(draft, undefined);
      const values = await create(
        "closures",
        buildClosureCreate({ ...captured, args: { id: crypto.randomUUID(), fields } }),
        captured,
      );
      const value = values[0];
      if (!value) throw new PlanningControllerError("The server did not return the created closure.");
      return { kind: "created", value };
    },
    async updateClosure(id, changes, draft) {
      const before = original("closures", id, draft);
      const captured = context(draft, before);
      await run(buildClosureUpdate({ ...captured, original: before, args: { id, changes } }), captured);
    },
    async deleteClosure(id, draft) {
      const captured = context(draft, row("closures", id));
      await run(buildDelete({ ...captured, args: { entity: "closures", id } }), captured);
    },
    async addResource(fields, draft) {
      const captured = context(draft, undefined);
      const values = await create(
        "resources",
        buildResourceCreate({ ...captured, args: { id: crypto.randomUUID(), fields } }),
        captured,
      );
      const value = values[0];
      if (!value) throw new PlanningControllerError("The server did not return the created resource.");
      return { kind: "created", value };
    },
    async updateResource(id, changes, draft) {
      const before = original("resources", id, draft);
      const captured = context(draft, before);
      await run(buildResourceUpdate({ ...captured, original: before, args: { id, changes } }), captured);
    },
    async addClient(fields, draft) {
      const captured = context(draft, undefined);
      const [value] = await create(
        "clients",
        buildCatalogueCreate({ ...captured, args: { entity: "clients", id: crypto.randomUUID(), fields } }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the created client.");
      return { kind: "created", value };
    },
    async addProject(fields, draft) {
      const captured = context(draft, undefined);
      const [value] = await create(
        "projects",
        buildCatalogueCreate({ ...captured, args: { entity: "projects", id: crypto.randomUUID(), fields } }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the created project.");
      return { kind: "created", value };
    },
    async addActivity(fields, draft) {
      const captured = context(draft, undefined);
      const [value] = await create(
        "activities",
        buildCatalogueCreate({ ...captured, args: { entity: "activities", id: crypto.randomUUID(), fields } }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the created activity.");
      return { kind: "created", value };
    },
    async addPhase(fields, draft) {
      const captured = context(draft, undefined);
      const [value] = await create(
        "phases",
        buildCatalogueCreate({ ...captured, args: { entity: "phases", id: crypto.randomUUID(), fields } }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the created phase.");
      return { kind: "created", value };
    },
    async addDiscipline(fields, draft) {
      const captured = context(draft, undefined);
      const [value] = await create(
        "disciplines",
        buildCatalogueCreate({ ...captured, args: { entity: "disciplines", id: crypto.randomUUID(), fields } }),
        captured,
      );
      if (!value) throw new PlanningControllerError("The server did not return the created discipline.");
      return { kind: "created", value };
    },
    async updateClient(id, changes, draft) {
      const before = original("clients", id, draft);
      const captured = context(draft, before);
      await run(
        buildCatalogueUpdate({ ...captured, original: before, args: { entity: "clients", id, changes } }),
        captured,
      );
    },
    async updateProject(id, changes, draft) {
      const before = original("projects", id, draft);
      const captured = context(draft, before);
      await run(
        buildCatalogueUpdate({ ...captured, original: before, args: { entity: "projects", id, changes } }),
        captured,
      );
    },
    async updateActivity(id, changes, draft) {
      const before = original("activities", id, draft);
      const captured = context(draft, before);
      await run(
        buildCatalogueUpdate({ ...captured, original: before, args: { entity: "activities", id, changes } }),
        captured,
      );
    },
    async updatePhase(id, changes, draft) {
      const before = original("phases", id, draft);
      const captured = context(draft, before);
      await run(
        buildCatalogueUpdate({ ...captured, original: before, args: { entity: "phases", id, changes } }),
        captured,
      );
    },
    async updateDiscipline(id, changes, draft) {
      const before = original("disciplines", id, draft);
      const captured = context(draft, before);
      await run(
        buildCatalogueUpdate({ ...captured, original: before, args: { entity: "disciplines", id, changes } }),
        captured,
      );
    },
    async deletePhase(id, draft) {
      const captured = context(draft, row("phases", id));
      await run(buildDelete({ ...captured, args: { entity: "phases", id } }), captured);
    },
    async deleteDiscipline(id, draft) {
      const captured = context(draft, row("disciplines", id));
      await run(buildDelete({ ...captured, args: { entity: "disciplines", id } }), captured);
    },
    async deleteActivity() {
      throw new PlanningControllerError("Activities must use the archive action.");
    },
    async updateAccount(id, changes, draft) {
      const before = original("accounts", id, draft);
      const captured = context(draft, before);
      if (id !== captured.accountId) throw new PlanningControllerError("Cannot change another company's settings.");
      await run(buildSettingsUpdate({ ...captured, original: before, args: changes }), captured);
    },
    undo: () => controller.undo(),
    redo: () => controller.redo(),
  };
}
