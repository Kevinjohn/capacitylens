import { FROZEN_REPLY_MESSAGES } from "@capacitylens/shared/api/replyMessages";
import { isLifecycleEntityKey, LIFECYCLE_ENTITY_KEYS } from "@capacitylens/shared/domain/lifecycle";
import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { noteAuditWarning } from "@/lib/auditWarning";
import { API_REQUEST_TIMEOUT_MS } from "@/data/requestTimeout";
import type { Op } from "@/data/syncOps";
import { LifecycleRestoreError } from "./batchErrors";
import {
  MAX_DIAGNOSTIC_BODY_LENGTH,
  buildRowKey,
  createSafeResponseError,
  hasSameEntityContent,
  writeRows,
} from "./revisions";
import type { CommittedRevision } from "./revisions";
import { rememberRevisions } from "./snapshot";
import type { SyncState } from "./SyncState";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

// Lifecycle disappearances must archive through dedicated routes because ordinary
// batch deletion would bypass retained tombstones.
/** Partitions operations into ordinary batch writes and lifecycle disappearances that must archive separately. */
export function splitLifecycleDeletes(ops: Op[]): {
  batchOps: Op[];
  lifecycleDeletes: Op[];
} {
  const batchOps: Op[] = [];
  const lifecycleDeletes: Op[] = [];
  for (const op of ops) {
    if (op.method === "DELETE" && isLifecycleEntityKey(op.table)) lifecycleDeletes.push(op);
    else batchOps.push(op);
  }
  return { batchOps, lifecycleDeletes };
}

/** Builds a stable lifecycle identity from table and row ID; neither may contain a NUL separator. */
export function buildLifecycleKey(op: Pick<Op, "table" | "id">): string {
  return buildRowKey(op.table, op.id);
}

/** Detects a PUT whose row this sync session archived, so it must restore before descendant writes. */
export function isRememberedLifecycleReappearance(state: SyncState, op: Op): boolean {
  return op.method === "PUT" && isLifecycleEntityKey(op.table) && state.archivedBySync.has(buildLifecycleKey(op));
}

/** Returns parent-first restore operations for rows remembered as archived that reappear in the target. */
export function listRememberedLifecycleRestoreOps(state: SyncState, target: AppData): Op[] {
  // Nothing was ever archived by this session, so no reappearance can need reversing, skip the
  // whole-lifecycle-table scan (the common case on every save).
  if (state.archivedBySync.size === 0) return [];
  const ops: Op[] = [];
  for (const table of LIFECYCLE_ENTITY_KEYS) {
    for (const row of target[table]) {
      if (state.archivedBySync.has(buildLifecycleKey({ table, id: row.id }))) {
        ops.push({ method: "PUT", table, id: row.id, row, accountId: row.accountId });
      }
    }
  }
  return ops;
}

/** Updates remembered lifecycle archives from the server-confirmed keys for the supplied operations. */
export function rememberLifecycleArchives(state: SyncState, ops: Op[], confirmed: ReadonlySet<string>): void {
  for (const op of ops) {
    const key = buildLifecycleKey(op);
    if (confirmed.has(key)) state.archivedBySync.add(key);
    else state.archivedBySync.delete(key);
  }
}

/** Restore sync-archived rows before reapplying a redone snapshot. `ops` already follows the
 * parent-before-child write order, so a client becomes active before one of its projects. */
