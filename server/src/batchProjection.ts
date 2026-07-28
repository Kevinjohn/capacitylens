import {
  APP_DATA_KEYS,
  SCOPED_KEYS,
  type Allocation,
  type AppData,
  type AppDataKey,
} from "@capacitylens/shared/types/entities";
import type { ValidationDataLookup } from "@capacitylens/shared/domain/mutations";

type ProjectionRow = Record<string, unknown> & { id: string };
type DeleteAction = "cascade" | "set-null";

interface Relationship {
  parent: AppDataKey;
  child: AppDataKey;
  field: string;
  onDelete: DeleteAction;
}

interface RelationshipIndex {
  relationship: Relationship;
  childrenByParent: Map<string, Set<string>>;
}

// Mirrors every AppData foreign key in server/src/tables.ts. Keeping accountId edges here makes an
// account delete proportional to that account's rows; the more specific edges preserve CASCADE and
// SET NULL behavior for same-batch validation after a parent delete.
const RELATIONSHIPS: Relationship[] = [
  ...SCOPED_KEYS.map((child) => ({
    parent: "accounts" as const,
    child,
    field: "accountId",
    onDelete: "cascade" as const,
  })),
  { parent: "clients", child: "projects", field: "clientId", onDelete: "cascade" },
  { parent: "projects", child: "phases", field: "projectId", onDelete: "cascade" },
  { parent: "projects", child: "activities", field: "projectId", onDelete: "cascade" },
  { parent: "projects", child: "resources", field: "projectId", onDelete: "set-null" },
  { parent: "phases", child: "activities", field: "phaseId", onDelete: "set-null" },
  { parent: "disciplines", child: "resources", field: "disciplineId", onDelete: "set-null" },
  { parent: "resources", child: "allocations", field: "resourceId", onDelete: "cascade" },
  { parent: "resources", child: "timeOff", field: "resourceId", onDelete: "cascade" },
  { parent: "activities", child: "allocations", field: "activityId", onDelete: "cascade" },
];

const rowsFor = (data: AppData, table: AppDataKey): ProjectionRow[] => data[table] as unknown as ProjectionRow[];

/**
 * Mutable, transaction-local AppData projection for POST /api/batch.
 *
 * AppData arrays remain available to the existing domain validators, while id and reverse-FK
 * indexes make projection upserts, row deletes and cascades proportional to affected rows instead
 * of rebuilding whole arrays after every operation. Row order is intentionally not preserved: the
 * projection is never serialized, and validation treats every table as an unordered entity set.
 */
export class BatchStateProjection implements ValidationDataLookup {
  readonly data: AppData;
  private readonly rowIndexes: Record<AppDataKey, Map<string, number>>;
  private readonly relationshipIndexes: RelationshipIndex[];

  constructor(data: AppData) {
    this.data = data;
    this.rowIndexes = Object.fromEntries(
      APP_DATA_KEYS.map((table) => [
        table,
        new Map(rowsFor(data, table).map((row, index) => [row.id, index] as const)),
      ]),
    ) as Record<AppDataKey, Map<string, number>>;
    this.relationshipIndexes = RELATIONSHIPS.map((relationship) => ({
      relationship,
      childrenByParent: new Map(),
    }));
    for (const relationshipIndex of this.relationshipIndexes) {
      for (const row of rowsFor(data, relationshipIndex.relationship.child)) {
        this.addRelationship(relationshipIndex, row);
      }
    }
  }

  upsert(table: AppDataKey, row: Record<string, unknown>): void {
    if (typeof row.id !== "string") throw new Error("Batch projection rows require a string id.");
    const next = row as ProjectionRow;
    const rows = rowsFor(this.data, table);
    const index = this.rowIndexes[table].get(next.id);
    if (index === undefined) {
      this.rowIndexes[table].set(next.id, rows.length);
      rows.push(next);
    } else {
      this.removeChildRelationships(table, rows[index]);
      rows[index] = next;
    }
    this.addChildRelationships(table, next);
  }

  delete(table: AppDataKey, id: string): void {
    if (!this.rowIndexes[table].has(id)) return;

    for (const relationshipIndex of this.relationshipIndexes) {
      const { relationship, childrenByParent } = relationshipIndex;
      if (relationship.parent !== table) continue;
      const childIds = [...(childrenByParent.get(id) ?? [])];
      for (const childId of childIds) {
        if (relationship.onDelete === "cascade") {
          this.delete(relationship.child, childId);
        } else {
          this.clearReference(relationship.child, childId, relationship.field);
        }
      }
    }

    this.removeRow(table, id);
  }

