import { withoutAllocationAttribution } from "@capacitylens/shared/lib/integrity";
import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { type Op } from "../syncOps";

export interface CommittedRevision {
  table: Op["table"];
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The server changed allocation content as well as its revision stamp. */
  rewrite?: true;
}

/** One durable client-stamp → server-revision translation; see canonicalizeAcknowledged. */
export interface AcknowledgedRevision {
  client: string;
  server: CommittedRevision;
}

export interface BatchCommitReceipt {
  revisions: CommittedRevision[];
  archivedLifecycleKeys: Set<string>;
  superseded: boolean;
}

export const MAX_DIAGNOSTIC_BODY_LENGTH = 1_000;
const compatibilityWarnings = new Set<string>();

// The one composite key every row-identity Map/Set in this module is keyed by. NUL is the separator
// because neither a table name nor an entity id can contain it, so the two halves always round-trip.
export const rowKey = (table: string, id: string): string => `${table}\0${id}`;

/** Split a {@link rowKey} back into its `[table, id]` halves. */
export function rowKeyParts(key: string): [table: string, id: string] {
  const separator = key.indexOf("\0");
  return [key.slice(0, separator), key.slice(separator + 1)];
}

export function warnCompatibilityOnce(key: string, message: string): void {
  if (compatibilityWarnings.has(key)) return;
  compatibilityWarnings.add(key);
  console.warn(message);
}

export function safeResponseError(action: string, status: number, rawBody: string): Error {
  const message = `${action} failed (${status}).`;
  if (!rawBody) return new Error(message);
  const diagnostic = rawBody.slice(0, MAX_DIAGNOSTIC_BODY_LENGTH);
  return new Error(message, { cause: new Error(diagnostic) });
}

/**
 * Write rows into a copy of `data`. An ABSENT id is always appended; `replaceExisting` decides what
 * a PRESENT id means, and the difference is load-bearing:
 *   - `true` (replace-or-append) makes an authoritative receipt win over whatever the snapshot held
 *     — the unarchive path, where a normal archive already advanced `lastSynced` past the row but a
 *     teardown archive deliberately did not, so both shapes must land on the receipt's copy;
 *   - `false` (APPEND-IF-ABSENT, NEVER OVERWRITE) re-inserts a row the snapshot is missing without
 *     ever clobbering a copy that is already there — the absence check is a defensive no-dup guard,
 *     not an update.
 */
export function writeRows(
  data: AppData,
  rows: Array<{ table: Op["table"]; row: Entity }>,
  opts: { replaceExisting: boolean },
): AppData {
  if (rows.length === 0) return data;
  const next = { ...data };
  for (const { table, row } of rows) {
    const list = next[table] as Entity[];
    const exists = list.some((existing) => existing.id === row.id);
    if (!exists) next[table] = [...list, row] as never;
    else if (opts.replaceExisting)
      next[table] = list.map((existing) => (existing.id === row.id ? row : existing)) as never;
  }
  return next;
}

export function applyCommittedRevision(row: Entity, revision: CommittedRevision): Entity {
  const revised = {
    ...row,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
  };
  return revision.table === "allocations" && revision.rewrite === true
    ? withoutAllocationAttribution(revised)
    : revised;
}

export function applyCommittedRevisions(data: AppData, revisions: CommittedRevision[]): AppData {
  if (revisions.length === 0) return data;
  const byTable = new Map<keyof AppData, Map<string, CommittedRevision>>();
  for (const revision of revisions) {
    const rows = byTable.get(revision.table) ?? new Map<string, CommittedRevision>();
    rows.set(revision.id, revision);
    byTable.set(revision.table, rows);
  }
  const next = { ...data };
  for (const [table, revisionsById] of byTable) {
    next[table] = data[table].map((row) => {
      const revision = revisionsById.get(row.id);
      return revision ? applyCommittedRevision(row, revision) : row;
    }) as never;
  }
  return next;
}

/** Compare the persisted content of two rows while ignoring server-owned revision stamps. */
export function sameEntityContent(left: Entity, right: Entity): boolean {
  const content = (row: Entity) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );
  return JSON.stringify(content(left)) === JSON.stringify(content(right));
}
