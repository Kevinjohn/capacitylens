import type { AppData, Resource, ResourceKind, SchedulingMode, ScopedEntity, ScopedEntityKey } from "./entities";
import { APP_DATA_KEYS, FULL_DAY_HOURS, MAX_HOURS_PER_DAY, SCOPED_KEYS } from "./entityKeys";

/** Does an allocation entered in this mode carry an hourly load? Blocks record placement and use
 * `blockHoursPerDay` instead of typed hours. Capacity projections, labels, reassignment, and
 * validation use this predicate for a consistent distinction. */
export function carriesHourlyLoad(mode: SchedulingMode): boolean {
  return mode !== "blocks";
}

/** Narrow a table name to the scoped-entity vocabulary in SCOPED_KEYS. */
export function isScopedEntityKey(key: string): key is ScopedEntityKey {
  return (SCOPED_KEYS as readonly string[]).includes(key);
}

/** View AppData’s scoped tables through their common ScopedEntity shape.
 * Returns the same object and arrays; mutating the view also mutates data. Copy before changes that must preserve the input. */
export function scopedTables(data: AppData): Record<ScopedEntityKey, ScopedEntity[]> {
  return data;
}

/** Clamp an allocation's hours/day into [0, MAX_HOURS_PER_DAY]; a non-finite value → 0. The
 * one rule shared by the store write boundary (every allocation write) and the import
 * sanitiser, so the two can never drift. 0 is legal (a 'blocks' booking carries 0 load);
 * a day can't exceed 24h. */
export function clampHoursPerDay(hours: number): number {
  return Number.isFinite(hours) ? Math.max(0, Math.min(hours, MAX_HOURS_PER_DAY)) : 0;
}

/** Clamp a resource's working hours/day to (0, MAX_HOURS_PER_DAY]. Unlike an allocation, a
 * resource must work a positive number of hours (0 capacity = no working day at all, same
 * reason the store rejects an empty working-week), so junk / <= 0 falls back to a normal 8h
 * day; a finite positive value just clamps to the 24h ceiling. Shared by the import sanitiser
 * and the store resource write path so the two stay in lockstep. */
export function clampWorkingHoursPerDay(hours: number): number {
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, MAX_HOURS_PER_DAY) : FULL_DAY_HOURS;
}

/** True for external resources, which are excluded from capacity and utilisation. */
export function isExternalResource(resource: { kind: ResourceKind }): boolean {
  return resource.kind === "external";
}

/** Inverse of {@link isExternalResource}, true when a resource participates in capacity/utilisation. */
export function isCapacityTracked(resource: { kind: ResourceKind }): boolean {
  return !isExternalResource(resource);
}

/** True when a resource persists its own working-week pattern. Placeholders derive their live week
 * from the company calendar, while externals have no capacity at all. */
export function hasPersonalWorkingPattern(resource: { kind: ResourceKind }): boolean {
  return resource.kind === "person";
}

/** The single kind check for placeholder-specific persistence and import rules. */
export function isPlaceholderResource(resource: { kind: ResourceKind }): boolean {
  return resource.kind === "placeholder";
}

// Return fresh weekday arrays so callers cannot mutate another resource’s defaults.
function buildDefaultCapacityWorkingPattern(): Pick<Resource, "workingDays" | "halfDays"> {
  return {
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
  };
}

/** The unused silent-default capacity fields every `external` resource is created with: externals
 * have no capacity, but the Resource type + store still require a positive working day and a
 * non-empty week. A factory (not a shared object) so each call gets its own weekday arrays. No
 * aliasing if a consumer mutates one. One source for the External form, seed, and fixtures. */
export function externalCapacityDefaults(): Pick<
  Resource,
  "employmentType" | "engagement" | "workingHoursPerDay" | "workingDays" | "halfDays"
> {
  return {
    employmentType: "permanent",
    engagement: "studio" as const,
    workingHoursPerDay: FULL_DAY_HOURS,
    ...buildDefaultCapacityWorkingPattern(),
  };
}

/** The account-independent silent defaults for placeholder capacity fields. Placeholders derive
 * their live working week from the company calendar, so these persisted fields are deliberately
 * inert and must never copy an account's current selection. A factory gives every caller fresh
 * arrays, avoiding aliases if a consumer mutates one. */
export function placeholderCapacityDefaults(): Pick<Resource, "workingDays" | "halfDays"> {
  return buildDefaultCapacityWorkingPattern();
}

/** A fresh, empty dataset, the starting point before seeding. */
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

/** True when every portable AppData table is empty. */
export function isEmpty(data: AppData): boolean {
  return APP_DATA_KEYS.every((key) => data[key].length === 0);
}
