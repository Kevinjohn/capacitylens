import type { AppData, AppDataKey, ScopedEntityKey } from "../../types/entities.js";
import { lifecycleStatus } from "./types.js";
import type { LifecycleFields } from "./types.js";
import { PARENT_TABLES, inspectAncestry } from "./ancestry.js";
import type { LifecycleAncestryRow, LifecycleAncestryLookup, LifecycleAncestryMemo } from "./ancestry.js";

// Require projection coverage for every scoped table except disciplines and closures, which have no lifecycle edges.
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
// same idiom as the completeness assertions in ../../types/entities.ts).
void PROJECTED_LIFECYCLE_KEYS;
void projectedKeysAreComplete;

/** Project an already account-scoped AppData slice to active lifecycle rows and visible descendants.
 * Pure; returns a new object without changing the input. Filtered tables receive new arrays; retained rows and unchanged tables share references.
 * Unresolved references remain visible so integrity damage can be diagnosed.
 * Use only for read/view projection. Persistence, mutations, integrity checks, imports, migration and exports require the complete dataset. */
export function activeOnly(data: AppData): AppData {
  const isActive = (entity: LifecycleFields) => lifecycleStatus(entity) === "active";
  const indexes = Object.fromEntries(
    PARENT_TABLES.map((table) => [
      table,
      new Map((data[table] as unknown as LifecycleAncestryRow[]).map((row) => [row.id, row])),
    ]),
  ) as Partial<Record<AppDataKey, Map<string, LifecycleAncestryRow>>>;
  // Only PARENT_TABLES are indexed, and the walk only ever looks a parent up, an unindexed table
  // reads as an unresolvable reference, which the walk already retains rather than hides.
  const lookup: LifecycleAncestryLookup = (table, id) => indexes[table]?.get(id);
  const memo: LifecycleAncestryMemo = new Map();
  const hasVisibleAncestry = (table: AppDataKey, row: object): boolean =>
    inspectAncestry({ table, row: row as LifecycleAncestryRow, lookup, memo }).kind === "visible";
  const resources = data.resources.filter(isActive);
  const clients = data.clients.filter(isActive);
  // An active child of an archived or deleted parent stays stored but is hidden from the app.
  const projects = data.projects.filter((project) => isActive(project) && hasVisibleAncestry("projects", project));
  const phases = data.phases.filter((phase) => hasVisibleAncestry("phases", phase));
  const activities = data.activities.filter(
    (activity) => isActive(activity) && hasVisibleAncestry("activities", activity),
  );
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
