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
// DESIGN DECISION (P2.2): the three transition functions are STRICT — they THROW a plain `Error` on
// an invalid source state rather than being silently idempotent. Rationale: this is the strict,
// exhaustively-testable state machine, and it matches the domain's fail-loud invariant-throw idiom
// (assertScopedRefs / findOwned in mutations.ts `throw new Error('…')`; there are NO custom error
// classes in shared) and DEFENSIVE-CODING's "never soften an integrity throw". A re-archive or a
// double-delete is a caller bug worth surfacing, not a no-op to absorb. The wiring layer (P2.5)
// pre-checks with the exported `can*` predicates (or catches) before calling a transition — which is
// exactly why those predicates are exported separately, so a caller can gate an affordance without a
// try/catch (mirrors access.ts's `can*` predicates).

import type { AppData, ISOTimestamp, Resource } from '../types/entities'

/**
 * The three DERIVED lifecycle states an entity can be read as. There is no stored `state` column —
 * the state is derived from the `archivedAt`/`deletedAt` tombstone fields (see {@link lifecycleStatus}):
 * - `'active'`   — neither tombstone set (the default; absent = active).
 * - `'archived'` — `archivedAt` set, `deletedAt` absent (soft, reversible: hidden from scheduling
 *                  but fully retained).
 * - `'deleted'`  — `deletedAt` set (a soft-delete tombstone). `deletedAt` WINS over `archivedAt`: a
 *                  record archived-then-deleted reads `'deleted'`, never `'archived'`.
 *
 * INVARIANT: these are the only three states; the predicates + transitions below are exhaustive over
 * them. Adding a state means adding it here first so every guard accounts for it.
 */
export type LifecycleState = 'active' | 'archived' | 'deleted'

/**
 * The minimal structural shape the lifecycle machine reads and writes — the two optional tombstone
 * timestamps. Resource, Client and Project (P2.1) all satisfy this by carrying the same two fields,
 * so the machine is generic over the shape rather than coupled to those concrete types: a transition
 * takes `<T extends LifecycleFields>` and returns `T`, so `archive(aResource)` yields a `Resource`
 * with its other fields untouched.
 *
 * Named `LifecycleFields` (over `Lifecyclable`) to read as "the fields the lifecycle owns" — it's a
 * structural CONSTRAINT on the entity, not a capability the entity has.
 */
export interface LifecycleFields {
  /** ISO 8601 timestamp of when the entity was archived (soft, reversible). Absent/null = not archived. */
  archivedAt?: ISOTimestamp
  /** ISO 8601 timestamp of the soft-delete tombstone. Absent/null = not deleted. `deletedAt` wins. */
  deletedAt?: ISOTimestamp
}

/**
 * The entity tables that carry the lifecycle tombstones (archivedAt/deletedAt) and so run the
 * archive/unarchive/soft-delete/purge routes. Single-sourced HERE (the pure module both app and
 * server import) so the server's lifecycle-route allow-list (`isLifecycleEntity` in app.ts) and the
 * `sanitizeWrite` tombstone-pin (validate.ts) can't drift apart — two hand-rolled copies of this set
 * is exactly what silently rots if a 4th entity ever grows tombstones. Every other table
 * (phases/activities/allocations/timeOff/disciplines/accounts) is deliberately OUT.
 */
export const LIFECYCLE_ENTITY_KEYS = ['resources', 'clients', 'projects'] as const
export type LifecycleEntityKey = (typeof LIFECYCLE_ENTITY_KEYS)[number]
/** Narrowing guard: is `e` one of the tombstone-carrying tables? */
export const isLifecycleEntityKey = (e: string): e is LifecycleEntityKey =>
  (LIFECYCLE_ENTITY_KEYS as readonly string[]).includes(e)

