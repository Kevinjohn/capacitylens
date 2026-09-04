import type { AppData, Resource, ResourceKind, SchedulingMode, ScopedEntity, ScopedEntityKey } from "./entities";
import { APP_DATA_KEYS, FULL_DAY_HOURS, MAX_HOURS_PER_DAY, SCOPED_KEYS } from "./entities";

/** Does an allocation entered in this mode carry an HOURLY load? Only 'blocks' does not — a block
 *  records placement and its load is projected as `blockHoursPerDay` instead of the typed hours.
 *  This is the SINGLE predicate every load-sensitive surface gates on (capacity projection, the
 *  bar's hours suffix, reassignment reconciliation, the modal's hours validation), so the four
 *  local spellings that used to re-test `mode === "blocks"` — blocksMode / isBlocks / zeroLoadMode —
 *  now all resolve from one place. */
export function carriesHourlyLoad(mode: SchedulingMode): boolean {
  return mode !== "blocks";
}

/** Shared runtime guard for the same closed scoped-entity vocabulary enforced above. */
export function isScopedEntityKey(key: string): key is ScopedEntityKey {
  return (SCOPED_KEYS as readonly string[]).includes(key);
}

/** A uniform `ScopedEntity[]` view of AppData's scoped tables. The SCOPED_KEYS
 *  loops (scope-to-account, cascade-delete, import) process every scoped table as
 *  the common supertype; this isolates into ONE named seam the single cast
 *  TypeScript can't infer through a heterogeneous-union index — replacing the
 *  scattered `as never` / `as unknown as` casts the loops used to need. */
export function scopedTables(data: AppData): Record<ScopedEntityKey, ScopedEntity[]> {
  return data as Record<ScopedEntityKey, ScopedEntity[]>;
}

/** Clamp an ALLOCATION's hours/day into [0, MAX_HOURS_PER_DAY]; a non-finite value → 0. The
 *  ONE rule shared by the store write boundary (every allocation write) and the import
 *  sanitiser, so the two can never drift. 0 is legal (a 'blocks' booking carries 0 load);
 *  a day can't exceed 24h. */
export function clampHoursPerDay(h: number): number {
  return Number.isFinite(h) ? Math.max(0, Math.min(h, MAX_HOURS_PER_DAY)) : 0;
}

/** Clamp a RESOURCE's working hours/day to (0, MAX_HOURS_PER_DAY]. Unlike an allocation, a
 *  resource must work a POSITIVE number of hours (0 capacity = no working day at all — same
 *  reason the store rejects an empty working-week), so junk / <= 0 falls back to a normal 8h
 *  day; a finite positive value just clamps to the 24h ceiling. Shared by the import sanitiser
 *  and the store resource write path so the two stay in lockstep. */
export function clampWorkingHoursPerDay(h: number): number {
  return Number.isFinite(h) && h > 0 ? Math.min(h, MAX_HOURS_PER_DAY) : FULL_DAY_HOURS;
}

/** Outsourced / 3rd-party resources have NO capacity (no hours, utilisation, or over-markers) and
 *  render in their own neutral band. This is the SINGLE predicate every capacity surface gates on —
 *  so a new capacity-free kind is a one-line change here, not N scattered `kind === 'external'`
 *  checks across the scheduler / forms / import. */
export function isExternalResource(r: { kind: ResourceKind }): boolean {
  return r.kind === "external";
}

/** Inverse of {@link isExternalResource} — true when a resource participates in capacity/utilisation. */
export function isCapacityTracked(r: { kind: ResourceKind }): boolean {
  return !isExternalResource(r);
}

/** True when a resource persists its own working-week pattern. Placeholders derive their live week
 *  from the company calendar, while externals have no capacity at all. */
export function hasPersonalWorkingPattern(r: { kind: ResourceKind }): boolean {
  return r.kind === "person";
}

/** The single kind check for placeholder-specific persistence and import rules. */
export function isPlaceholderResource(r: { kind: ResourceKind }): boolean {
  return r.kind === "placeholder";
}

/** Fresh inert weekday arrays shared by resource kinds that do not persist a personal pattern. */
function defaultCapacityWorkingPattern(): Pick<Resource, "workingDays" | "halfDays"> {
  return {
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
  };
}

/** The unused silent-default capacity fields every `external` resource is created with: externals
 *  have no capacity, but the Resource type + store still require a positive working day and a
 *  non-empty week. A FACTORY (not a shared object) so each call gets its own weekday arrays — no
 *  aliasing if a consumer mutates one. One source for the External form, seed, and fixtures. */
export function externalCapacityDefaults(): Pick<
  Resource,
  "employmentType" | "engagement" | "workingHoursPerDay" | "workingDays" | "halfDays"
> {
  return {
    employmentType: "permanent",
    engagement: "studio" as const,
    workingHoursPerDay: FULL_DAY_HOURS,
    ...defaultCapacityWorkingPattern(),
  };
}

/** The account-independent silent defaults for placeholder capacity fields. Placeholders derive
 *  their live working week from the company calendar, so these persisted fields are deliberately
 *  inert and must never copy an account's current selection. A factory gives every caller fresh
 *  arrays, avoiding aliases if a consumer mutates one. */
export function placeholderCapacityDefaults(): Pick<Resource, "workingDays" | "halfDays"> {
  return defaultCapacityWorkingPattern();
}

/** A fresh, empty dataset — the starting point before seeding. */
export function emptyAppData(): AppData {
  return {
    accounts: [],
    disciplines: [],
    resources: [],
    clients: [],
    projects: [],
    phases: [],
    activities: [],
    allocations: [],
    timeOff: [],
    closures: [],
  };
}

/** True when every AppData table is an empty array — a genuinely empty dataset (a
 *  first run or a fully-cleared store). The single definition shared by the client
 *  bootstrap (src/data/persist.ts) and the server's init-marker backfill
 *  (server/src/db.ts) so the two "is this empty?" checks can never drift. */
export function isEmpty(data: AppData): boolean {
  return APP_DATA_KEYS.every((key) => data[key].length === 0);
}
