import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';

/** One row a planning operation wrote: its table, id, and the row before and after. */
export interface WrittenRow {
  entity: AppDataKey;
  id: string;
  before: AppData[AppDataKey][number] | null;
  after: AppData[AppDataKey][number] | null;
}

/**
 * A row read field by field. Rule checks that apply to several tables read and set fields by name;
 * every row is a plain object, so the view is the same object.
 */
export function asRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>;
}

/** Resolves a stored row of the named table from the complete company snapshot, refusing missing targets. */
export function requireExistingRow<K extends AppDataKey>(
  data: AppData,
  table: K,
  id: string
): AppData[K][number] {
  const rows: readonly { id: string }[] = data[table];
  const row = rows.find((item) => item.id === id);
  if (!row) {
    throw new ValidationRefusalException('The record was not found.');
  }
  // Indexing the snapshot by a generic key loses the element type, so restore it here.
  return row as AppData[K][number];
}