/**
 * The minimum age (in days) a soft-deleted tombstone must reach before it may be HARD-purged
 * (Admin-only, server-side, P2.5). Per the CapacityLens Decisions data-lifecycle rule: a tombstone
 * is retained for a grace window before the row is physically removed, so an accidental delete is
 * recoverable for at least this long. Consumed by {@link canPurge}.
 */
export const PURGE_MIN_AGE_DAYS = 30

// The purge grace window expressed in milliseconds (derived from PURGE_MIN_AGE_DAYS, NO magic
// numbers) — the unit `Date.parse` works in, so {@link canPurge} can compare tombstone age directly.
const PURGE_MIN_AGE_MS = PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000

// A present-check that treats BOTH `undefined` and `null` as absent — the P2.1 convention is
// "absent = not in that state", and a column round-tripped through SQLite/JSON can come back `null`
// rather than `undefined`. `value != null` (loose) is the idiomatic both-at-once guard.
function isPresent(value: ISOTimestamp | null | undefined): value is ISOTimestamp {
  return value != null
}

/**
 * Derive the {@link LifecycleState} of an entity from its tombstone fields. PURE: a function of the
 * two fields only — no I/O, no Date.
 *
 * Precedence is load-bearing: `deletedAt` WINS over `archivedAt`, so a record that was
 * archived-then-deleted reads `'deleted'` (a tombstone, not "archived"). `archivedAt` is only
 * consulted when `deletedAt` is absent. Both `undefined` and `null` count as absent.
 *
 * @param entity - any object carrying the {@link LifecycleFields} (Resource/Client/Project).
 * @returns the derived state: `'deleted'` if `deletedAt` is set, else `'archived'` if `archivedAt`
 *          is set, else `'active'`.
 */
export function lifecycleStatus(entity: LifecycleFields): LifecycleState {
  if (isPresent(entity.deletedAt)) return 'deleted'
  if (isPresent(entity.archivedAt)) return 'archived'
  return 'active'
}

/**
 * Project an {@link AppData} to its ACTIVE rows only — drop every NON-active (archived OR soft-deleted)
 * Resource/Client/Project. PURE: returns a NEW AppData; the input and every nested array are left
 * untouched (the kept rows are the SAME object references, just re-collected into fresh arrays).
 *
 * This is the SINGLE source of the "hide non-active from the view" rule (P2.4), reused by BOTH the
 * client VIEW seam (`useActiveScopedData`, src/store) and the server per-account read
 * (`readSlice`'s `includeInactive: false` branch, server/db.ts) — so the two halves can't drift on
 * what "shown in the normal app" means. "Active" is exactly `lifecycleStatus(e) === 'active'`, so the
 * lifecycle state machine stays the single authority (a future state never silently leaks into views).
 *
 * ONLY `resources`/`clients`/`projects` are filtered — they are the ONLY entities carrying the
 * `archivedAt`/`deletedAt` tombstones (P2.1). `phases`/`activities`/`allocations`/`timeOff`/
 * `disciplines`/`accounts` have NO lifecycle field, so they pass through unchanged: a child of a
 * hidden parent (e.g. an active project under an archived client, or an active activity under an
 * archived project) is filtered ONLY by its OWN status — it is NOT cascaded out here. Every
 * cross-reference in the view path is optional-chained, so such a child simply renders a fallback
 * label rather than crashing; this helper deliberately does NOT orphan-prune.
 *
 * INVARIANT — VIEW/READ PROJECTION ONLY. Use this ONLY where the goal is "what the normal app shows":
 * the scheduler/list/picker/palette views and the per-account read. NEVER on an integrity, mutation,
 * cascade, import, migrate or EXPORT path — those MUST see every row (a backup retains archived/
 * soft-deleted rows; cascade/integrity reason over the full set). Hiding rows from those paths would
 * silently drop retained data. This is a payload-narrowing projection, not a delete.
 *
 * @param data - the full (already account-scoped) AppData to project.
 * @returns a NEW AppData identical to `data` except non-active resources/clients/projects are removed.
 */
