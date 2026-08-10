import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { ScopedEntityKey } from "@capacitylens/shared/types/entities";

// Append-only JSONL audit sink (P1.15, flag CAPACITYLENS_AUDIT — ON BY DEFAULT, opt-out =off).
// It records one legacy product AuditRecord per AppData mutation plus normalized AccountAuditEvent
// entries emitted by cross-port account flows. SERVER-MODE ONLY: the sink lives in the server (built in
// index.ts from env), so the default local/no-server deploy never runs it — buildApp's factory
// defaults to noopAuditSink(), keeping the default deploy and every test byte-identical unless a
// sink is explicitly passed.
//
// THE #1 INVARIANT — NO RAW PII EVER REACHES A LINE. `changedFields` is field NAMES only
// (Object.keys of the wire body/row); a VALUE, a ROW, or a request BODY must NEVER be handed to
// append(). Names + ids are operational metadata (who changed what, when); values are tenant PII
// (a time-off note, a person's name) and are deliberately excluded. Product callers compute
// changedFields with `Object.keys`; AccountFlows emits fixed field names and command correlation.
// Neither path passes a request body, row, bearer, credential, token or claim set.

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

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_AUDIT_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB operator-safety ceiling
// One outbox page contains 500 compact metadata-only records. A 16 MiB tail therefore leaves
// substantial headroom while bounding restart allocation and parsing independently of the
// operator's generation-size setting (which may be as high as 1 TiB).
export const AUDIT_RECOVERY_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_RECOVERY_DELIVERY_IDS = 10_000;

/**
 * A file-backed sink: one `\n`-terminated write per record and one `fsync` per delivered batch. The
 * newline-terminated write is partial-line-safe for this single-process, single-writer server; a
 * torn tail is truncated on recovery and its retained SQLite outbox row replays the complete line.
 * A write failure (disk full, bad path, permissions) is caught, never thrown — it latches
 * `degraded` and logs ONE redacted line.
 *
 * Size-based rotation hard-bounds the two generations to 2x `maxBytes`: the entry is serialized
 * first, and the active file is renamed to `<file>.1` before the new complete line would cross the
 * cap (replacing any prior `.1` — POSIX rename atomically replaces an existing destination). A
 * single line larger than the cap is rejected intact, leaving its outbox row queued and latching
 * degraded health; security evidence is never truncated to fit. Only ONE prior generation is kept;
 * this is a disk-usage bound, not a retention/archival feature.
 *
 * @param file the JSONL file to append to (created on first write)
 * @param log  where the single redacted failure line goes (index.ts passes console.error)
 * @param opts `maxBytes` — see FileAuditSinkOptions
 */
