import type { Draft, LifecycleEntity, Patch } from "./entityDrafts";
import type {
  Activity,
  Allocation,
  Client,
  Closure,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  TimeOff,
} from "@capacitylens/shared/types/entities";

/** A create action can be blocked by the active Viewer policy without saving a row. */
export type CreateResult<T> = { kind: "created"; value: T } | { kind: "blocked" };

/** Store actions mutate the active account and participate in undo history. Viewer restrictions may
 * return a blocked result or no-op; stale IDs are no-ops. Tenancy, reference, and input-integrity
 * failures throw, and callers handling user input must surface them. */
export interface StoreEntityActions {
  /** Create a discipline in the active account. */
  addDiscipline: (input: Draft<Discipline>) => CreateResult<Discipline>;
  /** Patch a discipline in the active account. */
  updateDiscipline: (id: ID, patch: Patch<Discipline>) => void;
  /** Delete a discipline from the active account; dependent rows follow the shared cascade rules. */
  deleteDiscipline: (id: ID) => void;

  /** Create a resource in the active account. */
  addResource: (input: Draft<Resource>) => CreateResult<Resource>;
  /** Patch a resource in the active account. */
  updateResource: (id: ID, patch: Patch<Resource>) => void;

  /** Create a client in the active account. */
  addClient: (input: Draft<Client>) => CreateResult<Client>;
  /** Patch a client in the active account. */
  updateClient: (id: ID, patch: Patch<Client>) => void;

  /** Create a project in the active account. */
  addProject: (input: Draft<Project>) => CreateResult<Project>;
  /** Patch a project in the active account. */
  updateProject: (id: ID, patch: Patch<Project>) => void;

  /** Create a phase in the active account. */
  addPhase: (input: Draft<Phase>) => CreateResult<Phase>;
  /** Patch a phase in the active account. */
  updatePhase: (id: ID, patch: Patch<Phase>) => void;
  /** Delete a phase from the active account; dependent rows follow the shared cascade rules. */
  deletePhase: (id: ID) => void;

  /** Create an activity in the active account. */
  addActivity: (input: Draft<Activity>) => CreateResult<Activity>;
  /** Patch an activity in the active account. */
  updateActivity: (id: ID, patch: Patch<Activity>) => void;
  /** Delete an activity from the active account; dependent rows follow the shared cascade rules. */
  deleteActivity: (id: ID) => void;

  /** Create one allocation as one typed planning write; it resolves once the server acknowledges it. */
  addAllocation: (input: Draft<Allocation>) => Promise<CreateResult<Allocation>>;
  /** Create a non-empty repeated set as one typed planning write and one Undo step. Every draft is
   * validated before anything is sent; a tenancy, reference or date-range failure rejects. */
  addAllocations: (inputs: readonly Draft<Allocation>[]) => Promise<CreateResult<Allocation[]>>;
  /** Copy an allocation as one typed planning write, reusing the source when nothing else changed. */
  duplicateAllocation: (sourceId: ID, input: Draft<Allocation>) => Promise<CreateResult<Allocation>>;
  /** Apply an allocation patch. False means a Viewer refusal, a missing target or no change;
   * validation, tenancy and server refusals reject. */
  updateAllocation: (id: ID, patch: Patch<Allocation>) => Promise<boolean>;
  /** Delete an allocation from the active account. */
  deleteAllocation: (id: ID) => Promise<void>;
  /** Atomically delete one linked occurrence and every same-series occurrence starting on/after it. */
  deleteAllocationSeriesFrom: (id: ID) => Promise<void>;

  /** Create a time-off entry in the active account. */
  addTimeOff: (input: Draft<TimeOff>) => CreateResult<TimeOff>;
  /** Create a non-empty time-off batch in one mutation/history step. Every draft is validated before
   * anything commits; a tenancy, resource or date-range failure throws and leaves state untouched. */
  addTimeOffs: (inputs: readonly Draft<TimeOff>[]) => CreateResult<TimeOff[]>;
  /** Patch a time-off entry in the active account. */
  updateTimeOff: (id: ID, patch: Patch<TimeOff>) => void;
  /** Delete a time-off entry from the active account. */
  deleteTimeOff: (id: ID) => void;

  /** Create a company closure in the active account. */
  addClosure: (input: Draft<Closure>) => CreateResult<Closure>;
  /** Patch a company closure in the active account. */
  updateClosure: (id: ID, patch: Patch<Closure>) => void;
  /** Delete a company closure from the active account. */
  deleteClosure: (id: ID) => void;

  // These actions mutate the local snapshot in demo mode; server mode uses lifecycle routes.
  // Viewer and stale-ID calls no-op; callers must surface errors these actions throw.
  // Soft-delete and purge clear both history stacks so erased data cannot be restored by undo.
  /** Archive an active entity.
   *
   * @throws When the entity is not active; no state changes.
   */
  archiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Restore an archived entity.
   *
   * @throws When the entity is not archived; no state changes.
   */
  unarchiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Soft-delete an archived entity; resource names are scrubbed while the tombstone awaits purge.
   *
   * @throws When the entity is not archived; no state changes.
   */
  softDeleteEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Purge a soft-deleted entity and its dependents after the {@link PURGE_MIN_AGE_DAYS} grace period.
   * An early request surfaces a notice without mutation.
   */
  purgeEntity: (entity: LifecycleEntity, id: ID) => void;
}
