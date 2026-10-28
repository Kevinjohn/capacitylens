import type { Role } from "../../account/types.js";
import type { AppData, AppDataKey } from "../../types/entities.js";
import { redactPrivateName } from "../privateNames.js";
import { inspectLifecycleAncestry } from "./ancestry.js";
import type { LifecycleAncestryRow } from "./ancestry.js";
import { LIFECYCLE_ENTITY_KEYS, lifecycleStatus } from "./types.js";

/** The identity of the first archived ancestor preventing visibility. */
export type ArchivedParent = { entity: "clients" | "projects"; id: string; label: string };
/** Identity-only archive discovery; deliberately excludes inactive entity details. */
export type ArchiveRecoveryRow = {
  id: string;
  label: string;
  archived: boolean;
  parent: ArchivedParent | null;
} & (
  | { entity: "resources"; group: "studio" | "supplementary" | "external" | "placeholders" }
  | { entity: "clients" | "projects" | "activities" }
);
/** A company-scoped list of recoverable identities. */
export type ArchiveRecovery = { accountId: string; rows: ArchiveRecoveryRow[] };

/** Project recoverable identities without exposing inactive details or deleted ancestry. */
export function archiveRecovery(data: AppData, accountId: string, role: Role): ArchiveRecovery {
  const indexes = new Map<AppDataKey, Map<string, LifecycleAncestryRow>>();
  for (const table of ["resources", "clients", "projects", "activities", "phases"] as const)
    indexes.set(
      table,
      new Map(
        data[table]
          .filter((row) => row.accountId === accountId)
          .map((row) => [row.id, row as unknown as LifecycleAncestryRow]),
      ),
    );
  const lookup = (table: AppDataKey, id: string) => indexes.get(table)?.get(id);
  // Ignoring archive timestamps makes a deleted grandparent visible to the same domain walk.
  const deletedLookup = (table: AppDataKey, id: string) => {
    const row = lookup(table, id);
    return row ? { ...row, archivedAt: null } : undefined;
  };
  const label = (table: AppDataKey, row: LifecycleAncestryRow): string => {
    if ((table === "clients" || table === "projects") && role !== "owner")
      return redactPrivateName(row as unknown as AppData["clients"][number]).name;
    return typeof row.name === "string" && row.name ? row.name : typeof row.role === "string" ? row.role : "";
  };
  const rows: ArchiveRecoveryRow[] = [];
  for (const entity of LIFECYCLE_ENTITY_KEYS) {
    for (const row of indexes.get(entity)?.values() ?? []) {
      const state = lifecycleStatus(row);
      if (state === "deleted" || (entity === "clients" && row.builtin === true)) continue;
      if (inspectLifecycleAncestry(entity, row, deletedLookup).kind === "hidden") continue;
      const ancestry = inspectLifecycleAncestry(entity, row, lookup);
      if (state !== "archived" && ancestry.kind === "visible") continue;
      let parent: ArchivedParent | null = null;
      if (ancestry.kind === "hidden") {
        const ancestor = ancestry.inactiveAncestor;
        if (ancestor.table === "clients" || ancestor.table === "projects") {
          const source = lookup(ancestor.table, ancestor.id);
          if (source) parent = { entity: ancestor.table, id: ancestor.id, label: label(ancestor.table, source) };
        }
      }
      const identity = { id: row.id, label: label(entity, row), archived: state === "archived", parent };
      if (entity === "resources") {
        const group =
          row.kind === "placeholder"
            ? "placeholders"
            : row.kind === "external"
              ? "external"
              : row.engagement === "supplementary"
                ? "supplementary"
                : "studio";
        rows.push({ ...identity, entity, group });
      } else rows.push({ ...identity, entity });
    }
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return { accountId, rows };
}
