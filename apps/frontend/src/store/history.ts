import type { AppData, AppDataKey, Entity, ID } from "@capacitylens/shared/types/entities";
import { APP_DATA_KEYS } from "@capacitylens/shared/types/entities";
import { touchAfter } from "./revisions";

type DemoRowCommandFor<K extends AppDataKey> =
  | { operation: "upsert"; entity: K; id: ID; index: number; row: AppData[K][number] }
  | { operation: "remove"; entity: K; id: ID };

/** A typed local demo mutation against one row in one AppData table. */
export type DemoRowCommand = { [K in AppDataKey]: DemoRowCommandFor<K> }[AppDataKey];

/** The local demo undo entry; production planning history uses server PlanningIntent values. */
export interface DemoHistoryEntry {
  forward: DemoRowCommand[];
  inverse: DemoRowCommand[];
}

/** Maximum number of undo and redo entries retained by the store. */
export const HISTORY_LIMIT = 50;

/** Build the compact row changes between two transient AppData values. */
export function createDemoHistoryEntry(before: AppData, after: AppData): DemoHistoryEntry | null {
  const forward: DemoRowCommand[] = [];
  const inverse: DemoRowCommand[] = [];
  for (const key of APP_DATA_KEYS) {
    forward.push(...tableCommands(key, before[key], after[key]));
    inverse.push(...tableCommands(key, after[key], before[key]));
  }
  return forward.length === 0 ? null : { forward, inverse };
}

function tableCommands(key: AppDataKey, beforeRows: Entity[], afterRows: Entity[]): DemoRowCommand[] {
  if (beforeRows === afterRows) return [];
  const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
  const afterById = new Map(afterRows.map((row) => [row.id, row]));
  const commands: DemoRowCommand[] = [];
  afterRows.forEach((row, index) => {
    const before = beforeById.get(row.id);
    if (!before || !sameRow(before, row)) {
      commands.push({ operation: "upsert", entity: key, id: row.id, index, row } as DemoRowCommand);
    }
  });
  for (const row of beforeRows) {
    if (!afterById.has(row.id)) commands.push({ operation: "remove", entity: key, id: row.id });
  }
  return commands;
}

function sameRow(left: Entity, right: Entity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Apply a local undo or redo entry to the current data, touching surviving changed rows. */
export function applyDemoRowCommands(current: AppData, commands: readonly DemoRowCommand[]): AppData {
  if (commands.length === 0) return current;
  let next = current;
  for (const key of APP_DATA_KEYS) {
    const tableCommandsForKey = commands.filter((command) => command.entity === key);
    if (tableCommandsForKey.length === 0) continue;
    const rows = next[key] as Entity[];
    const removedIds = new Set(
      tableCommandsForKey.filter((command) => command.operation === "remove").map((command) => command.id),
    );
    const table = rows.filter((row) => !removedIds.has(row.id));
    const indexById = new Map(table.map((row, index) => [row.id, index]));
    const upserts = tableCommandsForKey
      .filter((command): command is Extract<DemoRowCommand, { operation: "upsert" }> => command.operation === "upsert")
      .sort((left, right) => left.index - right.index);
    const insertedById = new Map<string, { row: Entity; index: number }>();
    const inserted: Array<{ row: Entity; index: number }> = [];
    for (const command of upserts) {
      const existingIndex = indexById.get(command.id);
      const row = command.row;
      if (existingIndex !== undefined) {
        const existing = table[existingIndex];
        if (existing) table[existingIndex] = { ...row, updatedAt: touchAfter(existing.updatedAt, row.updatedAt) };
      } else if (insertedById.has(command.id)) {
        const insertion = insertedById.get(command.id);
        if (insertion) insertion.row = { ...row, updatedAt: touchAfter(insertion.row.updatedAt, row.updatedAt) };
      } else {
        const insertion = { row, index: Math.min(command.index, table.length + inserted.length) };
        inserted.push(insertion);
        insertedById.set(command.id, insertion);
      }
    }

    // Insertions are processed at their historical indices. Equal indices insert before prior
    // rows at that position; reserve those final slots, then fill the remaining slots once.
    const insertionSlots = new Map<number, Entity>();
    let sameIndexCount = 0;
    for (let index = inserted.length - 1; index >= 0; index -= 1) {
      const insertion = inserted[index];
      if (!insertion) continue;
      if (index + 1 < inserted.length && inserted[index + 1]?.index === insertion.index) {
        sameIndexCount += 1;
      } else {
        sameIndexCount = 0;
      }
      insertionSlots.set(insertion.index + sameIndexCount, insertion.row);
    }

    const reconstructed: Entity[] = [];
    let existingIndex = 0;
    const length = table.length + inserted.length;
    for (let index = 0; index < length; index += 1) {
      const insertedRow = insertionSlots.get(index);
      if (insertedRow) reconstructed.push(insertedRow);
      else {
        const existingRow = table[existingIndex];
        if (existingRow) reconstructed.push(existingRow);
        existingIndex += 1;
      }
    }
    next = { ...next, [key]: reconstructed };
  }
  return next;
}

/** True when a server refresh republishes the same authoritative entity revisions. */
export function hasSameEntityRevisions(current: AppData, replacement: AppData): boolean {
  for (const key of Object.keys(current) as Array<keyof AppData>) {
    const currentRows = current[key];
    const replacementRows = replacement[key];
    if (currentRows.length !== replacementRows.length) return false;
    const replacementRevisionsById = new Map(replacementRows.map((row) => [row.id, row.updatedAt]));
    if (currentRows.some((row) => replacementRevisionsById.get(row.id) !== row.updatedAt)) {
      return false;
    }
  }
  return true;
}
