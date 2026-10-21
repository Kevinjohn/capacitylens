import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { announceAuditWarning, noteAuditWarning } from "@/lib/auditWarning";
import type { Op } from "@/data/syncOps";
import { BatchCommitUncertainError } from "./batchErrors";
import { buildRowKey, warnCompatibilityOnce } from "./revisions";
import type { BatchCommitReceipt, CommittedRevision } from "./revisions";

interface BatchReceiptWire {
  ok?: unknown;
  applied?: unknown;
  revisions?: unknown;
  archives?: unknown;
  superseded?: unknown;
  auditWarning?: unknown;
}

function parseBatchReceipt(value: unknown, appliedCount: number): BatchReceiptWire {
  if (!value || typeof value !== "object") {
    throw new BatchCommitUncertainError("Batch sync returned an invalid commit receipt.");
  }
  const receipt: BatchReceiptWire = value;
  if (receipt.ok !== true || (receipt.applied !== undefined && receipt.applied !== appliedCount)) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid commit receipt.");
  }
  if (receipt.applied === undefined) {
    warnCompatibilityOnce(
      "batch-applied",
      "ServerSyncAdapter: the batch receipt omitted 'applied'; accepting the proven commit for rolling-version compatibility.",
    );
  }
  if (receipt.superseded !== undefined && typeof receipt.superseded !== "boolean") {
    throw new BatchCommitUncertainError("Batch sync returned an invalid ordering receipt.");
  }
  return receipt;
}

function isCommittedRevision(value: unknown): value is CommittedRevision {
  if (!isRecord(value)) return false;
  const knownTables = emptyAppData();
  return (
    typeof value.table === "string" &&
    Object.hasOwn(knownTables, value.table) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function listReceiptRevisions(receipt: BatchReceiptWire): CommittedRevision[] {
  if (!Array.isArray(receipt.revisions)) {
    warnCompatibilityOnce(
      "batch-revisions",
      "ServerSyncAdapter: the batch receipt omitted server revisions; continuing without revision translation.",
    );
    return [];
  }
  const revisions = receipt.revisions.flatMap((value) => {
    return isCommittedRevision(value) ? [value] : [];
  });
  if (revisions.length !== receipt.revisions.length) {
    warnCompatibilityOnce(
      "batch-invalid-revisions",
      "ServerSyncAdapter: dropping malformed server revisions from an otherwise successful batch receipt.",
    );
  }
  return revisions;
}

function reconcileRevisions(receipt: BatchReceiptWire, ops: Op[]): CommittedRevision[] {
  const expected = new Set(
    receipt.superseded === true
      ? []
      : ops.filter((op) => op.method === "PUT").map((op) => buildRowKey(op.table, op.id)),
  );
  const received = new Set<string>();
  const serverRewrites = new Set<string>();
  const compatibleRevisions: CommittedRevision[] = [];
  for (const revision of listReceiptRevisions(receipt)) {
    const key = buildRowKey(revision.table, revision.id);
    const isExpected = revision.rewrite !== true && expected.has(key) && !received.has(key);
    const isRewrite = revision.rewrite === true && revision.table === "allocations" && !serverRewrites.has(key);
    if (isExpected) received.add(key);
    if (isRewrite) serverRewrites.add(key);
    if (isExpected || isRewrite) compatibleRevisions.push(revision);
    else
      warnCompatibilityOnce(
        "batch-mismatched-revisions",
        "ServerSyncAdapter: dropping unexpected or duplicate server revisions from a successful batch receipt.",
      );
  }
  if (received.size !== expected.size) {
    throw new BatchCommitUncertainError(
      "Batch sync committed without complete server revisions; authoritative reload is required.",
    );
  }
  return compatibleRevisions;
}

type ListExpectedArchivesOptions = { receipt: BatchReceiptWire; ops: Op[]; archiveLifecycleDeletes: boolean };
function listExpectedArchives({ receipt, ops, archiveLifecycleDeletes }: ListExpectedArchivesOptions): Set<string> {
  if (receipt.superseded === true || !archiveLifecycleDeletes) return new Set();
  return new Set(
    ops
      .filter((op) => op.method === "DELETE" && isLifecycleEntityKey(op.table))
      .map((op) => buildRowKey(op.table, op.id)),
  );
}

interface ArchiveReceipt {
  key: string;
  archived: boolean;
}

function parseArchiveReceipt(
  value: unknown,
  expected: ReadonlySet<string>,
  received: ReadonlySet<string>,
): ArchiveReceipt {
  if (!isRecord(value)) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
  }
  const key = buildRowKey(String(value.table), String(value.id));
  if (
    typeof value.table !== "string" ||
    !isLifecycleEntityKey(value.table) ||
    typeof value.id !== "string" ||
    typeof value.archived !== "boolean" ||
    !expected.has(key) ||
    received.has(key)
  ) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
  }
  return { key, archived: value.archived };
}

function reconcileArchives(receipt: BatchReceiptWire, expected: ReadonlySet<string>): Set<string> {
  if (expected.size > 0 && !Array.isArray(receipt.archives)) {
    throw new BatchCommitUncertainError("Batch sync committed without lifecycle archive receipts.");
  }
  const rawArchives: unknown[] = Array.isArray(receipt.archives) ? receipt.archives : [];
  const received = new Set<string>();
  const archivedLifecycleKeys = new Set<string>();
  for (const value of rawArchives) {
    const archive = parseArchiveReceipt(value, expected, received);
    received.add(archive.key);
    if (archive.archived) archivedLifecycleKeys.add(archive.key);
  }
  if (received.size !== expected.size) {
    throw new BatchCommitUncertainError("Batch sync committed without complete lifecycle archive receipts.");
  }
  return archivedLifecycleKeys;
}

/** Reconciliation stage: validate the commit receipt, then fold its server revisions and lifecycle
 * archive confirmations into the {@link BatchCommitReceipt} the caller advances the snapshot with. */
interface ReadBatchReceiptInput {
  response: Response;
  ops: Op[];
  archiveLifecycleDeletes: boolean;
}

export async function readBatchReceipt({
  response,
  ops,
  archiveLifecycleDeletes,
}: ReadBatchReceiptInput): Promise<BatchCommitReceipt> {
  const receipt = parseBatchReceipt(await response.json().catch(() => null), ops.length);
  // The batch receipt can flag audit degradation in its body as well as the shared header; the
  // header half goes through the same synchronous helper as the lifecycle routes above.
  if (receipt.auditWarning === true) announceAuditWarning();
  else noteAuditWarning(response);
  const compatibleRevisions = reconcileRevisions(receipt, ops);
  const expectedArchives = listExpectedArchives({
    receipt: receipt,
    ops: ops,
    archiveLifecycleDeletes: archiveLifecycleDeletes,
  });
  const archivedLifecycleKeys = reconcileArchives(receipt, expectedArchives);
  return {
    revisions: compatibleRevisions,
    archivedLifecycleKeys,
    superseded: receipt.superseded === true,
  };
}
