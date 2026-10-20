import { useStore } from "@/store/useStore";
import type { Allocation } from "@capacitylens/shared/types/entities";
import type { Draft, CreateResult } from "@/store/types";
import type { StoreEntityActions, StoreState } from "@/store/types";
import type { PlanningDraft } from "./planningCacheController";
import { PlanningControllerError } from "./planningCacheController";
import { getPlanningController, hasPlanningRuntime, assertPlanningWritesAllowed } from "./planningRuntime";

type AsyncAction<Action> = Action extends (...parameters: infer Parameters) => infer Result
  ? (...parameters: [...Parameters, draft?: PlanningDraft | null]) => Promise<Result>
  : never;

type EntityActions = Omit<StoreEntityActions, "archiveEntity" | "unarchiveEntity" | "softDeleteEntity" | "purgeEntity">;
export type PlanningActions = { [Name in keyof EntityActions]: AsyncAction<EntityActions[Name]> } & {
  updateAccount: AsyncAction<StoreState["updateAccount"]>;
  duplicateAllocation: (
    sourceId: string,
    fields: Draft<Allocation>,
    draft?: PlanningDraft | null,
  ) => Promise<CreateResult<Allocation>>;
  undo: (draft?: PlanningDraft | null) => Promise<boolean>;
  redo: (draft?: PlanningDraft | null) => Promise<boolean>;
};

/** Captures the start of an attempt; an unready server draft stays unavailable until deliberately reopened. */
export function capturePlanningDraft(originalWritable: unknown): PlanningDraft | null {
  if (!hasPlanningRuntime()) return null;
  try {
    return getPlanningController().begin(originalWritable);
  } catch (error) {
    if (error instanceof PlanningControllerError) return null;
    throw error;
  }
}

// Local actions are the temporary memory-only demo implementation. Production installs the
// typed executor before admitting the scheduler; a production refusal never falls back to these.
type LocalActions = EntityActions & Pick<StoreState, "updateAccount">;
type ActionName = keyof LocalActions;
type Executor = (
  name: ActionName | "duplicateAllocation",
  parameters: unknown[],
  draft: PlanningDraft | null | undefined,
) => Promise<unknown>;
let executeServer: Executor | null = null;

/** Installs the one production writer alongside authenticated controller boot. */
export function registerPlanningExecutor(execute: Executor): () => void {
  if (executeServer) throw new Error("Planning actions are already attached.");
  executeServer = execute;
  return () => {
    if (executeServer === execute) executeServer = null;
  };
}

const parameterCounts: { [Name in ActionName]: Parameters<LocalActions[Name]>["length"] } = {
  addDiscipline: 1,
  updateDiscipline: 2,
  deleteDiscipline: 1,
  addResource: 1,
  updateResource: 2,
  addClient: 1,
  updateClient: 2,
  addProject: 1,
  updateProject: 2,
  addPhase: 1,
  updatePhase: 2,
  deletePhase: 1,
  addActivity: 1,
  updateActivity: 2,
  deleteActivity: 1,
  addAllocation: 1,
  addAllocations: 1,
  updateAllocation: 2,
  deleteAllocation: 1,
  deleteAllocationSeriesFrom: 1,
  addTimeOff: 1,
  addTimeOffs: 1,
  updateTimeOff: 2,
  deleteTimeOff: 1,
  addClosure: 1,
  updateClosure: 2,
  deleteClosure: 1,
  updateAccount: 2,
};

const entityActions = Object.fromEntries(
  (Object.keys(parameterCounts) as ActionName[]).map((name) => [
    name,
    async (...parameters: unknown[]) => {
      const draft = parameters[parameterCounts[name]] as PlanningDraft | null | undefined;
      const argumentsOnly = parameters.slice(0, parameterCounts[name]);
      if (executeServer) {
        assertPlanningWritesAllowed();
        return executeServer(name, argumentsOnly, draft);
      }
      if (hasPlanningRuntime()) throw new PlanningControllerError("Planning actions have not finished starting.");
      return Reflect.apply(useStore.getState()[name], useStore.getState(), argumentsOnly);
    },
  ]),
);

/** Every caller awaits commitment before closing a form or reporting success. */
export const planningActions: PlanningActions = {
  ...entityActions,
  async duplicateAllocation(sourceId, fields, draft) {
    if (executeServer) {
      assertPlanningWritesAllowed();
      return (await executeServer("duplicateAllocation", [sourceId, fields], draft)) as CreateResult<Allocation>;
    }
    if (hasPlanningRuntime()) throw new PlanningControllerError("Planning actions have not finished starting.");
    return useStore.getState().addAllocation(fields);
  },
  async undo() {
    if (hasPlanningRuntime()) {
      assertPlanningWritesAllowed();
      return getPlanningController().undo();
    }
    const available = useStore.getState().past.length > 0;
    useStore.getState().undo();
    return available;
  },
  async redo() {
    if (hasPlanningRuntime()) {
      assertPlanningWritesAllowed();
      return getPlanningController().redo();
    }
    const available = useStore.getState().future.length > 0;
    useStore.getState().redo();
    return available;
  },
} as PlanningActions;
