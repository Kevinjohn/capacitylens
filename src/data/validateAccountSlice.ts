import { KNOWN_KEYS, migrateWithRepairBase, type MigrationWithRepairBase } from "@capacitylens/shared/data/migrate";
import { SCOPED_KEYS, type AppData } from "@capacitylens/shared/types/entities";

/** A non-null, non-array object — the shape every JSON payload check in the data layer starts from. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate a complete tenant slice before migration can repair or synthesize rows. */
export function parseAccountSlice(value: unknown, accountId: string): AppData | null {
  return parseAccountSliceWithRepairBase(value, accountId)?.data ?? null;
}

function hasValidRowIdentities(value: Record<string, unknown>): boolean {
  for (const key of KNOWN_KEYS) {
    const rows = value[key];
    if (!Array.isArray(rows) || !rows.every(isRecord)) return false;
    const ids = new Set<string>();
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.length === 0 || ids.has(row.id)) return false;
      ids.add(row.id);
    }
  }
  return true;
}

function belongsToAccount(value: Record<string, unknown>, accountId: string): boolean {
  const accounts = value.accounts;
  if (!Array.isArray(accounts) || !accounts.every(isRecord)) return false;
  const [account] = accounts;
  if (accounts.length !== 1 || account?.id !== accountId) return false;
  return SCOPED_KEYS.every((key) => {
    const rows = value[key];
    return Array.isArray(rows) && rows.every(isRecord) && rows.every((row) => row.accountId === accountId);
  });
}

/** Validate a complete tenant slice and preserve its pre-repair persistence baseline. */
export function parseAccountSliceWithRepairBase(value: unknown, accountId: string): MigrationWithRepairBase | null {
  if (!isRecord(value) || !hasValidRowIdentities(value) || !belongsToAccount(value, accountId)) return null;
  return migrateWithRepairBase(value);
}
