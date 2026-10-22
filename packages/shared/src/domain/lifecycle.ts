// Pure lifecycle state machine for resources, clients, projects, and activities. It owns the
// `Active → Archived → Soft-deleted → Purged` transitions and receives `nowISO` explicitly, so
// results depend only on inputs rather than an ambient clock. Server and client code share these
// rules to agree on lifecycle status and available actions.
//
// Transitions are strict: an invalid source state throws LifecycleTransitionError rather than
// becoming an idempotent no-op. Callers can use the exported `can*` predicates to gate affordances
// without catching transition errors.

export type { LifecycleState, LifecycleFields, LifecycleEntityKey } from "./lifecycle/types.js";
export { LIFECYCLE_ENTITY_KEYS, isLifecycleEntityKey, lifecycleStatus } from "./lifecycle/types.js";
export type { LifecycleAncestryRow, LifecycleAncestryLookup, LifecycleAncestryResult } from "./lifecycle/ancestry.js";
export { inspectLifecycleAncestry } from "./lifecycle/ancestry.js";
export { activeOnly } from "./lifecycle/projection.js";
export type { ArchiveImpact } from "./lifecycle/impact.js";
export { archiveImpact } from "./lifecycle/impact.js";
export type { LifecycleTransitionErrorCode } from "./lifecycle/transitions.js";
export {
  canArchive,
  canUnarchive,
  LifecycleTransitionError,
  archive,
  unarchive,
  obfuscateResource,
} from "./lifecycle/transitions.js";
