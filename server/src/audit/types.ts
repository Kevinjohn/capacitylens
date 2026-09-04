import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ScopedEntityKey } from "@capacitylens/shared/types/entities";
/**
 * One audit line. ALL fields are operational metadata — never tenant data.
 *
 * `changedFields` is field NAMES ONLY (e.g. `['accountId','note','startDate']`), NEVER their
 * values. NEVER construct one of these by spreading a row/body; build `changedFields` with
 * `Object.keys(...)` so a value can't leak into the audit trail (the #1 privacy invariant).
 */
export interface AuditRecord {
  /** ISO-8601 instant the mutation committed (server runtime clock). */
  ts: string;
  /** The acting principal's id (DEMO_USER 'demo' in OFF mode; a real session id auth-on). */
  userId: string;
  /** The tenant the mutation targeted. */
  accountId: string;
  /** The kind of mutation. The lifecycle quartet (P2.5a) is distinct from the generic CRUD verbs:
   *  `archive`/`unarchive` flip the `archivedAt` tombstone, `softDelete` sets `deletedAt` (and, for a
   *  resource, scrubs the PII `name`), and `purge` is the HARD cascade row-delete of a ≥30-day-old
   *  tombstone. They stay distinct from `delete` (the generic by-id row delete) so the audit trail
   *  tells a reversible soft-delete apart from an irreversible purge. changedFields stay field NAMES
   *  only (e.g. `['archivedAt']`, `['deletedAt','name','allocations.note']`) — never values (the
   *  #1 no-PII invariant). */
  action:
    | "create"
    | "update"
    | "patch"
    | "delete"
    | "batch"
    | "import"
    | "archive"
    | "unarchive"
    | "softDelete"
    | "purge"
    | "memberRole"
    | "memberStatus"
    | "memberSignInTrackingChange"
    | "memberRemove"
    | "ownershipTransfer"
    | "inviteCreate"
    | "inviteAccept"
    | "inviteRevoke"
    | "passwordResetIssue"
    | "sessionsRevoke";
  /** The entity/table touched (e.g. 'timeOff', 'clients'), or 'account' for an import slice. */
  entity: string;
  /** The affected row id (the import record uses the accountId as its id). */
  id: string;
  /** Field NAMES that changed — Object.keys of the wire body/row. NEVER values. */
  changedFields: string[];
  /** Counts only, never values: rows removed from each scoped table by an irreversible purge. */
  cascadeCounts?: Partial<Record<ScopedEntityKey, number>>;
}

/** Stable delivery id added by the SQLite audit outbox. A recovered delivery may be replayed after
 * its JSONL append reached durable storage but before the outbox row was deleted; fileAuditSink
 * uses this id to make that replay a no-op instead of duplicating the line. */
export interface AuditDeliveryMetadata {
  auditId?: string;
}

export type AuditEntry = (AuditRecord | AccountAuditEvent) & AuditDeliveryMetadata;

/**
 * The audit write port. `append` is SYNCHRONOUS and MUST NOT throw: a broken audit sink can never
 * fail a request (the mutation already committed). It returns `true` on a successful write, `false`
 * on a write failure; on the first failure it sets `degraded` (a latch deep-health reads) and logs
 * ONE redacted, message-only line (never the record — that could carry the very ids we keep, and
 * keeps a broken sink from spamming the log).
 */
export interface AuditSink {
  /** Write one line. Never throws; returns false on failure (and latches `degraded`). */
  append(record: AuditEntry): boolean;
  /** Write a committed batch with one durability flush when supported. */
  appendMany?(records: readonly AuditEntry[]): boolean;
  /** Latched true once any append failed — the soft signal deep-health surfaces. */
  readonly degraded: boolean;
}

/** fileAuditSink's rotation knob. */
export interface FileAuditSinkOptions {
  /** Rotate before the next complete line would exceed this size, in bytes. A single larger line
   *  is rejected and degrades the sink. Default 64 MiB (see DEFAULT_MAX_BYTES) — an unbounded
   *  JSONL append-forever log eventually fills the disk, which then fails SQLite writes too. */
  maxBytes?: number;
  /** Test seam for the one-time existing-file permission pin. */
  pinPermissions?: (file: string, mode: number) => void;
  /** Test seam for file and directory durability flushes. */
  syncFile?: (fd: number) => void;
  /** Test seam for the bounded recovery reader. */
  recoveryScanBytes?: number;
}

export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_AUDIT_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB operator-safety ceiling
// One outbox page contains 500 compact metadata-only records. A 16 MiB tail therefore leaves
// substantial headroom while bounding restart allocation and parsing independently of the
// operator's generation-size setting (which may be as high as 1 TiB).
export const AUDIT_RECOVERY_SCAN_BYTES = 16 * 1024 * 1024;
export const MAX_RECOVERY_DELIVERY_IDS = 10_000;
