import type { AppDataKey } from "../../types/entities";
import { isLifecycleEntityKey, lifecycleStatus } from "./types";
import type { LifecycleFields, LifecycleEntityKey, LifecycleState } from "./types";

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
export const PARENT_TABLES: readonly AppDataKey[] = [...new Set(LIFECYCLE_ANCESTRY.map((relation) => relation.parent))];

/** Per-projection cache of a walk's verdict, keyed `${table}|${id}`. Sound because the child-vs-parent
 *  accountId equality check happens at the EDGE, before recursion: a parent's own verdict is a pure
 *  function of (table, id, data) — it never depends on which child reached it. Rows are resolved
 *  through the id-keyed index, so one key can only ever mean one row. */
export type LifecycleAncestryMemo = Map<string, LifecycleAncestryResult>;

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

export function inspectAncestry(
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
