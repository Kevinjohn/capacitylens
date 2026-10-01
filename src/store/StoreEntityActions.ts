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

/** The active account's entity create/update/delete and data-lifecycle actions on the store. */
export interface StoreEntityActions {
  // --- Scoped entity CRUD (disciplines / resources / clients / projects / phases / activities /
  // allocations / time off). CONTRACT — identical for every add*/update*/delete* below, and
  // invisible in the signatures, so it lives here:
  //  • Runs against the ACTIVE account and is undoable (⌘Z).
  //  • THROWS an Error whose message is SAFE TO DISPLAY on a tenancy/integrity violation (a
  //    cross-account id, a dangling required FK, a reversed date range, an empty working-day set,
  //    or no active account). The store is the LAST line of defence ("forms reject; store
  //    backstops"), so these MUST throw — do not wrap them to swallow.
  //  • Silently NO-OPS on a STALE id (update/delete of a row not owned by the active account — e.g.
  //    a drag committed after an undo removed the row). That's a benign race, not corruption.
  //  • Callers that take USER INPUT must wrap the call in try/catch and surface e.message (see
  //    TimeOffForm / AllocationModal). A throw left uncaught surfaces only as a React error.
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

  /** Create one allocation through the same atomic validation/write path as `addAllocations`. */
  addAllocation: (input: Draft<Allocation>) => CreateResult<Allocation>;
  /** Create a non-empty allocation batch in one mutation/history step. Every draft is validated before
   * anything commits; a tenancy, reference or date-range failure throws and leaves state untouched. */
  addAllocations: (inputs: readonly Draft<Allocation>[]) => CreateResult<Allocation[]>;
  /** Apply an allocation patch. False means the write was deliberately refused as a Viewer or the
   * target disappeared before commit; validation/tenancy violations still throw. */
  updateAllocation: (id: ID, patch: Patch<Allocation>) => boolean;
  /** Delete an allocation from the active account. */
  deleteAllocation: (id: ID) => void;
  /** Atomically delete one linked occurrence and every same-series occurrence starting on/after it. */
  deleteAllocationSeriesFrom: (id: ID) => void;

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

  // --- Data-lifecycle: the Active → Archived → Soft-deleted → Purged machine for the
  // tombstone-carrying tables (resources / clients / projects / activities). These are the DEMO-build / OFF path —
  // they mutate the local `data` blob through the same mutate()/undo machinery as the CRUD above. In
  // SERVER mode the UI instead calls the dedicated routes (POST /api/:entity/:id/{archive,unarchive,
  // delete,purge}) directly, so the admin view only invokes these in the demo build. They COMPOSE
  // the pure shared lifecycle helpers (shared/src/domain/lifecycle.ts) — the transition logic and the
  // soft-delete obfuscation string are NEVER re-derived here. Archive/unarchive are undoable;
  // soft-delete/purge clear both history stacks so erased data cannot be recovered from memory.
  // All four are viewer-no-op and stale-id-no-op, and invalid transitions throw a display-safe Error
  // (the UI gates with the can* predicates first; the throw is the defense-in-depth backstop).
  /** Archive an entity (active → archived). DEMO-build path; surface-not-swallow — `archive` throws
   *  if the row isn't active. @param entity which tombstone table. @param id the row to archive. */
  archiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Un-archive an entity (archived → active). DEMO-build path; `unarchive` throws if the row isn't
   *  archived. @param entity which tombstone table. @param id the row to restore. */
  unarchiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Soft-delete an entity (archived → deleted tombstone). DEMO-build path; `softDelete` throws unless
   *  the row is archived first (the lifecycle requires prior archival). For a `resources` row the
   *  tombstone's `name` is ALSO scrubbed via the shared `obfuscateResource` — the local copy retains
   *  no original PII while it awaits purge. @param entity which tombstone table. @param id the row. */
  softDeleteEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Hard-purge a soft-deleted tombstone (physically remove + cascade its children). DEMO-build path.
   *  Enforces the {@link PURGE_MIN_AGE_DAYS} grace window via `canPurge`: if the tombstone is too young
   *  it does NOT mutate and surfaces an error notice instead of throwing (a refused affordance, not a
   *  bug). @param entity which tombstone table. @param id the tombstone to purge. */
  purgeEntity: (entity: LifecycleEntity, id: ID) => void;
}
