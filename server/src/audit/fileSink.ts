import { chmodSync, closeSync, existsSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { auditRecovery, type AuditRecoveryState } from "./recovery";
import {
  AUDIT_RECOVERY_SCAN_BYTES,
  DEFAULT_MAX_BYTES,
  MAX_AUDIT_BYTES,
  type AuditEntry,
  type AuditSink,
  type FileAuditSinkOptions,
} from "./types";
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
  const state: AuditRecoveryState = {
    degraded: false,
    deliveryStateLoaded: false,
    activeSize: null,
    priorSize: null,
    activeFileExists: false,
    deliveredAuditIds: new Set<string>(),
  };
  let loggedOnce = false;
  let permissionsPinned = false;
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

  const { collectDeliveryIds, loadDeliveryState, syncRediscoveredDeliveries, syncParentDirectory } = auditRecovery(
    file,
    log,
    syncFile,
    recoveryScanBytes,
    state,
  );

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
      if (!state.deliveryStateLoaded) loadDeliveryState();
      const size = state.activeSize!;
      if (size > maxBytes || state.priorSize! > maxBytes) {
        throw new RangeError(
          `Existing audit generation is ${Math.max(size, state.priorSize!)} bytes, exceeding maxBytes ${maxBytes}.`,
        );
      }
      const pending = records.filter((record) => !record.auditId || !state.deliveredAuditIds.has(record.auditId));
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
        state.deliveredAuditIds.clear();
        collectDeliveryIds(`${file}.1`);
        state.priorSize = size;
        state.activeSize = 0;
        state.activeFileExists = false;
        permissionsPinned = false;
      }
      const created = !state.activeFileExists;
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
      state.activeFileExists = true;
      state.activeSize = (state.activeSize ?? 0) + payloadBytes;
      if (created) syncParentDirectory();
      for (const record of pending) if (record.auditId) state.deliveredAuditIds.add(record.auditId);
      return true;
    } catch (err) {
      state.degraded = true;
      state.deliveryStateLoaded = false;
      state.activeSize = null;
      state.priorSize = null;
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
      return state.degraded;
    },
  };
}
