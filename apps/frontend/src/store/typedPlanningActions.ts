import { newId } from "@capacitylens/shared/lib/id";
import { clampWorkingHoursPerDay } from "@capacitylens/shared/types/entities";
import { isWeekdaySet, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { assertResourceExists } from "@capacitylens/shared/domain/mutations";
import { getOwned } from "@capacitylens/shared/domain/mutations";
import type {
  Account,
  Activity,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from "@capacitylens/shared/types/entities";
import type { StoreApi } from "zustand";
import {
  buildCatalogueCreate,
  buildCatalogueUpdate,
  buildClosureCreate,
  buildClosureUpdate,
  buildResourceCreate,
  buildResourceUpdate,
  buildSettingsUpdate,
  buildTimeOffCreate,
  buildTimeOffUpdate,
} from "@/data/planning/planningCommands";
import type { PlanningCommand } from "@/data/planning/planningCommands";
import type { CreateResult, Draft, Patch, StoreState } from "./types";
import type { StoreInternals } from "./storeInternal";

const restoreFromReceipt = { operation: "planning.restoreGroup", restorationGroupId: "" } as const;

function createdId(value: unknown): string {
  if (typeof value !== "string") throw new Error("The planning row has no id.");
  return value;
}

/** The remaining planning writers share the allocation controller and await its reconciliation. */
export function createTypedPlanningActions(
  get: StoreApi<StoreState>["getState"],
  blockedByViewer: StoreInternals["blockedByViewer"],
) {
  const accountId = () => {
    const id = get().activeAccountId;
    if (!id || !get().data.accounts.some((row) => row.id === id)) throw new Error("No active company is selected.");
    if (get().activeAccountLoadFailed === id)
      throw new Error("The active account is not loaded — cannot mutate scoped data.");
    return id;
  };
  const blocked = blockedByViewer;
  const owned = <
    K extends "clients" | "projects" | "phases" | "activities" | "disciplines" | "resources" | "timeOff" | "closures",
  >(
    key: K,
    id: string,
    companyId: string,
  ) => getOwned(get().data, companyId, key, id);
  const send = async (command: PlanningCommand | null, original: unknown = null) => {
    if (!command) return false;
    await get().sendPlanningCommand(command, original);
    return true;
  };
  const created = <
    K extends keyof Pick<
      StoreState["data"],
      "clients" | "projects" | "phases" | "activities" | "disciplines" | "resources" | "timeOff" | "closures"
    >,
  >(
    key: K,
    id: string,
  ): StoreState["data"][K][number] => {
    const row = get().data[key].find((candidate) => candidate.id === id);
    if (!row) throw new Error("The saved planning row was not returned.");
    return row;
  };
  const createCatalogue = async <T extends Client | Project | Phase | Activity | Discipline>(
    key: "clients" | "projects" | "phases" | "activities" | "disciplines",
    fields: Draft<T>,
  ): Promise<CreateResult<T>> => {
    const companyId = accountId();
    if (blocked()) return { kind: "blocked" };
    const id = newId();
    const command = buildCatalogueCreate({
      data: get().data,
      accountId: companyId,
      args: { entity: key, id, fields } as Parameters<typeof buildCatalogueCreate>[0]["args"],
    });
    if (!command) throw new Error("The planning change could not be prepared.");
    await send(command);
    return { kind: "created", value: created(key, id) as T };
  };
  const updateCatalogue = async (
    key: "clients" | "projects" | "phases" | "activities" | "disciplines",
    id: string,
    changes: object,
  ) => {
    const companyId = accountId();
    if (blocked()) return;
    const original = owned(key, id, companyId);
    if (!original) return;
    await send(
      buildCatalogueUpdate({
        data: get().data,
        accountId: companyId,
        original,
        args: { entity: key, id, changes },
      }),
      original,
    );
  };
  const deleteCatalogue = async (key: "phases" | "disciplines", id: string) => {
    const companyId = accountId();
    if (blocked() || !owned(key, id, companyId)) return;
    await send({
      intent: { operation: "catalogue.delete", entity: { entity: key, id } },
      inverse: restoreFromReceipt,
    });
  };
  const createTimeOff = async (input: Draft<TimeOff>): Promise<CreateResult<TimeOff>> => {
    const companyId = accountId();
    if (blocked()) return { kind: "blocked" };
    assertResourceExists(get().data, companyId, input.resourceId);
    const id = newId();
    const command = buildTimeOffCreate({ data: get().data, accountId: companyId, args: { id, fields: input } });
    if (!command) throw new Error("The time-off entry could not be prepared.");
    await send(command);
    return { kind: "created", value: created("timeOff", id) };
  };
  return {
    addDiscipline: (input: Draft<Discipline>) => createCatalogue<Discipline>("disciplines", input),
    updateDiscipline: (id: string, patch: Patch<Discipline>) => updateCatalogue("disciplines", id, patch),
    deleteDiscipline: (id: string) => deleteCatalogue("disciplines", id),
    addClient: (input: Draft<Client>) => createCatalogue<Client>("clients", input),
    updateClient: (id: string, patch: Patch<Client>) => updateCatalogue("clients", id, patch),
    addProject: (input: Draft<Project>) => createCatalogue<Project>("projects", input),
    updateProject: (id: string, patch: Patch<Project>) => updateCatalogue("projects", id, patch),
    addPhase: (input: Draft<Phase>) => createCatalogue<Phase>("phases", input),
    updatePhase: (id: string, patch: Patch<Phase>) => updateCatalogue("phases", id, patch),
    deletePhase: (id: string) => deleteCatalogue("phases", id),
    addActivity: (input: Draft<Activity>) => createCatalogue<Activity>("activities", input),
    updateActivity: (id: string, patch: Patch<Activity>) => updateCatalogue("activities", id, patch),
    deleteActivity: async (id: string) => {
      const companyId = accountId();
      if (blocked() || !owned("activities", id, companyId)) return;
      await send({
        intent: { operation: "catalogue.archive", entity: { entity: "activities", id } },
        inverse: { operation: "catalogue.unarchive", entity: { entity: "activities", id } },
      });
    },
    addResource: async (input: Draft<Resource>): Promise<CreateResult<Resource>> => {
      const companyId = accountId();
      if (blocked()) return { kind: "blocked" };
      const id = newId();
      const fields = { ...input, workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay) };
      const command = buildResourceCreate({ data: get().data, accountId: companyId, args: { id, fields } });
      if (!command) throw new Error("The resource could not be prepared.");
      await send(command);
      return { kind: "created", value: created("resources", id) };
    },
    updateResource: async (id: string, patch: Patch<Resource>) => {
      const companyId = accountId();
      if (blocked()) return;
      const original = owned("resources", id, companyId);
      if (!original) return;
      const changes =
        patch.workingHoursPerDay === undefined
          ? patch
          : { ...patch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) };
      await send(
        buildResourceUpdate({ data: get().data, accountId: companyId, original, args: { id, changes } }),
        original,
      );
    },
    addTimeOff: createTimeOff,
    addTimeOffs: async (inputs: readonly Draft<TimeOff>[]): Promise<CreateResult<TimeOff[]>> => {
      if (inputs.length === 0) throw new Error("At least one time-off entry is required.");
      const companyId = accountId();
      if (blocked()) return { kind: "blocked" };
      const commands = inputs.map((fields) => {
        assertResourceExists(get().data, companyId, fields.resourceId);
        const command = buildTimeOffCreate({ data: get().data, accountId: companyId, args: { id: newId(), fields } });
        if (!command || command.intent.operation !== "timeOff.create")
          throw new Error("The time-off entry could not be prepared.");
        return command.intent.timeOff;
      });
      await send({
        intent: { operation: "timeOff.repeat", entries: commands },
        inverse: { operation: "timeOff.deleteGroup", ids: commands.map((entry) => createdId(entry.id)) },
      });
      return { kind: "created", value: commands.map((entry) => created("timeOff", createdId(entry.id))) };
    },
    updateTimeOff: async (id: string, changes: Patch<TimeOff>) => {
      const companyId = accountId();
      if (blocked()) return;
      const original = owned("timeOff", id, companyId);
      if (original)
        await send(
          buildTimeOffUpdate({ data: get().data, accountId: companyId, original, args: { id, changes } }),
          original,
        );
    },
    deleteTimeOff: async (id: string) => {
      const companyId = accountId();
      if (blocked() || !owned("timeOff", id, companyId)) return;
      await send({ intent: { operation: "timeOff.delete", id }, inverse: restoreFromReceipt });
    },
    addClosure: async (input: Draft<Closure>): Promise<CreateResult<Closure>> => {
      const companyId = accountId();
      if (blocked()) return { kind: "blocked" };
      const id = newId();
      const command = buildClosureCreate({ data: get().data, accountId: companyId, args: { id, fields: input } });
      if (!command) throw new Error("The closure could not be prepared.");
      await send(command);
      return { kind: "created", value: created("closures", id) };
    },
    updateClosure: async (id: string, changes: Patch<Closure>) => {
      const companyId = accountId();
      if (blocked()) return;
      const original = owned("closures", id, companyId);
      if (original)
        await send(
          buildClosureUpdate({ data: get().data, accountId: companyId, original, args: { id, changes } }),
          original,
        );
    },
    deleteClosure: async (id: string) => {
      const companyId = accountId();
      if (blocked() || !owned("closures", id, companyId)) return;
      await send({ intent: { operation: "closure.delete", id }, inverse: restoreFromReceipt });
    },
    updateAccount: async (id: string, patch: Patch<Account>) => {
      const companyId = accountId();
      if (blocked()) return;
      if (id !== companyId) throw new Error("Cannot update a company other than the active company.");
      const original = get().data.accounts.find((row) => row.id === id);
      if (!original) return;
      if (patch.workingDays != null && (!isWeekdaySet(patch.workingDays) || patch.workingDays.length === 0))
        throw new Error("At least one working day is required, using unique whole-number weekdays from 0 to 6.");
      const changes =
        patch.workingDays == null
          ? patch
          : { ...patch, workingDays: normalizeAccountWorkingDays(patch.workingDays, original.weekStartsOn ?? 1) };
      await send(buildSettingsUpdate({ data: get().data, accountId: id, original, args: changes }), original);
    },
  };
}
