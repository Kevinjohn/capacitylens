// Entity lifecycle — the pure, environment-agnostic state machine for the
// `Active → Archived → Soft-deleted → Purged` data-lifecycle that Resource, Client and Project all
// share (each carries the optional `archivedAt`/`deletedAt` tombstone fields added in P2.1). This
// module is a pure leaf: no I/O, no React/Zustand/DOM, no server route, no store method — just the
// derive helpers, the transition guards (`can*`) and the transition functions. Time math is done by
// INJECTING `nowISO` and parsing the string args (a deterministic function of inputs); it NEVER
// calls `Date.now()` / argless `new Date()` (ambient = impure), mirroring how the store "owns the
// clock" and passes timestamps in. Defining the lifecycle rules ONCE here is what stops the server
// (the purge route + admin view, P2.5) and the client (filtering, P2.4) drifting on what "archived"
// or "purgeable" means; both halves import THIS so the machine is single-sourced.
//
// DESIGN DECISION (P2.2): the three transition functions are STRICT — they throw the typed
// LifecycleTransitionError on an invalid source state rather than being silently idempotent. This
// matches the shared domain's fail-loud convention: general enforcement failures use DomainError
// where adapters need the stable domain code, while lifecycle precondition failures use this
// module's narrower error and code. A re-archive or double-delete is a caller bug worth surfacing,
// not a no-op to absorb. The wiring layer (P2.5) pre-checks with the exported `can*` predicates (or
// catches and classifies the typed error) before calling a transition — exactly why those
// predicates are exported separately, so a caller can gate an affordance without try/catch.

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