export function activeOnly(data: AppData): AppData {
  const isActive = (e: LifecycleFields) => lifecycleStatus(e) === 'active'
  return {
    ...data,
    resources: data.resources.filter(isActive),
    clients: data.clients.filter(isActive),
    projects: data.projects.filter(isActive),
  }
}

/**
 * May this entity be archived? PURE affordance predicate — true IFF the entity is currently
 * `'active'`. Lets a caller gate an "Archive" control without a try/catch; it is the SINGLE-SOURCE
 * guard the {@link archive} transition itself re-uses, so the affordance and the transition can't
 * disagree (mirrors access.ts's `can*` predicates).
 *
 * @param entity - the entity to test.
 * @returns `true` iff {@link lifecycleStatus} is `'active'`.
 */
export function canArchive(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === 'active'
}

/**
 * May this entity be un-archived (restored to active)? PURE affordance predicate — true IFF the
 * entity is currently `'archived'`. A `'deleted'` tombstone is NOT un-archivable (it must be
 * restored via a different path, not by clearing `archivedAt`), and an `'active'` entity has nothing
 * to undo.
 *
 * @param entity - the entity to test.
 * @returns `true` iff {@link lifecycleStatus} is `'archived'`.
 */
export function canUnarchive(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === 'archived'
}

/**
 * May this entity be soft-deleted? PURE affordance predicate — true IFF the entity is currently
 * `'archived'`. The load-bearing CapacityLens Decisions rule: soft-delete requires PRIOR archival
 * (you cannot delete an active record directly), so this gates `'archived'`, not `'active'`.
 *
 * NOTE: this is currently the same predicate as {@link canUnarchive} (both gate `'archived'`), but
 * they are kept as DISTINCT named exports on purpose — they answer semantically different questions
 * and may diverge. This mirrors access.ts keeping `manageMembers`/`manageInvites`/`purge` distinct
 * though all three resolve to the admin tier today.
 *
 * @param entity - the entity to test.
 * @returns `true` iff {@link lifecycleStatus} is `'archived'`.
 */
export function canSoftDelete(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === 'archived'
}

/**
 * May this soft-deleted tombstone be HARD-purged (physically removed) NOW? PURE affordance predicate
 * — true IFF the entity is `'deleted'` AND the tombstone has aged at least {@link PURGE_MIN_AGE_DAYS}
 * (i.e. `nowISO - deletedAt >= PURGE_MIN_AGE_MS`, an inclusive boundary). Time math is done by
 * parsing the INJECTED `nowISO` against `deletedAt` (deterministic — a function of inputs only;
 * never reads an ambient clock). The actual purge is a server-side row-delete (P2.5); this is only
 * the eligibility check.
 *
 * Fail-closed: purge is DESTRUCTIVE, so this never falls open. It returns `false` if the entity is
 * not `'deleted'`, OR if `deletedAt`/`nowISO` is missing or unparseable (`Number.isNaN` after
 * `Date.parse`). When in doubt, refuse.
 *
 * @param entity - the (expected soft-deleted) entity to test.
 * @param nowISO - the caller-supplied "now" timestamp (the store/server owns the clock and passes it
 *                 in) to measure the tombstone's age against.
 * @returns `true` iff the entity is a soft-deleted tombstone at least {@link PURGE_MIN_AGE_DAYS} old;
 *          `false` in every other case (including any parse failure).
 */
export function canPurge(entity: LifecycleFields, nowISO: ISOTimestamp): boolean {
  // Fail-closed: only a soft-deleted tombstone is ever purgeable.
  if (lifecycleStatus(entity) !== 'deleted') return false
  // `lifecycleStatus === 'deleted'` guarantees `deletedAt` is present; parse both ends.
  const deletedMs = Date.parse(entity.deletedAt as ISOTimestamp)
  const nowMs = Date.parse(nowISO)
  // Fail-closed at an untyped boundary: an unparseable timestamp yields NaN, and any comparison with
  // NaN is `false` anyway — but we deny EXPLICITLY rather than rely on that, since purge is destructive.
  if (Number.isNaN(deletedMs) || Number.isNaN(nowMs)) return false
  return nowMs - deletedMs >= PURGE_MIN_AGE_MS
}

