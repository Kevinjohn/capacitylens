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

import type { AppData, AppDataKey, ISOTimestamp, Resource, ScopedEntityKey } from "../types/entities";
import { parseISOTimestamp } from "../lib/integrity";
import { shortIdTag } from "./privateNames";

/**
 * The three DERIVED lifecycle states an entity can be read as. There is no stored `state` column —
 * the state is derived from the `archivedAt`/`deletedAt` tombstone fields (see {@link lifecycleStatus}):
 * - `'active'`   — neither tombstone set (the default; absent = active).
 * - `'archived'` — valid `archivedAt` set, valid `deletedAt` absent (soft, reversible: hidden from scheduling
 *                  but fully retained).
 * - `'deleted'`  — valid `deletedAt` set (a soft-delete tombstone). `deletedAt` WINS over `archivedAt`: a
 *                  record archived-then-deleted reads `'deleted'`, never `'archived'`.
 *
 * INVARIANT: these are the only three states; the predicates + transitions below are exhaustive over
 * them. Adding a state means adding it here first so every guard accounts for it.
 */
export type LifecycleState = "active" | "archived" | "deleted";

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
  archivedAt?: ISOTimestamp;
  /** ISO 8601 timestamp of the soft-delete tombstone. Absent/null = not deleted. `deletedAt` wins. */
  deletedAt?: ISOTimestamp;
}

/**
 * The entity tables that carry the lifecycle tombstones (archivedAt/deletedAt) and so run the
 * archive/unarchive/soft-delete/purge routes. Single-sourced HERE (the pure module both app and
 * server import) so the server's lifecycle-route allow-list (`isLifecycleEntity` in app.ts) and the
 * `sanitizeWrite` tombstone-pin (validate.ts) can't drift apart — two hand-rolled copies of this set
 * is exactly what silently rots if a 4th entity ever grows tombstones. Every other table
 * (phases/activities/allocations/timeOff/disciplines/accounts) is deliberately OUT.
 */
export const LIFECYCLE_ENTITY_KEYS = Object.freeze(["resources", "clients", "projects"] as const);
export type LifecycleEntityKey = (typeof LIFECYCLE_ENTITY_KEYS)[number];
/** Narrowing guard: is `e` one of the tombstone-carrying tables? */
export const isLifecycleEntityKey = (e: string): e is LifecycleEntityKey =>
  (LIFECYCLE_ENTITY_KEYS as readonly string[]).includes(e);

/**
 * The minimum age (in days) a soft-deleted tombstone must reach before it may be HARD-purged
 * (Admin-only, server-side, P2.5). Per the CapacityLens Decisions data-lifecycle rule: a tombstone
 * is retained for a grace window before the row is physically removed, so an accidental delete is
 * recoverable for at least this long. Consumed by {@link canPurge}.
 */
export const PURGE_MIN_AGE_DAYS = 30;

// The purge grace window expressed in milliseconds (derived from PURGE_MIN_AGE_DAYS, NO magic
// numbers) — the unit `Date.parse` works in, so {@link canPurge} can compare tombstone age directly.
const PURGE_MIN_AGE_MS = PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

