import type { AppData, AppDataKey, ScopedEntityKey } from "../../types/entities";
import { lifecycleStatus, type LifecycleFields } from "./types";
import { PARENT_TABLES, inspectAncestry } from "./ancestry";
import type { LifecycleAncestryRow, LifecycleAncestryLookup, LifecycleAncestryMemo } from "./ancestry";

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
// same idiom as the completeness assertions in ../../types/entities.ts).
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
