import { chmodSync, closeSync, existsSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { createAuditRecovery, type AuditRecoveryState } from "./createAuditRecovery";
import {
  AUDIT_RECOVERY_SCAN_BYTES,
  DEFAULT_MAX_BYTES,
  MAX_AUDIT_BYTES,
  type AuditEntry,
  type AuditSink,
  type FileAuditSinkOptions,
} from "./types";

interface AppendContext {
  file: string;
  log: (message: string) => void;
  maxBytes: number;
  recoveryScanBytes: number;
  state: AuditRecoveryState;
  permissions: { pinned: boolean };
  ensureOwnerOnlyPermissions: (path: string) => void;
  syncFile: (fd: number) => void;
  collectDeliveryIds: (path: string) => void;
  loadDeliveryState: () => void;
  syncRediscoveredDeliveries: () => void;
  syncParentDirectory: () => void;
}

interface SerializedRecords {
  pending: readonly AuditEntry[];
  payload: string;
  payloadBytes: number;
}

function validateLimits(maxBytes: number, recoveryScanBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_AUDIT_BYTES) {
    throw new RangeError(`maxBytes must be a safe integer from 1 to ${MAX_AUDIT_BYTES}.`);
  }
  if (!Number.isSafeInteger(recoveryScanBytes) || recoveryScanBytes < 1 || recoveryScanBytes > maxBytes) {
    throw new RangeError("recoveryScanBytes must be a safe integer from 1 to maxBytes.");
  }
}

function createRecoveryState(): AuditRecoveryState {
  return {
    degraded: false,
    deliveryStateLoaded: false,
    activeSize: null,
    priorSize: null,
    activeFileExists: false,
    deliveredAuditIds: new Set<string>(),
  };
}

function createPermissionPinner(pinPermissions: (file: string, mode: number) => void): (path: string) => void {
  return (path) => {
    try {
      pinPermissions(path, 0o600);
    } catch (permissionError) {
      const detail = permissionError instanceof Error ? permissionError.message : String(permissionError);
      throw new Error(`Audit permission pin failed: ${detail}`, { cause: permissionError });
    }
  };
}

function readLoadedSizes(state: AuditRecoveryState): { active: number; prior: number } {
  if (state.activeSize === null || state.priorSize === null) {
    throw new Error("Audit delivery state did not load file sizes.");
  }
  return { active: state.activeSize, prior: state.priorSize };
}

function serializePendingRecords(
  records: readonly AuditEntry[],
  state: AuditRecoveryState,
  recoveryScanBytes: number,
): SerializedRecords {
  const pending = records.filter((record) => !record.auditId || !state.deliveredAuditIds.has(record.auditId));
  const lines = pending.map((record) => JSON.stringify(record) + "\n");
  const lineBytes = lines.map((line) => Buffer.byteLength(line, "utf8"));
  const oversized = lineBytes.find((bytes) => bytes > recoveryScanBytes);
  if (oversized !== undefined) {
    throw new RangeError(
      `Audit entry is ${oversized} bytes, exceeding maxBytes/replay recovery limit ${recoveryScanBytes}.`,
    );
  }
  const payloadBytes = lineBytes.reduce((total, bytes) => total + bytes, 0);
  if (payloadBytes > recoveryScanBytes) {
    throw new RangeError(
      `Audit delivery page is ${payloadBytes} bytes, exceeding the replay recovery window ${recoveryScanBytes}.`,
    );
  }
  return { pending, payload: lines.join(""), payloadBytes };
}

function rotateIfNeeded(context: AppendContext, activeSize: number, payloadBytes: number): void {
  if (activeSize === 0 || activeSize + payloadBytes <= context.maxBytes) return;
  renameSync(context.file, `${context.file}.1`);
  context.log(`capacitylens-server: audit log rotated — ${context.file} (${activeSize} bytes) -> ${context.file}.1`);
  context.state.deliveredAuditIds.clear();
  context.collectDeliveryIds(`${context.file}.1`);
  context.state.priorSize = activeSize;
  context.state.activeSize = 0;
  context.state.activeFileExists = false;
  context.permissions.pinned = false;
}

function writePayload(context: AppendContext, records: SerializedRecords): void {
  const created = !context.state.activeFileExists;
  const fd = openSync(context.file, "a", 0o600);
  try {
    if (!context.permissions.pinned) {
      context.ensureOwnerOnlyPermissions(context.file);
      context.permissions.pinned = true;
    }
    writeFileSync(fd, records.payload, { encoding: "utf8" });
    context.syncFile(fd);
  } finally {
    closeSync(fd);
  }
  context.state.activeFileExists = true;
  context.state.activeSize = (context.state.activeSize ?? 0) + records.payloadBytes;
  if (created) context.syncParentDirectory();
  for (const record of records.pending) {
    if (record.auditId) context.state.deliveredAuditIds.add(record.auditId);
  }
}

function appendRecords(context: AppendContext, records: readonly AuditEntry[]): boolean {
  if (!context.permissions.pinned) {
    for (const path of [`${context.file}.1`, context.file]) {
      if (existsSync(path)) context.ensureOwnerOnlyPermissions(path);
    }
    context.permissions.pinned = existsSync(context.file);
  }
  if (!context.state.deliveryStateLoaded) context.loadDeliveryState();
  const sizes = readLoadedSizes(context.state);
  if (sizes.active > context.maxBytes || sizes.prior > context.maxBytes) {
    throw new RangeError(
      `Existing audit generation is ${Math.max(sizes.active, sizes.prior)} bytes, exceeding maxBytes ${context.maxBytes}.`,
    );
  }
  const serialized = serializePendingRecords(records, context.state, context.recoveryScanBytes);
  if (serialized.pending.length === 0) {
    if (records.length > 0) context.syncRediscoveredDeliveries();
    return true;
  }
  rotateIfNeeded(context, sizes.active, serialized.payloadBytes);
  writePayload(context, serialized);
  return true;
}
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
 * @param options `maxBytes` — see FileAuditSinkOptions
 */
export function createFileAuditSink(
  file: string,
  log: (msg: string) => void,
  options: FileAuditSinkOptions = {},
): AuditSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const pinPermissions = options.pinPermissions ?? chmodSync;
  const syncFile = options.syncFile ?? fsyncSync;
  const recoveryScanBytes = options.recoveryScanBytes ?? Math.min(AUDIT_RECOVERY_SCAN_BYTES, maxBytes);
  validateLimits(maxBytes, recoveryScanBytes);
  const state = createRecoveryState();
  let loggedOnce = false;
  const permissions = { pinned: false };
  const ensureOwnerOnlyPermissions = createPermissionPinner(pinPermissions);

  const { collectDeliveryIds, loadDeliveryState, syncRediscoveredDeliveries, syncParentDirectory } =
    createAuditRecovery({ file, log, syncFile, recoveryScanBytes, state });

  const context: AppendContext = {
    file,
    log,
    maxBytes,
    recoveryScanBytes,
    state,
    permissions,
    ensureOwnerOnlyPermissions,
    syncFile,
    collectDeliveryIds,
    loadDeliveryState,
    syncRediscoveredDeliveries,
    syncParentDirectory,
  };

  const appendMany = (records: readonly AuditEntry[]): boolean => {
    try {
      return appendRecords(context, records);
    } catch (error) {
      state.degraded = true;
      state.deliveryStateLoaded = false;
      state.activeSize = null;
      state.priorSize = null;
      if (!loggedOnce) {
        loggedOnce = true;
        log(`capacitylens-server: audit write FAILED — ${error instanceof Error ? error.message : String(error)}`);
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
