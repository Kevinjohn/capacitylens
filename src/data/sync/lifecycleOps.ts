import { isLifecycleEntityKey, LIFECYCLE_ENTITY_KEYS } from "@capacitylens/shared/domain/lifecycle";
import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { noteAuditWarning } from "../../lib/auditWarning";
import { API_REQUEST_TIMEOUT_MS } from "../requestTimeout";
import { type Op } from "../syncOps";
import { isRecord } from "../validateAccountSlice";
import { LifecycleRestoreError } from "./batchErrors";
import {
  MAX_DIAGNOSTIC_BODY_LENGTH,
  rowKey,
  safeResponseError,
  sameEntityContent,
  writeRows,
  type CommittedRevision,
} from "./revisions";
import { rememberRevisions } from "./snapshot";
import type { SyncState } from "./state";

// The server 400-REJECTS a batch DELETE of a lifecycle entity (clients/projects/resources) — those
// deletions must converge through the dedicated archive route instead (see archiveLifecycleRow).
// Partition an op set into the atomic-batch ops and the lifecycle deletes the caller drives
// out-of-band by archiving (see drain/flushUnload).
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

export function lifecycleKey(op: Pick<Op, "table" | "id">): string {
  return rowKey(op.table, op.id);
}

export function isRememberedLifecycleReappearance(state: SyncState, op: Op): boolean {
  return op.method === "PUT" && isLifecycleEntityKey(op.table) && state.archivedBySync.has(lifecycleKey(op));
}

export function rememberedLifecycleRestoreOps(state: SyncState, target: AppData): Op[] {
  // Nothing was ever archived by this session, so no reappearance can need reversing — skip the
  // whole-lifecycle-table scan (the common case on every save).
  if (state.archivedBySync.size === 0) return [];
  const ops: Op[] = [];
  for (const table of LIFECYCLE_ENTITY_KEYS) {
    for (const row of target[table]) {
      if (state.archivedBySync.has(lifecycleKey({ table, id: row.id }))) {
        ops.push({ method: "PUT", table, id: row.id, row, accountId: row.accountId });
      }
    }
  }
  return ops;
}

export function rememberLifecycleArchives(state: SyncState, ops: Op[], confirmed: ReadonlySet<string>): void {
  for (const op of ops) {
    const key = lifecycleKey(op);
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
    const key = lifecycleKey(op);
    state.acknowledgedRevisions.delete(key);
    if (sameEntityContent(op.row, row)) rememberRevisions(state, [op], [revision], state.lastSynced);
    state.archivedBySync.delete(lifecycleKey(op));
    restored = true;
  }
  return restored;
}