export function fileAuditSink(file: string, log: (msg: string) => void, opts: FileAuditSinkOptions = {}): AuditSink {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const pinPermissions = opts.pinPermissions ?? chmodSync;
  const syncFile = opts.syncFile ?? fsyncSync;
  const recoveryScanBytes = opts.recoveryScanBytes ?? Math.min(AUDIT_RECOVERY_SCAN_BYTES, maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_AUDIT_BYTES) {
    throw new RangeError(`maxBytes must be a safe integer from 1 to ${MAX_AUDIT_BYTES}.`);
  }
  if (!Number.isSafeInteger(recoveryScanBytes) || recoveryScanBytes < 1 || recoveryScanBytes > maxBytes) {
    throw new RangeError("recoveryScanBytes must be a safe integer from 1 to maxBytes.");
  }
  let degraded = false;
  let loggedOnce = false;
  let permissionsPinned = false;
  let deliveryStateLoaded = false;
  let activeSize: number | null = null;
  let priorSize: number | null = null;
  let activeFileExists = false;
  const deliveredAuditIds = new Set<string>();

  const ensureOwnerOnlyPermissions = (path: string) => {
    try {
      pinPermissions(path, 0o600);
    } catch (permissionError) {
      throw new Error(
        `Audit permission pin failed: ${
          permissionError instanceof Error ? permissionError.message : String(permissionError)
        }`,
        { cause: permissionError },
      );
    }
  };

  const readBoundedTail = (path: string): Buffer | null => {
    if (!existsSync(path)) return null;
    const size = existingSize(path);
    if (size === 0) return Buffer.alloc(0);
    const length = Math.min(size, recoveryScanBytes);
    const offset = size - length;
    const bytes = Buffer.allocUnsafe(length);
    const fd = openSync(path, "r");
    try {
      let read = 0;
      while (read < length) {
        const count = readSync(fd, bytes, read, length - read, offset + read);
        if (count === 0) break;
        read += count;
      }
      return read === length ? bytes : bytes.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  };

  const collectDeliveryIds = (path: string) => {
    const tail = readBoundedTail(path);
    if (tail === null || tail.length === 0) return;
    const size = existingSize(path);
    let start = 0;
    if (size > tail.length) {
      const firstNewline = tail.indexOf(0x0a);
      if (firstNewline < 0) {
        throw new RangeError(`Audit recovery tail contains no complete line within ${recoveryScanBytes} bytes.`);
      }
      start = firstNewline + 1;
    }
    for (const line of tail.subarray(start).toString("utf8").split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { auditId?: unknown };
        if (typeof parsed.auditId === "string") {
          deliveredAuditIds.add(parsed.auditId);
          if (deliveredAuditIds.size > MAX_RECOVERY_DELIVERY_IDS) {
            deliveredAuditIds.delete(deliveredAuditIds.values().next().value!);
          }
        }
      } catch {
        // A complete malformed historical line has no trusted delivery id and cannot suppress replay.
      }
    }
  };

  const syncParentDirectory = () => {
    const fd = openSync(dirname(file), "r");
    try {
      syncFile(fd);
    } finally {
      closeSync(fd);
    }
  };

  const existingSize = (path: string): number => {
    try {
      return statSync(path).size;
    } catch (statErr) {
      // ENOENT is the normal first-write/no-prior-generation case. Any other stat failure is an
      // audit sink failure and must reach the outer fail-never/degraded boundary.
      if ((statErr as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw statErr;
    }
  };

  const loadDeliveryState = () => {
    // A process/power loss can interrupt a write before its fsync. Drop only the unterminated tail;
    // the corresponding SQLite outbox row remains and will replay the complete record below.
    if (existsSync(file)) {
      const bytes = readBoundedTail(file)!;
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
        const newline = bytes.lastIndexOf(0x0a);
        if (newline < 0 && existingSize(file) > bytes.length) {
          throw new RangeError(`Audit unterminated tail exceeds the ${recoveryScanBytes}-byte recovery window.`);
        }
        const fd = openSync(file, "r+");
        try {
          ftruncateSync(fd, existingSize(file) - bytes.length + newline + 1);
          syncFile(fd);
        } finally {
          closeSync(fd);
        }
        log("capacitylens-server: audit recovered an unterminated tail; the durable outbox will replay it");
      }
    }
    deliveredAuditIds.clear();
    collectDeliveryIds(`${file}.1`);
    collectDeliveryIds(file);
    activeFileExists = existsSync(file);
    activeSize = existingSize(file);
    priorSize = existingSize(`${file}.1`);
    deliveryStateLoaded = true;
  };

  const syncRediscoveredDeliveries = () => {
    // A complete line can be readable even when its prior fsync failed. A retry satisfied from
    // rediscovered audit ids must re-establish the durability boundary before the SQLite outbox
    // copy may be deleted. Flush both retained generations because delivery ids are collected from
    // both, then the directory so a newly-created file or rotation rename is durable too.
    for (const path of [`${file}.1`, file]) {
      if (!existsSync(path)) continue;
      const fd = openSync(path, "r");
      try {
        syncFile(fd);
      } finally {
        closeSync(fd);
      }
    }
    syncParentDirectory();
  };

  const appendMany = (records: readonly AuditEntry[]): boolean => {
    try {
      if (!permissionsPinned) {
        // open(..., 0600) protects a newly created file, but mode is ignored for an existing path.
        // Repair both retained generations before reading or appending; if repair is forbidden,
        // retain the SQLite outbox row and report degraded health instead of extending an exposed
        // audit trail.
        for (const path of [`${file}.1`, file]) {
          if (existsSync(path)) ensureOwnerOnlyPermissions(path);
        }
        permissionsPinned = existsSync(file);
      }
      if (!deliveryStateLoaded) loadDeliveryState();
      const size = activeSize!;
      if (size > maxBytes || priorSize! > maxBytes) {
        throw new RangeError(
          `Existing audit generation is ${Math.max(size, priorSize!)} bytes, exceeding maxBytes ${maxBytes}.`,
        );
      }
      const pending = records.filter((record) => !record.auditId || !deliveredAuditIds.has(record.auditId));
      if (pending.length === 0) {
        if (records.length > 0) syncRediscoveredDeliveries();
        return true;
      }
      const lines = pending.map((record) => JSON.stringify(record) + "\n");
      const lineBytes = lines.map((line) => Buffer.byteLength(line, "utf8"));
      const oversized = lineBytes.find((bytes) => bytes > recoveryScanBytes);
      if (oversized !== undefined) {
        throw new RangeError(
          `Audit entry is ${oversized} bytes, exceeding maxBytes/replay recovery limit ${recoveryScanBytes}.`,
        );
      }
      const payloadBytes = lineBytes.reduce((total, bytes) => total + bytes, 0);
      // Outbox deletion follows only after this whole call succeeds. Keeping the complete delivered
      // page inside the bounded tail guarantees a crash before deletion can rediscover every id.
      if (payloadBytes > recoveryScanBytes) {
        throw new RangeError(
          `Audit delivery page is ${payloadBytes} bytes, exceeding the replay recovery window ${recoveryScanBytes}.`,
        );
      }
      if (size > 0 && size + payloadBytes > maxBytes) {
        renameSync(file, `${file}.1`);
        log(`capacitylens-server: audit log rotated — ${file} (${size} bytes) -> ${file}.1`);
        deliveredAuditIds.clear();
        collectDeliveryIds(`${file}.1`);
        priorSize = size;
        activeSize = 0;
        activeFileExists = false;
        permissionsPinned = false;
      }
      const created = !activeFileExists;
      const fd = openSync(file, "a", 0o600);
      try {
        if (!permissionsPinned) {
          ensureOwnerOnlyPermissions(file);
          permissionsPinned = true;
        }
        writeFileSync(fd, lines.join(""), { encoding: "utf8" });
        syncFile(fd);
      } finally {
        closeSync(fd);
      }
      activeFileExists = true;
      activeSize = (activeSize ?? 0) + payloadBytes;
      if (created) syncParentDirectory();
      for (const record of pending) if (record.auditId) deliveredAuditIds.add(record.auditId);
      return true;
    } catch (err) {
      degraded = true;
      deliveryStateLoaded = false;
      activeSize = null;
      priorSize = null;
      if (!loggedOnce) {
        loggedOnce = true;
        log(`capacitylens-server: audit write FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    }
  };

  return {
    append: (record) => appendMany([record]),
    appendMany,
    get degraded() {
      return degraded;
    },
  };
}

/**
 * The no-op sink: every `append` succeeds (returns true) and `degraded` is always false. This is
 * the factory default (buildApp) so the default local/no-server deploy and the whole test suite are
 * byte-identical unless a real sink is explicitly injected.
 */
export function noopAuditSink(): AuditSink {
  return {
    append: () => true,
    appendMany: () => true,
    degraded: false,
  };
}

/** JSON-line audit stream suitable for container stdout and a separate log collector. */
export function streamAuditSink(write: (line: string) => void): AuditSink {
  let degraded = false;
  return {
    append(record) {
      try {
        write(JSON.stringify({ type: "capacitylens.audit", ...record }));
        return true;
      } catch {
        degraded = true;
        return false;
      }
    },
    get degraded() {
      return degraded;
    },
  };
}

/** Require all configured destinations to accept a record; degradation is the union of sinks. */
export function compositeAuditSink(...sinks: AuditSink[]): AuditSink {
  return {
    append(record) {
      return sinks.map((sink) => sink.append(record)).every(Boolean);
    },
    appendMany(records) {
      return sinks
        .map((sink) =>
          sink.appendMany ? sink.appendMany(records) : records.map((record) => sink.append(record)).every(Boolean),
        )
        .every(Boolean);
    },
    get degraded() {
      return sinks.some((sink) => sink.degraded);
    },
  };
}

/**
 * Parse the audit config from env. ON BY DEFAULT (`CAPACITYLENS_AUDIT !== 'off'`) — the deliberate
 * flag-OFF exception to the repo's usual fail-closed default, because an audit trail you forgot to
 * enable is the failure mode that matters here. The file defaults BESIDE the DB
 * (`capacitylens-audit.jsonl` in the DB's directory); a `:memory:` DB (dirname '.') falls back to a
 * CWD-relative file.
 *
 * @param env    process.env (or a test stub)
 * @param dbPath the resolved DB path, used only to site the default audit file
 * @returns `{ enabled, file }` — index.ts builds a fileAuditSink when enabled, else a noopAuditSink
 */
export function parseAuditConfig(
  env: Record<string, string | undefined>,
  dbPath: string,
): { enabled: boolean; file: string } {
  const enabled = env.CAPACITYLENS_AUDIT !== "off";
  // dirname(':memory:') is '.', which join() resolves to CWD-relative — exactly the fallback we
  // want for an in-memory DB (no on-disk DB to sit beside).
  // Compose mapping pass-throughs define omitted values as ''. Treat that generated empty value as
  // absent so deployments outside the packaged Compose file cannot accidentally create a sink at an
  // unusable path. Deliberately do not trim: spaces can be valid in an explicitly configured path.
  const file = env.CAPACITYLENS_AUDIT_FILE || join(dirname(dbPath), "capacitylens-audit.jsonl");
  return { enabled, file };
}