// Lifecycle state is derived only from a canonical, parseable tombstone. Import repair uses the
// same nearest-valid-state rule; applying it at this read boundary prevents legacy/direct database
// corruption from creating a hidden state with no legal transition. Purge remains independently
// fail-closed below and never acts on an invalid deletion timestamp.
function isValidTombstone(value: ISOTimestamp | null | undefined): value is ISOTimestamp {
  return value != null && parseISOTimestamp(value) !== null;
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
 *          is valid, else `'active'`. Malformed legacy tombstones are ignored so the row derives
 *          to its nearest valid state and can be repaired by its next legal transition.
 */
export function lifecycleStatus(entity: LifecycleFields): LifecycleState {
  if (isValidTombstone(entity.deletedAt)) return "deleted";
  if (isValidTombstone(entity.archivedAt)) return "archived";
  return "active";
}

export type LifecycleAncestryRow = LifecycleFields & {
  id: string;
  accountId?: string;
} & Record<string, unknown>;

export type LifecycleAncestryLookup = (table: AppDataKey, id: string) => LifecycleAncestryRow | undefined;

export interface LifecycleAncestryResult {
  /** False only when a resolved ancestor is inactive; unresolved references remain visible. */
  visible: boolean;
  /** Present only for a proven archived/deleted ancestor; missing refs remain the FK guard's job. */
  inactiveAncestor?: {
    table: LifecycleEntityKey;
    id: string;
    state: Exclude<LifecycleState, "active">;
  };
}

interface LifecycleAncestryRelation {
  child: AppDataKey;
  parent: AppDataKey;
  field: string;
  optional?: boolean;
}

/** The same ancestor edges inherited by normal-read visibility and generic-write validation. */
const LIFECYCLE_ANCESTRY: readonly LifecycleAncestryRelation[] = [
  { child: "projects", parent: "clients", field: "clientId" },
  { child: "phases", parent: "projects", field: "projectId" },
  { child: "activities", parent: "projects", field: "projectId", optional: true },
  { child: "activities", parent: "phases", field: "phaseId", optional: true },
  { child: "resources", parent: "projects", field: "projectId", optional: true },
  { child: "allocations", parent: "projects", field: "projectId", optional: true },
  { child: "allocations", parent: "resources", field: "resourceId" },
  { child: "allocations", parent: "activities", field: "activityId" },
  { child: "timeOff", parent: "resources", field: "resourceId" },
];

// Derived constants — the two access patterns the walk and the projection need, computed ONCE from
// the single relation list above so a new edge can never leave one of them stale.
/** Edges grouped by CHILD table: a walk step reads only its own edges (most tables have one or
 *  none) instead of re-scanning the whole relation list. */
const CHILD_RELATIONS: ReadonlyMap<AppDataKey, readonly LifecycleAncestryRelation[]> = LIFECYCLE_ANCESTRY.reduce(
  (byChild, relation) => {
    const edges = byChild.get(relation.child);
    if (edges) edges.push(relation);
    else byChild.set(relation.child, [relation]);
    return byChild;
  },
  new Map<AppDataKey, LifecycleAncestryRelation[]>(),
);

/** The only tables the walk ever LOOKS UP — every other table is a leaf child, so indexing it would
 *  build a Map nothing reads. */
const PARENT_TABLES: readonly AppDataKey[] = [...new Set(LIFECYCLE_ANCESTRY.map((relation) => relation.parent))];

/** Per-projection cache of a walk's verdict, keyed `${table}|${id}`. Sound because the child-vs-parent
 *  accountId equality check happens at the EDGE, before recursion: a parent's own verdict is a pure
 *  function of (table, id, data) — it never depends on which child reached it. Rows are resolved
 *  through the id-keyed index, so one key can only ever mean one row. */
type LifecycleAncestryMemo = Map<string, LifecycleAncestryResult>;

/**
 * Inspect only an entity's lifecycle ancestry, not the entity's own lifecycle state. `activeOnly`
 * combines this with its own-state filter; generic writes use `inactiveAncestor` so ordinary
 * missing/cross-account references retain their existing validation messages.
 */
export function inspectLifecycleAncestry(
  table: AppDataKey,
  row: LifecycleAncestryRow,
  lookup: LifecycleAncestryLookup,
): LifecycleAncestryResult {
  return inspectAncestry(table, row, lookup, undefined);
}

function inspectAncestry(
  table: AppDataKey,
  row: LifecycleAncestryRow,
  lookup: LifecycleAncestryLookup,
  memo: LifecycleAncestryMemo | undefined,
): LifecycleAncestryResult {
  const relations = CHILD_RELATIONS.get(table);
  if (!relations) return { visible: true };
  for (const relation of relations) {
    const parentId = row[relation.field];
    if (relation.optional && parentId === undefined) continue;
    // This projection hides lifecycle state, not integrity damage. A missing, malformed or
    // cross-account reference is not evidence that an ancestor is archived/deleted; retain the row
    // so normal views can surface their existing "Unknown …" fallbacks and integrity tooling can
    // diagnose it. Generic writes independently reject the broken reference.
    if (typeof parentId !== "string") continue;
    const parent = lookup(relation.parent, parentId);
    if (!parent || (typeof row.accountId === "string" && parent.accountId !== row.accountId)) continue;
    if (isLifecycleEntityKey(relation.parent)) {
      const state = lifecycleStatus(parent);
      if (state !== "active") {
        return {
          visible: false,
          inactiveAncestor: { table: relation.parent, id: parent.id, state },
        };
      }
    }
    const upstream = memoisedAncestry(relation.parent, parent, lookup, memo);
    if (!upstream.visible) return upstream;
  }
  return { visible: true };
}

/** One resolved parent's verdict, reused across every child that reaches it (see
 *  {@link LifecycleAncestryMemo}). Without a memo this is a plain recursive call. */
function memoisedAncestry(
  table: AppDataKey,
  row: LifecycleAncestryRow,
  lookup: LifecycleAncestryLookup,
  memo: LifecycleAncestryMemo | undefined,
): LifecycleAncestryResult {
  if (!memo) return inspectAncestry(table, row, lookup, undefined);
  const key = `${table}|${row.id}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const result = inspectAncestry(table, row, lookup, memo);
  memo.set(key, result);
  return result;
}

// Compile-time completeness guard for {@link activeOnly}'s projection: every scoped table except
// `disciplines` (which carries no lifecycle edge) must be re-projected below, so adding a scoped
// table fails the type-check here rather than silently passing through unprojected.
type ProjectedLifecycleKey = Exclude<ScopedEntityKey, "disciplines" | "closures">;
const PROJECTED_LIFECYCLE_KEYS = [
  "resources",
  "clients",
  "projects",
  "phases",
  "activities",
  "allocations",
  "timeOff",
] as const satisfies readonly ProjectedLifecycleKey[];
type MissingProjectedKey = Exclude<ProjectedLifecycleKey, (typeof PROJECTED_LIFECYCLE_KEYS)[number]>;
const projectedKeysAreComplete: MissingProjectedKey extends never ? true : never = true;
// Both are compile-time-only witnesses; `void` marks them as deliberately unused at runtime (the
// same idiom as the completeness assertions in ../types/entities.ts).
void PROJECTED_LIFECYCLE_KEYS;
void projectedKeysAreComplete;

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
 * Proven lifecycle state is inherited by the read projection: projects under hidden clients, phases and
 * project activities under hidden projects, and allocations/time off whose visible endpoint was
 * hidden are also removed. Storage and exports retain those rows; normal views do not leak
 * orphan-labelled descendants or allocation bars after a parent is archived/deleted. Unresolvable
 * references are retained rather than treated as invented lifecycle evidence, so integrity damage
 * stays visible through the app's safe fallback labels and can be diagnosed.
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
  const isActive = (e: LifecycleFields) => lifecycleStatus(e) === "active";
  const indexes = Object.fromEntries(
    PARENT_TABLES.map((table) => [
      table,
      new Map((data[table] as unknown as LifecycleAncestryRow[]).map((row) => [row.id, row])),
    ]),
  ) as Partial<Record<AppDataKey, Map<string, LifecycleAncestryRow>>>;
  // Only PARENT_TABLES are indexed, and the walk only ever looks a PARENT up — an unindexed table
  // reads as an unresolvable reference, which the walk already retains rather than hides.
  const lookup: LifecycleAncestryLookup = (table, id) => indexes[table]?.get(id);
  const memo: LifecycleAncestryMemo = new Map();
  const hasVisibleAncestry = (table: AppDataKey, row: object): boolean =>
    inspectAncestry(table, row as LifecycleAncestryRow, lookup, memo).visible;
  const resources = data.resources.filter(isActive);
  const clients = data.clients.filter(isActive);
  // Parent lifecycle is inherited by the read projection. An active child beneath an archived or
  // deleted parent is retained in storage/export, but cannot remain independently visible in the
  // normal app (which previously left orphan-labelled projects and allocation bars on screen).
  const projects = data.projects.filter((project) => isActive(project) && hasVisibleAncestry("projects", project));
  const phases = data.phases.filter((phase) => hasVisibleAncestry("phases", phase));
  const activities = data.activities.filter((activity) => hasVisibleAncestry("activities", activity));
  return {
    ...data,
    resources,
    clients,
    projects,
    phases,
    activities,
    allocations: data.allocations.filter((allocation) => hasVisibleAncestry("allocations", allocation)),
    timeOff: data.timeOff.filter((entry) => hasVisibleAncestry("timeOff", entry)),
  };
}

/**
 * Per-table counts of currently-ACTIVE descendants that archiving ONE entity would additionally HIDE
 * from the {@link activeOnly} view projection — NOT counting the entity itself. Feeds the
 * archive-confirmation warning ("this also hides N projects and M allocations").
 */
export interface ArchiveImpact {
  /** Active projects hidden — non-zero only when archiving a CLIENT. */
  projects: number;
  /** Active phases hidden beneath an archived client or project. */
  phases: number;
  /** Active project-activities hidden. */
  activities: number;
  /** Active allocation bars hidden. */
  allocations: number;
  /** Active time-off entries hidden — non-zero only when archiving a RESOURCE. */
  timeOff: number;
}

// A valid sentinel `archivedAt` used only to MEASURE the cascade (never persisted), so this flips
// the target row to 'archived' for the diff under the same strict timestamp rule as real rows.
const ARCHIVE_IMPACT_SENTINEL = "2000-01-01T00:00:00.000Z" as ISOTimestamp;

/**
 * Count what archiving one active `resource`/`client`/`project` would ADDITIONALLY hide from the
 * normal view, so the UI can warn before a cascade archive. PURE.
 *
 * Computed by DIFFING {@link activeOnly} before vs after flipping the target row to archived, so the
 * counts can NEVER drift from the real view-projection rule (extend the cascade in activeOnly and
 * this follows for free). The entity's OWN row is excluded per type: a client's own row lives in
 * `clients`; a project has no descendant projects; a resource no descendant resources — so `projects`
 * is reported only for a client and `timeOff` only for a resource.
 *
 * @param data   account-scoped AppData to measure against — pass the ACTIVE projection, since the
 *               counts are of currently-VISIBLE descendants that would disappear.
 * @param entity which lifecycle table the archived row lives in.
 * @param id     the row being archived; throws when it is missing or not active.
 */
export function archiveImpact(data: AppData, entity: LifecycleEntityKey, id: string): ArchiveImpact {
  const target = data[entity].find((row) => row.id === id);
  if (!target) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot measure archive impact: ${entity}.${id} is missing.`,
    );
  }
  const targetState = lifecycleStatus(target);
  if (targetState !== "active") {
    throw new LifecycleTransitionError(
      "already_inactive",
      `Cannot measure archive impact: ${entity}.${id} is ${targetState}, not active.`,
    );
  }
  const flip = <T extends LifecycleFields & { id: string }>(rows: readonly T[]): T[] =>
    rows.map((row) => (row.id === id ? { ...row, archivedAt: ARCHIVE_IMPACT_SENTINEL } : row));
  const archived: AppData = {
    ...data,
    resources: entity === "resources" ? flip(data.resources) : data.resources,
    clients: entity === "clients" ? flip(data.clients) : data.clients,
    projects: entity === "projects" ? flip(data.projects) : data.projects,
  };
  const before = activeOnly(data);
  const after = activeOnly(archived);
  const hidden = (key: "projects" | "phases" | "activities" | "allocations" | "timeOff"): number =>
    before[key].length - after[key].length;
  return {
    projects: entity === "clients" ? hidden("projects") : 0,
    phases: hidden("phases"),
    activities: hidden("activities"),
    allocations: hidden("allocations"),
    timeOff: entity === "resources" ? hidden("timeOff") : 0,
  };
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
  return lifecycleStatus(entity) === "active";
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
  return lifecycleStatus(entity) === "archived";
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
  return lifecycleStatus(entity) === "archived";
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
 * not `'deleted'`, OR if `deletedAt`/`nowISO` is missing or outside the supported strict ISO
 * timestamp form. When in doubt, refuse.
 *
 * @param entity - the (expected soft-deleted) entity to test.
 * @param nowISO - the caller-supplied "now" timestamp (the store/server owns the clock and passes it
 *                 in) to measure the tombstone's age against.
 * @returns `true` iff the entity is a soft-deleted tombstone at least {@link PURGE_MIN_AGE_DAYS} old;
 *          `false` in every other case (including any parse failure).
 */
