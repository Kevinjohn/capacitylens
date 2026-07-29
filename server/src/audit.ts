import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";

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
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_AUDIT_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB operator-safety ceiling

/**
 * A file-backed sink: one `\n`-terminated write + `fsync` per record. The single synchronous,
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
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_AUDIT_BYTES) {
    throw new RangeError(`maxBytes must be a safe integer from 1 to ${MAX_AUDIT_BYTES}.`);
  }
  let degraded = false;
  let loggedOnce = false;
  let permissionsPinned = false;
  let permissionFailureLogged = false;
  let deliveryStateLoaded = false;
  const deliveredAuditIds = new Set<string>();

  const collectDeliveryIds = (path: string) => {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { auditId?: unknown };
        if (typeof parsed.auditId === "string") deliveredAuditIds.add(parsed.auditId);
      } catch {
        // A complete malformed historical line has no trusted delivery id and cannot suppress replay.
      }
    }
  };

  const syncParentDirectory = () => {
    const fd = openSync(dirname(file), "r");
    try {
      fsyncSync(fd);
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
      const bytes = readFileSync(file);
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
        const newline = bytes.lastIndexOf(0x0a);
        const fd = openSync(file, "r+");
        try {
          ftruncateSync(fd, newline + 1);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        log("capacitylens-server: audit recovered an unterminated tail; the durable outbox will replay it");
      }
    }
    deliveredAuditIds.clear();
    collectDeliveryIds(`${file}.1`);
    collectDeliveryIds(file);
    deliveryStateLoaded = true;
  };

  return {
    append(record: AuditEntry): boolean {
      try {
        if (!deliveryStateLoaded) loadDeliveryState();
        const size = existingSize(file);
        const priorSize = existingSize(`${file}.1`);
        if (size > maxBytes || priorSize > maxBytes) {
          throw new RangeError(
            `Existing audit generation is ${Math.max(size, priorSize)} bytes, exceeding maxBytes ${maxBytes}.`,
          );
        }
        if (record.auditId && deliveredAuditIds.has(record.auditId)) return true;
        const line = JSON.stringify(record) + "\n";
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (lineBytes > maxBytes) {
          throw new RangeError(`Audit entry is ${lineBytes} bytes, exceeding maxBytes ${maxBytes}.`);
        }
        if (size > 0 && size + lineBytes > maxBytes) {
          renameSync(file, `${file}.1`);
          log(`capacitylens-server: audit log rotated — ${file} (${size} bytes) -> ${file}.1`);
          // The overwritten historical generation can no longer suppress an outbox replay. Bound
          // the in-memory idempotency index to the two generations that are actually retained.
          deliveredAuditIds.clear();
          collectDeliveryIds(`${file}.1`);
          permissionsPinned = false;
        }
        const created = !existsSync(file);
        const fd = openSync(file, "a", 0o600);
        try {
          writeFileSync(fd, line, { encoding: "utf8" });
          // Successful delivery means stable file contents, not merely acceptance by the kernel's
          // page cache. The outbox row is deleted only after this synchronous fsync returns.
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        // fsync(file) makes contents durable; a newly created generation also needs its directory
        // entry persisted (and, after rotation, the rename) before the outbox row can be deleted.
        if (created) syncParentDirectory();
        // The open mode applies only when it creates a file. Pin an existing file once when the
        // sink first uses it, and pin each new generation once after rotation—not on every hot-path append.
        if (!permissionsPinned) {
          permissionsPinned = true;
          try {
            pinPermissions(file, 0o600);
          } catch (permissionError) {
            if (!permissionFailureLogged) {
              permissionFailureLogged = true;
              log(
                `capacitylens-server: audit permission pin FAILED — ${
                  permissionError instanceof Error ? permissionError.message : String(permissionError)
                }`,
              );
            }
          }
        }
        if (record.auditId) deliveredAuditIds.add(record.auditId);
        return true;
      } catch (err) {
        // FAIL-NEVER: the mutation already committed — an audit write failure (append, OR the
        // stat/rename that guards rotation) must not throw back into the request path. Latch
        // degraded (deep-health surfaces it) and log ONCE, MESSAGE ONLY — never the record (it
        // carries ids we keep off the failure log) — so a persistently broken sink can't flood stdout.
        degraded = true;
        // A failed write may have left an unterminated tail. Re-inspect before the next delivery so
        // the retained outbox row can replay into a clean JSONL boundary.
        deliveryStateLoaded = false;
        if (!loggedOnce) {
          loggedOnce = true;
          log(`capacitylens-server: audit write FAILED — ${err instanceof Error ? err.message : String(err)}`);
        }
        return false;
      }
    },
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