export async function restoreRememberedLifecycleRows(
  state: SyncState,
  ops: Op[],
  expectedSeedGen: number,
): Promise<boolean> {
  let restored = false;
  for (const op of ops) {
    if (!isRememberedLifecycleReappearance(state, op) || !op.row) continue;

    const row = await unarchiveLifecycleRow(state, op);
    // A tenant reload may have replaced the adapter snapshot while the transition was in flight.
    // The server-side restore is safe, but its row must never be inserted into that newer slice.
    if (expectedSeedGen !== state.seedGen) return restored;
    const revision: CommittedRevision = {
      table: op.table,
      id: op.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    // A normal archive advanced lastSynced past the row, while a teardown archive deliberately
    // did not. Replace-or-append handles both and makes the unarchive receipt authoritative.
    state.lastSynced = writeRows(state.lastSynced, [{ table: op.table, row }], { replaceExisting: true });
    const key = buildLifecycleKey(op);
    state.acknowledgedRevisions.delete(key);
    if (hasSameEntityContent(op.row, row))
      rememberRevisions({ state: state, ops: [op], revisions: [revision], committedSnapshot: state.lastSynced });
    state.archivedBySync.delete(buildLifecycleKey(op));
    restored = true;
  }
  return restored;
}

/** Restores a lifecycle row and returns its authoritative active receipt.
 * @throws LifecycleRestoreError when the server refuses or cannot prove the restored row; reload before replaying writes.
 */
export async function unarchiveLifecycleRow(state: SyncState, op: Op): Promise<Entity> {
  const rowAccountId = isRecord(op.row) && typeof op.row.accountId === "string" ? op.row.accountId : undefined;
  const res = await state.request(`${state.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/unarchive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: op.accountId ?? rowAccountId,
    }),
    credentials: "include",
  });
  // This route bypasses apiFetch, so surface audit degradation explicitly. Background
  // sync has no competing success notice, allowing synchronous announcement.
  noteAuditWarning(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new LifecycleRestoreError(`Lifecycle restore of ${op.table}/${op.id} failed (${res.status}).`, {
      cause: detail ? new Error(detail.slice(0, MAX_DIAGNOSTIC_BODY_LENGTH)) : undefined,
    });
  }
  const body: unknown = await res.json().catch(() => null);
  if (
    !isRecord(body) ||
    body.id !== op.id ||
    typeof body.createdAt !== "string" ||
    typeof body.updatedAt !== "string" ||
    body.archivedAt != null ||
    body.deletedAt != null
  ) {
    // The transition may already have committed. Force an authoritative reload rather than
    // guessing its revision and issuing a stale generic write.
    throw new LifecycleRestoreError(`Lifecycle restore of ${op.table}/${op.id} returned an invalid receipt.`);
  }
  // The checks above prove the three Entity members; the rest of the row is server-shaped payload
  // this adapter deliberately passes through untouched, so widen through `unknown`.
  return body as unknown as Entity;
}

/** Reversibly archives a sync-originated disappearance. Successful responses confirm archival; among failures, only already_inactive conflicts and the API row-absence envelope prove convergence. Other failures reject for the caller to surface. Remember confirmed archives so redo restores parents before descendant writes. */
export async function archiveLifecycleRow(
  state: SyncState,
  op: Op,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const requestOptions: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: op.accountId }),
    credentials: "include",
    ...(options.keepalive ? { keepalive: true } : {}),
  };
  const res = await state.request(
    `${state.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/archive`,
    requestOptions,
    options.keepalive ? null : API_REQUEST_TIMEOUT_MS,
  );
  // This route bypasses apiFetch, so it must surface audit degradation explicitly.
  noteAuditWarning(res);
  // Read the body once for diagnostics and envelope validation. An unreadable envelope
  // cannot prove archival converged, so the response remains a surfaced failure.
  const detail = res.ok ? "" : await res.text().catch(() => "");
  let envelope: Record<string, unknown> | null;
  try {
    const parsed: unknown = detail ? JSON.parse(detail) : null;
    envelope = isRecord(parsed) ? parsed : null;
  } catch {
    // An unreadable envelope cannot prove convergence and remains a surfaced failure.
    envelope = null;
  }
  recordArchiveResponse({ state, op, res, detail, envelope });
}

interface ApplyArchiveResponseInput {
  state: SyncState;
  op: Op;
  res: Response;
  detail: string;
  envelope: Record<string, unknown> | null;
}

function recordArchiveResponse({ state, op, res, detail, envelope }: ApplyArchiveResponseInput): void {
  if (res.status === 409 && envelope?.code === "already_inactive") {
    state.archivedBySync.add(buildLifecycleKey(op));
    return;
  }
  if (res.status === 404 && envelope?.error === FROZEN_REPLY_MESSAGES.notFound) {
    state.archivedBySync.delete(buildLifecycleKey(op));
    return;
  }
  if (res.status === 409 && typeof envelope?.error === "string") {
    throw new Error(`Lifecycle archive of ${op.table}/${op.id} failed (${res.status}): ${envelope.error}`);
  }
  if (!res.ok) {
    throw createSafeResponseError(`Lifecycle archive of ${op.table}/${op.id}`, res.status, detail);
  }
  state.archivedBySync.add(buildLifecycleKey(op));
}
