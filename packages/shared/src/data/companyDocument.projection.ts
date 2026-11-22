import { APP_DATA_KEYS } from '../types/entityKeys.js';
import type { AppData } from '../types/entities.js';
import { isRecord } from '../lib/isRecord.js';
import { fail, hasOwn } from './companyDocument.errors.js';
import { FIELDS } from './companyDocument.fields.js';
import type { Row } from './companyDocument.fields.js';

/** Copy only the named portable fields for one already scoped account. */
export function projectCompanyData(data: AppData, accountId: string): AppData {
  const projected = {} as AppData;
  for (const key of APP_DATA_KEYS) {
    const source = data[key] as unknown[];
    if (!Array.isArray(source)) fail(`data.${key}`, 'must be a list');
    const selected =
      key === 'companies'
        ? source.filter((row): row is Row => isRecord(row) && row.id === accountId)
        : source.filter((row): row is Row => isRecord(row) && row.accountId === accountId);
    (projected as unknown as Record<string, unknown>)[key] = selected.map((input) => {
      const copy: Row = {};
      for (const field of FIELDS[key] as readonly string[]) {
        if (hasOwn(input, field)) {
          const fieldValue = input[field];
          copy[field] = Array.isArray(fieldValue)
            ? (fieldValue as unknown[]).map((item: unknown) => item)
            : fieldValue;
        }
      }
      return copy;
    });
  }
  return projected;
}
