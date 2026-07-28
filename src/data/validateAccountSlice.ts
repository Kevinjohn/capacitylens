import { KNOWN_KEYS, migrateWithRepairBase, type MigrationWithRepairBase } from "@capacitylens/shared/data/migrate";
import { SCOPED_KEYS, type AppData } from "@capacitylens/shared/types/entities";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate a complete tenant slice before migration can repair or synthesize rows. */
export function validateAccountSlice(value: unknown, accountId: string): AppData | null {
  return validateAccountSliceWithRepairBase(value, accountId)?.data ?? null;
}

/** Validate a complete tenant slice and preserve its pre-repair persistence baseline. */
export function validateAccountSliceWithRepairBase(value: unknown, accountId: string): MigrationWithRepairBase | null {
  if (!isRecord(value) || KNOWN_KEYS.some((key) => !Array.isArray(value[key]))) return null;
  for (const key of KNOWN_KEYS) {
    const rows = value[key] as unknown[];
    if (!rows.every(isRecord)) return null;
    const ids = new Set<string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      if (typeof row.id !== "string" || row.id.length === 0 || ids.has(row.id)) return null;
      ids.add(row.id);
    }
  }
  const accounts = value.accounts as Array<Record<string, unknown>>;
  if (accounts.length !== 1 || accounts[0].id !== accountId) return null;
  for (const key of SCOPED_KEYS) {
    if (!(value[key] as Array<Record<string, unknown>>).every((row) => row.accountId === accountId)) return null;
  }
  return migrateWithRepairBase(value);
}
