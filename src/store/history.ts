import type { AppData, AppDataKey, Entity } from "@capacitylens/shared/types/entities";
import { APP_DATA_KEYS, emptyAppData } from "@capacitylens/shared/types/entities";
import { advanceOverData } from "./revisions";

/**
 * Undo/redo restores historical values, but `updatedAt` is a synchronization revision rather than
 * user history. Re-stamp every surviving row whose content changes across the history transition;
 * otherwise the diff engine either misses a restored FK or the server rejects the old timestamp as
 * stale. Rows recreated from deletion need no stamp because the server has no current row to beat.
 */
export function prepareHistoryTarget(current: AppData, target: AppData): AppData {
  const now = new Date(advanceOverData(target, advanceOverData(current, Date.now()))).toISOString();
  const retime = <T extends Entity>(beforeRows: T[], targetRows: T[]): T[] => {
    // Immutable mutations structurally share every untouched table. Preserve that array wholesale;
    // even within a changed table, untouched rows retain object identity and need no serialization.
    if (beforeRows === targetRows) return targetRows;
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
    const content = (row: T): string => JSON.stringify({ ...row, updatedAt: undefined });
    return targetRows.map((row) => {
      const before = beforeById.get(row.id);
      if (before === row) return row;
      return before && (before.updatedAt !== row.updatedAt || content(before) !== content(row))
        ? { ...row, updatedAt: now }
        : row;
    });
  };
  // Driven by the shared key list (same altitude as hasSameEntityRevisions below) so a new AppData
  // table can't be silently dropped from the history transition by a missed hand-written line. The
  // row type is erased to Entity here; each table's real type is restored by the AppData return.
  const next = emptyAppData() as Record<AppDataKey, Entity[]>;
  for (const key of APP_DATA_KEYS) {
    next[key] = retime(current[key] as Entity[], target[key] as Entity[]);
  }
  return next as AppData;
}

/** True when a server refresh republishes the same authoritative entity revisions. */
export function hasSameEntityRevisions(current: AppData, replacement: AppData): boolean {
  for (const key of Object.keys(current) as Array<keyof AppData>) {
    const currentRows = current[key];
    const replacementRows = replacement[key];
    if (currentRows.length !== replacementRows.length) return false;
    const replacementRevisions = new Map(replacementRows.map((row) => [row.id, row.updatedAt]));
    if (currentRows.some((row) => replacementRevisions.get(row.id) !== row.updatedAt)) {
      return false;
    }
  }
  return true;
}

export const HISTORY_LIMIT = 50;
