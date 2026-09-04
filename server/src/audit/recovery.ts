import { closeSync, existsSync, ftruncateSync, openSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { MAX_RECOVERY_DELIVERY_IDS } from "./types";
export interface AuditRecoveryState {
  degraded: boolean;
  deliveryStateLoaded: boolean;
  activeSize: number | null;
  priorSize: number | null;
  activeFileExists: boolean;
  deliveredAuditIds: Set<string>;
}

export function auditRecovery(
  file: string,
  log: (msg: string) => void,
  syncFile: (fd: number) => void,
  recoveryScanBytes: number,
  state: AuditRecoveryState,
) {
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
          state.deliveredAuditIds.add(parsed.auditId);
          if (state.deliveredAuditIds.size > MAX_RECOVERY_DELIVERY_IDS) {
            state.deliveredAuditIds.delete(state.deliveredAuditIds.values().next().value!);
          }
        }
        // A WELL-FORMED line without a usable auditId still cannot suppress replay (its outbox row,
        // if any, replays) but it is not corruption — records may legitimately omit the delivery
        // metadata — so it is skipped silently, as before.
      } catch {
        // A complete MALFORMED historical line is file corruption: silent acceptance hid it from
        // deep health entirely (review finding DBR-0007). Latch degraded; the affected outbox rows
        // replay, which stays the safe direction.
        state.degraded = true;
        log(
          "capacitylens-server: audit recovery found a complete malformed JSONL line — latching degraded health; affected outbox rows will replay",
        );
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
    state.deliveredAuditIds.clear();
    collectDeliveryIds(`${file}.1`);
    collectDeliveryIds(file);
    state.activeFileExists = existsSync(file);
    state.activeSize = existingSize(file);
    state.priorSize = existingSize(`${file}.1`);
    state.deliveryStateLoaded = true;
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

  return { collectDeliveryIds, loadDeliveryState, syncRediscoveredDeliveries, syncParentDirectory };
}