/**
 * Archive an entity (active → archived). Returns a NEW object with `archivedAt` set to `nowISO`; the
 * input is NOT mutated and every other field flows through unchanged (the generic `<T>` preserves the
 * concrete type, so `archive(aResource)` returns a `Resource`).
 *
 * STRICT: THROWS if the entity is not `'active'` (re-archiving an archived/deleted record is a caller
 * bug — see this module's DESIGN DECISION header). The guard is the shared {@link canArchive}
 * predicate, so the throw condition can't drift from the affordance.
 *
 * @param entity - the entity to archive (must be `'active'`).
 * @param nowISO - the caller-supplied archive timestamp (the store/server owns the clock).
 * @returns a new entity of the same type with `archivedAt = nowISO`.
 * @throws {Error} if the entity is already archived or deleted.
 */
export function archive<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canArchive(entity)) {
    throw new Error(`Cannot archive: entity is already ${lifecycleStatus(entity)}.`)
  }
  return { ...entity, archivedAt: nowISO }
}

/**
 * Un-archive an entity (archived → active). Returns a NEW object with `archivedAt` CLEARED — the key
 * is REMOVED (not set to `undefined`) so it round-trips as ABSENT, matching the P2.1 convention that
 * absent = active. The input is NOT mutated and `deletedAt` is untouched (un-archive only fires from
 * `'archived'`, where `deletedAt` is already absent).
 *
 * STRICT: THROWS if the entity is not `'archived'` — refusing to un-archive a `'deleted'` tombstone
 * (correct: a tombstone is not restored by clearing `archivedAt`) or an already-`'active'` record.
 * The guard is the shared {@link canUnarchive} predicate.
 *
 * @param entity - the entity to restore (must be `'archived'`).
 * @returns a new entity of the same type with `archivedAt` absent.
 * @throws {Error} if the entity is not currently archived.
 */
export function unarchive<T extends LifecycleFields>(entity: T): T {
  if (!canUnarchive(entity)) {
    throw new Error(`Cannot unarchive: entity is ${lifecycleStatus(entity)}, not archived.`)
  }
  // Copy then DELETE the key so the field round-trips as absent (absent = active), rather than
  // leaving an explicit `archivedAt: undefined` that JSON/SQLite would treat differently.
  const next = { ...entity }
  delete next.archivedAt
  return next
}

/**
 * Soft-delete an entity (archived → deleted). Returns a NEW object with `deletedAt` set to `nowISO`,
 * PRESERVING `archivedAt` — the tombstone retains when it was archived; {@link lifecycleStatus} still
 * reads `'deleted'` because `deletedAt` wins. The input is NOT mutated.
 *
 * STRICT: THROWS if the entity is not `'archived'` — enforcing the Decisions rule that soft-delete
 * requires PRIOR archival (you cannot delete an active record directly), and refusing to re-delete an
 * existing tombstone. The guard is the shared {@link canSoftDelete} predicate.
 *
 * @param entity - the entity to soft-delete (must be `'archived'`).
 * @param nowISO - the caller-supplied delete timestamp (the store/server owns the clock).
 * @returns a new entity of the same type with `deletedAt = nowISO` and `archivedAt` preserved.
 * @throws {Error} if the entity is not currently archived.
 */
export function softDelete<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canSoftDelete(entity)) {
    throw new Error(`Cannot delete: entity must be archived first (is ${lifecycleStatus(entity)}).`)
  }
  return { ...entity, deletedAt: nowISO }
}