export function canPurge(entity: LifecycleFields, nowISO: ISOTimestamp): boolean {
  // Fail-closed: only a soft-deleted tombstone is ever purgeable.
  if (lifecycleStatus(entity) !== "deleted") return false;
  // `lifecycleStatus === 'deleted'` guarantees `deletedAt` is present; parse both ends.
  const deletedMs = parseISOTimestamp(entity.deletedAt);
  const nowMs = parseISOTimestamp(nowISO);
  // Fail-closed at an untyped boundary: only the supported strict ISO shape may unlock a purge.
  if (deletedMs === null || nowMs === null) return false;
  return nowMs - deletedMs >= PURGE_MIN_AGE_MS;
}

export type LifecycleTransitionErrorCode = "already_inactive" | "invalid_transition";

/** A lifecycle precondition failure that API adapters may classify without inspecting prose. */
export class LifecycleTransitionError extends Error {
  readonly code: LifecycleTransitionErrorCode;

  constructor(code: LifecycleTransitionErrorCode, message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
    this.code = code;
  }
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
 * @returns a new entity of the same type with a canonical `archivedAt`.
 * @throws {Error} if the entity is already archived/deleted or the timestamp is invalid.
 */
export function archive<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canArchive(entity)) {
    const status = lifecycleStatus(entity);
    throw new LifecycleTransitionError(
      status === "archived" ? "already_inactive" : "invalid_transition",
      `Cannot archive: entity is already ${status}.`,
    );
  }
  const archivedMs = parseISOTimestamp(nowISO);
  if (archivedMs === null) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      "Cannot archive: archive time must be a valid ISO timestamp.",
    );
  }
  const next = { ...entity };
  delete next.archivedAt;
  delete next.deletedAt;
  return { ...next, archivedAt: new Date(archivedMs).toISOString() };
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
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot unarchive: entity is ${lifecycleStatus(entity)}, not archived.`,
    );
  }
  // Copy then DELETE the key so the field round-trips as absent (absent = active), rather than
  // leaving an explicit `archivedAt: undefined` that JSON/SQLite would treat differently.
  const next = { ...entity };
  delete next.archivedAt;
  // A malformed deletedAt is ignored by lifecycleStatus so the nearest valid state is archived;
  // remove that stale corruption while completing the recovery transition to active.
  if (!isValidTombstone(next.deletedAt)) delete next.deletedAt;
  return next;
}

/**
 * Soft-delete an entity (archived → deleted). Returns a NEW object with `deletedAt` set to a valid
 * canonical instant no earlier than `archivedAt`, PRESERVING `archivedAt` — the tombstone retains
 * when it was archived; {@link lifecycleStatus} still reads `'deleted'` because `deletedAt` wins.
 * The input is NOT mutated. A caller clock behind the archive is clamped to the archive instant so
 * this transition cannot create ordering that import must later repair by dropping the deletion.
 *
 * STRICT: THROWS if the entity is not `'archived'` — enforcing the Decisions rule that soft-delete
 * requires PRIOR archival (you cannot delete an active record directly), and refusing to re-delete an
 * existing tombstone. The guard is the shared {@link canSoftDelete} predicate.
 *
 * @param entity - the entity to soft-delete (must be `'archived'`).
 * @param nowISO - the caller-supplied delete timestamp (the store/server owns the clock).
 * @returns a new entity of the same type with an ordered `deletedAt` and `archivedAt` preserved.
 * @throws {Error} if the entity is not currently archived or either timestamp is invalid.
 */
export function softDelete<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canSoftDelete(entity)) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot delete: entity must be archived first (is ${lifecycleStatus(entity)}).`,
    );
  }
  const archivedMs = parseISOTimestamp(entity.archivedAt);
  const deletedMs = parseISOTimestamp(nowISO);
  if (archivedMs === null || deletedMs === null) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      "Cannot delete: archive and deletion times must be valid ISO timestamps.",
    );
  }
  return { ...entity, deletedAt: new Date(Math.max(archivedMs, deletedMs)).toISOString() };
}

