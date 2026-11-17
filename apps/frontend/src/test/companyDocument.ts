import { BETA_EXPORT_FORMAT, BETA_EXPORT_SCHEMA_VERSION } from '@capacitylens/shared/data/betaTransfer';
import { seed } from '@capacitylens/shared/data/seed';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';

/** The seed data of one company. The browser no longer validates documents, so neither does this. */
export function companySeed(accountId: string): AppData {
  const data = seed();
  const company: Record<string, unknown[]> = {
    accounts: data.accounts.filter((row) => row.id === accountId),
  };
  for (const key of SCOPED_KEYS) {
    const rows: { accountId: string }[] = data[key];
    company[key] = rows.filter((row) => row.accountId === accountId);
  }
  return company as unknown as AppData;
}

/** One company's seed data wrapped as a transfer document of the given completeness. */
export function companyDocument(accountId: string, completeness: 'full' | 'redacted') {
  return {
    format: BETA_EXPORT_FORMAT,
    schemaVersion: BETA_EXPORT_SCHEMA_VERSION,
    completeness,
    data: companySeed(accountId),
  };
}
