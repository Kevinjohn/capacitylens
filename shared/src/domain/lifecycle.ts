// Pure lifecycle state machine for resources, clients, projects, and activities. It owns the
// `Active → Archived → Soft-deleted → Purged` transitions and receives `nowISO` explicitly, so
// results depend only on inputs rather than an ambient clock. Server and client code share these
// rules to agree on lifecycle status and available actions.
//
// Transitions are strict: an invalid source state throws LifecycleTransitionError rather than
// becoming an idempotent no-op. Callers can use the exported `can*` predicates to gate affordances
// without catching transition errors.

export type { LifecycleState, LifecycleFields, LifecycleEntityKey } from "./lifecycle/types";
export { LIFECYCLE_ENTITY_KEYS, isLifecycleEntityKey, PURGE_MIN_AGE_DAYS, lifecycleStatus } from "./lifecycle/types";
export type { LifecycleAncestryRow, LifecycleAncestryLookup, LifecycleAncestryResult } from "./lifecycle/ancestry";
export { inspectLifecycleAncestry } from "./lifecycle/ancestry";
export { activeOnly } from "./lifecycle/projection";
export type { ArchiveImpact } from "./lifecycle/impact";
export { archiveImpact } from "./lifecycle/impact";
export type { LifecycleTransitionErrorCode } from "./lifecycle/transitions";
export {
  canArchive,
  canUnarchive,
  canSoftDelete,
  canPurge,
  LifecycleTransitionError,
  archive,
  unarchive,
  softDelete,
  obfuscateResource,
} from "./lifecycle/transitions";