export async function unarchiveLifecycleRow(state: SyncState, op: Op): Promise<Entity> {
  const res = await state.request(`${state.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/unarchive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: op.accountId ?? (op.row as { accountId?: unknown })?.accountId,
    }),
    credentials: "include",
  });
  // Unarchive is a destructive-write reversal and goes through `state.request` (raw fetchImpl), not
  // apiFetch, so it must check the audit-degradation header itself — mirroring the batch path below.
  // Announced SYNCHRONOUSLY (no `defer`): background sync raises no competing success notice, and
  // the caller may throw on the very next line.
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
    body.archivedAt !== undefined ||
    body.deletedAt !== undefined
  ) {
    // The transition may already have committed. Force an authoritative reload rather than
    // guessing its revision and issuing a stale generic write.
    throw new LifecycleRestoreError(`Lifecycle restore of ${op.table}/${op.id} returned an invalid receipt.`);
  }
  // The checks above prove the three Entity members; the rest of the row is server-shaped payload
  // this adapter deliberately passes through untouched, so widen through `unknown`.
  return body as unknown as Entity;
}

// Converge a sync-originated lifecycle-entity disappearance (clients/projects/resources) by ARCHIVING
// the row through the dedicated POST /api/{table}/{id}/archive route. It cannot ride the atomic batch
// (POST /api/batch 400-rejects a lifecycle DELETE op, to keep the retained-tombstone data-lifecycle
// from being bypassed).
//
// POLICY — ARCHIVE-ONLY from the sync layer (deliberately NOT soft-delete): a lifecycle DELETE that
// originates from ordinary syncing (e.g. undo of a just-synced create) parks the row as ARCHIVED on
// the server. Archive is action 'write' — allowed to every role that can create the row (editor+) and
// NEVER freshness-gated — so background sync, which has no re-auth/step-up UI, can always complete it.
// It is also REVERSIBLE (unarchive restores the row). Soft-delete and purge are deliberately NOT
// emitted by sync: soft-delete is IRREVERSIBLE (for resources it destroys PII via obfuscateResource,
// and there is no tombstone→active restore path in shared/src/domain/lifecycle.ts), admin-gated AND
// freshness/step-up gated — it stays a deliberate UI action only. A successful archive is remembered
// for this in-memory history session so redo can route the id through unarchive before any generic
// writes. The row otherwise lingers in the account's ARCHIVED list; the local view already hides it.
//
// Idempotent/convergent status handling: only a 409 explicitly coded `already_inactive` (a retry
// after a partial success or a concurrent archive) and a 404 (row already gone from this account)
// are the intended out-of-active end state. Other 409 conflicts, including protected rows, remain
// surfaced failures. A THROWN fetch (network/abort) also propagates so the save retries when healthy.
export async function archiveLifecycleRow(state: SyncState, op: Op, opts: { keepalive?: boolean } = {}): Promise<void> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: op.accountId }),
    credentials: "include",
    ...(opts.keepalive ? { keepalive: true } : {}),
  };
  const res = await state.request(
    `${state.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/archive`,
    init,
    opts.keepalive ? null : API_REQUEST_TIMEOUT_MS,
  );
  // Same gap as unarchiveLifecycleRow above: this dedicated route bypasses apiFetch, so the
  // audit-degradation header on this destructive write would otherwise be silently dropped.
  // Announced SYNCHRONOUSLY (no `defer`) for the same reason as unarchive.
  noteAuditWarning(res);
  // A response body can only be read ONCE, and every failure arm below wants the same two views of
  // it: the raw text (safeResponseError attaches it as the diagnostic cause) and its best-effort
  // JSON envelope. Read and parse each exactly once, here, before branching on status.
  //
  // The parse is deliberately allowed to fail without surfacing: an unreadable CONFLICT body cannot
  // prove convergence and is surfaced by the throw below; and since a proxy or missing route can
  // also return 404, only the API's exact row-absence envelope proves the lifecycle intent has
  // converged — anything else likewise falls through to a throw.
  const detail = res.ok ? "" : await res.text().catch(() => "");
  let envelope: { code?: unknown; error?: unknown } | null;
  try {
    envelope = detail ? (JSON.parse(detail) as { code?: unknown; error?: unknown }) : null;
  } catch {
    // Unparseable body — left null, which every arm below treats as "unproven" and surfaces.
    envelope = null;
  }
  if (res.status === 409) {
    if (envelope?.code === "already_inactive") {
      state.archivedBySync.add(lifecycleKey(op));
      return;
    }
    if (typeof envelope?.error === "string") {
      throw new Error(`Lifecycle archive of ${op.table}/${op.id} failed (${res.status}): ${envelope.error}`);
    }
    throw safeResponseError(`Lifecycle archive of ${op.table}/${op.id}`, res.status, detail);
  }
  if (res.status === 404) {
    if (envelope?.error === "Not found") {
      state.archivedBySync.delete(lifecycleKey(op));
      return;
    }
    throw safeResponseError(`Lifecycle archive of ${op.table}/${op.id}`, res.status, detail);
  }
  if (!res.ok) {
    throw safeResponseError(`Lifecycle archive of ${op.table}/${op.id}`, res.status, detail);
  }
  state.archivedBySync.add(lifecycleKey(op));
}