  /** Mirror replaceGeneratedBuiltin's reparent-before-delete database sequence. */
  replaceGeneratedBuiltin(generatedId: string, row: Record<string, unknown>): void {
    if (typeof row.id !== "string") throw new Error("Batch projection rows require a string id.");
    const projectRelationship = this.relationshipIndexes.find(
      ({ relationship }) =>
        relationship.parent === "clients" && relationship.child === "projects" && relationship.field === "clientId",
    );
    const projectIds = [...(projectRelationship?.childrenByParent.get(generatedId) ?? [])];
    for (const projectId of projectIds) {
      const project = this.row("projects", projectId);
      if (project) this.upsert("projects", { ...project, clientId: row.id });
    }
    this.delete("clients", generatedId);
    this.upsert("clients", row);
  }

  row(table: AppDataKey, id: string): ProjectionRow | undefined {
    const index = this.rowIndexes[table].get(id);
    return index === undefined ? undefined : rowsFor(this.data, table)[index];
  }

  resourceHasLoadedAllocation(accountId: string, resourceId: string): boolean {
    return this.allocationsForResource(accountId, resourceId).some((row) => row.hoursPerDay !== 0);
  }

  resourceHasTimeOff(accountId: string, resourceId: string): boolean {
    return this.relatedRows("resources", "timeOff", "resourceId", resourceId).some(
      (row) => row.accountId === accountId,
    );
  }

  allocationsForResource(accountId: string, resourceId: string): readonly Allocation[] {
    return this.relatedRows("resources", "allocations", "resourceId", resourceId).filter(
      (row) => row.accountId === accountId,
    ) as unknown as Allocation[];
  }

  allocationsForActivity(accountId: string, activityId: string): readonly Allocation[] {
    return this.relatedRows("activities", "allocations", "activityId", activityId).filter(
      (row) => row.accountId === accountId,
    ) as unknown as Allocation[];
  }

  private relatedRows(parent: AppDataKey, child: AppDataKey, field: string, parentId: string): ProjectionRow[] {
    const relationship = this.relationshipIndexes.find(
      ({ relationship }) =>
        relationship.parent === parent && relationship.child === child && relationship.field === field,
    );
    if (!relationship) return [];
    return [...(relationship.childrenByParent.get(parentId) ?? [])].flatMap((id) => {
      const row = this.row(child, id);
      return row ? [row] : [];
    });
  }

  private clearReference(table: AppDataKey, id: string, field: string): void {
    const existing = this.row(table, id);
    if (!existing) return;
    const updated = { ...existing };
    delete updated[field];
    this.upsert(table, updated);
  }

  private removeRow(table: AppDataKey, id: string): void {
    const indexes = this.rowIndexes[table];
    const index = indexes.get(id);
    if (index === undefined) return;
    const rows = rowsFor(this.data, table);
    const removed = rows[index];
    this.removeChildRelationships(table, removed);
    const last = rows.pop()!;
    indexes.delete(id);
    if (index < rows.length) {
      rows[index] = last;
      indexes.set(last.id, index);
    }
  }

  private addChildRelationships(table: AppDataKey, row: ProjectionRow): void {
    for (const relationshipIndex of this.relationshipIndexes) {
      if (relationshipIndex.relationship.child === table) {
        this.addRelationship(relationshipIndex, row);
      }
    }
  }

  private removeChildRelationships(table: AppDataKey, row: ProjectionRow): void {
    for (const relationshipIndex of this.relationshipIndexes) {
      const { relationship, childrenByParent } = relationshipIndex;
      if (relationship.child !== table) continue;
      const parentId = row[relationship.field];
      if (typeof parentId !== "string") continue;
      const childIds = childrenByParent.get(parentId);
      childIds?.delete(row.id);
      if (childIds?.size === 0) childrenByParent.delete(parentId);
    }
  }

  private addRelationship(relationshipIndex: RelationshipIndex, row: ProjectionRow): void {
    const parentId = row[relationshipIndex.relationship.field];
    if (typeof parentId !== "string") return;
    let childIds = relationshipIndex.childrenByParent.get(parentId);
    if (!childIds) {
      childIds = new Set();
      relationshipIndex.childrenByParent.set(parentId, childIds);
    }
    childIds.add(row.id);
  }
}
