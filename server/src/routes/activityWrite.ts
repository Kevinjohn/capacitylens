import { allocationAttributionAllowed } from "@capacitylens/shared/lib/integrity";
import { clearAllocationAttributionForActivities, upsertRow } from "../db";
import type { Db, RewrittenAllocationRevision } from "../db";
import type { BatchStateProjection } from "../BatchStateProjection";

/** Inputs for direct or projected activity persistence and attribution reconciliation. */
export interface WriteActivityRowInput {
  db: Db;
  projection: BatchStateProjection | undefined;
  row: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
}

/** Writes an activity and reconciles any allocation attribution changes. */
export function writeActivityRow({
  db,
  projection,
  row,
  existing,
}: WriteActivityRowInput): RewrittenAllocationRevision[] {
  upsertRow(db, "activities", row);
  projection?.upsert("activities", row);
  const id = row.id as string;
  if (projection) {
    projection.reconcileAllocationAttributionForActivity({
      activityId: id,
      attributionAllowed: allocationAttributionAllowed(row.kind),
    });
    return [];
  }
  // New activities cannot have existing allocations; direct updates reconcile storage immediately.
  if (!existing || allocationAttributionAllowed(row.kind)) return [];
  return clearAllocationAttributionForActivities(db, new Set([id]));
}

/** Adds server-owned allocation revisions to activity write echoes for client reconciliation. */
export function shapeActivityWriteEcho(
  entity: string,
  echo: Record<string, unknown>,
  rewrittenAllocations: RewrittenAllocationRevision[],
): Record<string, unknown> {
  return entity === "activities" ? { ...echo, rewrittenAllocations } : echo;
}
