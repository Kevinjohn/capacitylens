import {
  COMPANY_EXPORT_FORMAT,
  COMPANY_EXPORT_SCHEMA_VERSION,
} from '@capacitylens/shared/data/companyDocument';
import { seed } from '@capacitylens/shared/data/seed';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';

/** The seed data of one company. The browser no longer validates documents, so neither does this. */
export function companySeed(companyId: string): AppData {
  const data = seed();
  const company: Record<string, unknown[]> = {
    companies: data.companies.filter((row) => row.id === companyId),
  };
  for (const key of SCOPED_KEYS) {
    const rows: { companyId: string }[] = data[key];
    company[key] = rows.filter((row) => row.companyId === companyId);
  }
  return company as unknown as AppData;
}

/** One company's seed data wrapped as a full transfer document. */
export function companyDocument(companyId: string) {
  return {
    format: COMPANY_EXPORT_FORMAT,
    schemaVersion: COMPANY_EXPORT_SCHEMA_VERSION,
    completeness: 'full',
    data: companySeed(companyId),
  };
}