// The fallback tag used when a resource id is empty or yields no alphanumerics — so an
// {@link obfuscateResource} token is NEVER a bare `Removed person #` with an empty marker. Constant
// (not random) to keep the helper deterministic; `0000` reads clearly as "no usable id".
const ANON_FALLBACK_TAG = '0000'

/**
 * Derive a short, STABLE tag from a resource id for the anonymised soft-delete token. PURE: a
 * function of the id string only — no Date, no Math.random.
 *
 * FORMAT CHOICE (documented): strip every non-alphanumeric character (so a UUID's hyphens go) and
 * take the FIRST 4 of what remains — i.e. the UUID's leading hex. Short, opaque, and deterministic.
 * If the id is empty or has no alphanumerics, fall back to {@link ANON_FALLBACK_TAG} so the token is
 * never left with an empty marker. NON-exported: an internal detail of {@link obfuscateResource}, not
 * a public contract.
 */
function shortResourceTag(id: string): string {
  const tag = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)
  return tag.length > 0 ? tag : ANON_FALLBACK_TAG
}

/**
 * Scrub a Resource's PII when it becomes a soft-delete tombstone — the resource-PII-erasure step of
 * the privacy/data-lifecycle. Returns a NEW Resource with `name` replaced by a deterministic
 * anonymised token; the input is NOT mutated and EVERY non-PII field flows through unchanged.
 *
 * WHY: a soft-deleted row is retained for the {@link PURGE_MIN_AGE_DAYS} grace window, but it must
 * carry NO original personal data while it waits to be purged. A Resource TODAY has NO email and NO
 * SSO link — its ONLY PII is `name`, so that is all there is to scrub. `role` is a job label
 * ("Senior Designer"), NOT PII — it is RETAINED, as are id/accountId/kind/disciplineId/employmentType/
 * workingHoursPerDay/workingDays/projectId/color and the lifecycle tombstones (archivedAt/deletedAt)
 * and audit timestamps (createdAt/updatedAt).
 *
 * The token is `Removed person #<tag>`, where `<tag>` is a short stable marker from the id (see
 * {@link shortResourceTag}) — derived from the id so the transform is PURE and testable (no clock, no
 * randomness). The scrub is UNCONDITIONAL across every {@link Resource} kind: a nameless placeholder
 * still gets the token (never left undefined), and for an `external` resource — where `name` holds the
 * COMPANY identifier, also PII to erase — the company name is replaced too. A soft-deleted row must
 * read clearly as removed and retain no original `name` whatever it once held.
 *
 * INVARIANT: no original `name` survives the call; the token is deterministic from the id (same id ⇒
 * same token); the input is untouched (immutable — spread + override, a different reference returned).
 *
 * STANDALONE: this is a transform, NOT a transition — it does NOT call {@link softDelete} or set any
 * tombstone. The wiring (P2.5, the server soft-delete route) COMPOSES `softDelete` + `obfuscateResource`;
 * keeping them separate lets each be tested in isolation.
 *
 * FORWARD NOTE: when the parked "resource login" feature later adds `email`/`ssoUserId` to
 * {@link Resource} (per CapacityLens.md P2.3), EXTEND this to scrub `email` and unlink `ssoUserId` here
 * too — those are the MEMBER-erasure fields (P2.6) that don't exist on a Resource yet.
 *
 * @param resource - the Resource being soft-deleted (any kind: person / placeholder / external).
 * @returns a NEW Resource identical to the input except `name` is the anonymised token.
 */
export function obfuscateResource(resource: Resource): Resource {
  return { ...resource, name: `Removed person #${shortResourceTag(resource.id)}` }
}

// NOTE: there is deliberately NO `purge(entity)` function. Purge is a HARD row-delete done
// server-side in P2.5; the entity simply ceases to exist, so there is no "next entity" to return.
// This module provides only the {@link canPurge} eligibility predicate plus the derive helpers.
