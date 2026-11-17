import type { Draft, Patch } from '@/lib/entityDrafts';
import type { RepeatPattern } from '@capacitylens/shared/lib/repeatingDates';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type {
  Activity,
  Allocation,
  Client,
  Closure,
  Discipline,
  ID,
  ISODate,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';

/** The pattern and inclusive last start of a repeated create; the server places each occurrence. */
export interface RepeatRange {
  pattern: RepeatPattern;
  until: ISODate;
}

/** A create action can be blocked until a writable role is confirmed. */
export type CreateResult<T> = { kind: 'created'; value: T } | { kind: 'blocked' };

/** Store actions write the active company through the canonical planning transport. Authority
 * restrictions may return a blocked result or no-op; stale IDs are no-ops. Reference and input-integrity
 * failures throw, and callers handling user input must surface them. An edit form passes its row's
 * `updatedAt` from when it opened as `expectedUpdatedAt`; the server refuses the update when the row
 * has changed since. */
export interface StoreEntityActions {
  /** Create a discipline in the active account. */
  addDiscipline: (input: Draft<Discipline>) => Promise<CreateResult<Discipline>>;
  /** Patch a discipline in the active account. */
  updateDiscipline: (id: ID, patch: Patch<Discipline>, expectedUpdatedAt?: string) => Promise<void>;
  /** Delete a discipline from the active account; dependent rows follow the shared cascade rules. */
  deleteDiscipline: (id: ID) => Promise<void>;

  /** Create a resource in the active account. */
  addResource: (input: Draft<Resource>) => Promise<CreateResult<Resource>>;
  /** Patch a resource in the active account. */
  updateResource: (id: ID, patch: Patch<Resource>, expectedUpdatedAt?: string) => Promise<void>;

  /** Create a client in the active account. */
  addClient: (input: Draft<Client>) => Promise<CreateResult<Client>>;
  /** Patch a client in the active account. */
  updateClient: (id: ID, patch: Patch<Client>, expectedUpdatedAt?: string) => Promise<void>;

  /** Create a project in the active account. */
  addProject: (input: Draft<Project>) => Promise<CreateResult<Project>>;
  /** Patch a project in the active account. */
  updateProject: (id: ID, patch: Patch<Project>, expectedUpdatedAt?: string) => Promise<void>;

  /** Create a phase in the active account. */
  addPhase: (input: Draft<Phase>) => Promise<CreateResult<Phase>>;
  /** Patch a phase in the active account. */
  updatePhase: (id: ID, patch: Patch<Phase>) => Promise<void>;
  /** Delete a phase from the active account; dependent rows follow the shared cascade rules. */
  deletePhase: (id: ID) => Promise<void>;

  /** Create an activity in the active account. */
  addActivity: (input: Draft<Activity>) => Promise<CreateResult<Activity>>;
  /** Patch an activity in the active account. */
  updateActivity: (id: ID, patch: Patch<Activity>, expectedUpdatedAt?: string) => Promise<void>;
  /** Archive an activity in the active account and resolve with the server reply, or with nothing
   * when the write is blocked; dependent rows follow the shared cascade rules. */
  deleteActivity: (id: ID) => Promise<PlanningMutationSuccess | undefined>;

  /** Create one allocation as one typed planning write; it resolves once the server acknowledges it. */
  addAllocation: (input: Draft<Allocation>) => Promise<CreateResult<Allocation>>;
  /** Create a repeated set as one typed planning write and one Undo step. The server places the
   * `count` occurrences from the first one and the repeat; a mismatched count or a refusal rejects. */
  addRepeatedAllocation: (
    input: Draft<Allocation>,
    repeat: RepeatRange,
    count: number,
  ) => Promise<CreateResult<Allocation[]>>;
  /** Copy an allocation as one typed planning write, reusing the source when nothing else changed. */
  duplicateAllocation: (
    sourceId: ID,
    input: Draft<Allocation>,
  ) => Promise<CreateResult<Allocation>>;
  /** Apply an allocation patch. False means an authority refusal, a missing target or no change;
   * validation, tenancy and server refusals reject. */
  updateAllocation: (id: ID, patch: Patch<Allocation>) => Promise<boolean>;
  /** Delete an allocation from the active account. */
  deleteAllocation: (id: ID) => Promise<void>;
  /** Atomically delete one linked occurrence and every same-series occurrence starting on/after it. */
  deleteAllocationSeriesFrom: (id: ID) => Promise<void>;

  /** Create a time-off entry in the active account. */
  addTimeOff: (input: Draft<TimeOff>) => Promise<CreateResult<TimeOff>>;
  /** Create repeated time off as one typed planning write and one Undo step. The server places the
   * `count` entries from the first one and the repeat; a mismatched count or a refusal rejects. */
  addRepeatedTimeOff: (
    input: Draft<TimeOff>,
    repeat: RepeatRange,
    count: number,
  ) => Promise<CreateResult<TimeOff[]>>;
  /** Patch a time-off entry in the active account. */
  updateTimeOff: (id: ID, patch: Patch<TimeOff>, expectedUpdatedAt?: string) => Promise<void>;
  /** Delete a time-off entry from the active account. */
  deleteTimeOff: (id: ID) => Promise<void>;

  /** Create a company closure in the active account. */
  addClosure: (input: Draft<Closure>) => Promise<CreateResult<Closure>>;
  /** Patch a company closure in the active account. */
  updateClosure: (id: ID, patch: Patch<Closure>, expectedUpdatedAt?: string) => Promise<void>;
  /** Delete a company closure from the active company. */
  deleteClosure: (id: ID) => Promise<void>;
}
