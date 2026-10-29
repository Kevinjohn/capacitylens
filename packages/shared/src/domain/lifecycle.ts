// Pure lifecycle helpers retained for archive/restore and legacy deletion-state compatibility.
// Current resource and catalogue actions archive or restore; other planning deletion/recovery
// has its own ledger. Explicit timestamps keep these helpers independent of an ambient clock.
//
// Transitions are strict: an invalid source state throws LifecycleTransitionError rather than
// becoming an idempotent no-op. Callers can use the exported `can*` predicates to gate affordances
// without catching transition errors.

export type { LifecycleState, LifecycleFields, LifecycleEntityKey } from './lifecycle/types.js';
export { LIFECYCLE_ENTITY_KEYS, isLifecycleEntityKey, lifecycleStatus } from './lifecycle/types.js';
export type {
  LifecycleAncestryRow,
  LifecycleAncestryLookup,
  LifecycleAncestryResult,
} from './lifecycle/ancestry.js';
export { inspectLifecycleAncestry } from './lifecycle/ancestry.js';
export { activeOnly } from './lifecycle/projection.js';
export type { ArchiveImpact } from './lifecycle/impact.js';
export { archiveImpact } from './lifecycle/impact.js';
export type { LifecycleTransitionErrorCode } from './lifecycle/transitions.js';
export {
  canArchive,
  canUnarchive,
  LifecycleTransitionError,
  archive,
  unarchive,
  obfuscateResource,
} from './lifecycle/transitions.js';

export type {
  ArchiveRecovery,
  ArchiveRecoveryRow,
  ArchivedParent,
} from './lifecycle/archiveRecovery.js';
export { archiveRecovery } from './lifecycle/archiveRecovery.js';
