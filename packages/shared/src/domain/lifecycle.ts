// Pure lifecycle helpers for archive and restore, and for reading a row's deletion state.
// Current resource and catalogue actions archive or restore; other planning deletion/recovery
// has its own ledger. Explicit timestamps keep these helpers independent of an ambient clock.
//
// Transitions are strict: an invalid source state throws LifecycleTransitionError rather than
// becoming an idempotent no-op. Callers can use the exported `can*` predicates to enable affordances
// without catching transition errors.

export type { LifecycleState, LifecycleFields, LifecycleEntityKey } from './lifecycle/types.js'
export {
  LIFECYCLE_ENTITY_KEYS,
  isLifecycleEntityKey,
  resolveLifecycleStatus,
} from './lifecycle/types.js'
export type {
  LifecycleAncestryRow,
  LifecycleAncestryLookup,
  LifecycleAncestryResult,
} from './lifecycle/ancestry.js'
export { inspectLifecycleAncestry } from './lifecycle/ancestry.js'
export { buildActiveData } from './lifecycle/projection.js'
export type { ArchiveImpact } from './lifecycle/impact.js'
export { archiveImpact } from './lifecycle/impact.js'
export type { LifecycleTransitionErrorCode } from './lifecycle/transitions.js'
export {
  canArchive,
  canRestore,
  LifecycleTransitionError,
  archive,
  restore,
  obfuscateResource,
} from './lifecycle/transitions.js'

export type {
  ArchiveRecovery,
  ArchiveRecoveryRow,
  ArchivedParent,
} from './lifecycle/archiveRecovery.js'
export { archiveRecovery } from './lifecycle/archiveRecovery.js'