/**
 * Scrub a Resource's PII when it becomes a soft-delete tombstone — the resource-PII-erasure step of
 * the privacy/data-lifecycle. Returns a NEW Resource with `name` replaced by a deterministic
 * anonymised token; the input is NOT mutated and EVERY non-PII field flows through unchanged.
 *
 * WHY: a soft-deleted row is retained for the {@link PURGE_MIN_AGE_DAYS} grace window, but it must
 * carry NO original personal data while it waits to be purged. A Resource TODAY has NO email and NO
 * SSO link. Both `name` and the unconstrained display-label `role` can contain identifying text, so
 * both are scrubbed. id/accountId/kind/disciplineId/employmentType/engagement/
 * workingHoursPerDay/workingDays/halfDays/projectId/color, the lifecycle tombstones
 * (archivedAt/deletedAt) and audit timestamps (createdAt/updatedAt) are preserved.
 *
 * The token is `Removed person #<tag>`, where `<tag>` is a short stable marker from the id (see
 * {@link shortIdTag}) — derived from the id so the transform is PURE and testable (no clock, no
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
 * {@link Resource}, extend this to scrub any future personal fields here too. Authentication-member
 * erasure remains a separate server concern because those fields do not exist on a Resource.
 *
 * @param resource - the Resource being soft-deleted (any kind: person / placeholder / external).
 * @returns a NEW Resource identical to the input except `name` is the anonymised token and `role`
 *          is the generic non-identifying removed-resource label.
 */
export function obfuscateResource(resource: Resource): Resource {
  return { ...resource, name: `Removed person #${shortIdTag(resource.id)}`, role: "Removed resource" };
}

// NOTE: there is deliberately NO `purge(entity)` function. Purge is a HARD row-delete done
// server-side in P2.5; the entity simply ceases to exist, so there is no "next entity" to return.
// This module provides only the {@link canPurge} eligibility predicate plus the derive helpers.
