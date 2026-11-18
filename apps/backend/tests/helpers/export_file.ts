import { isRecord } from '@capacitylens/shared/lib/isRecord';

/**
 * Returns an export document as the browser posts it: the file's JSON, where each row names its
 * company `accountId`. It does not validate, so tests can still send deliberately broken documents.
 */
export function asExportFile<T>(document: T): T {
  if (!isRecord(document) || !isRecord(document.data)) return document;
  const data = Object.fromEntries(
    Object.entries(document.data).map(([key, rows]) => [
      key,
      Array.isArray(rows)
        ? rows.map((row: unknown) => {
            if (!isRecord(row) || !('companyId' in row)) return row;
            const { companyId, ...rest } = row;
            return { ...rest, accountId: companyId };
          })
        : rows,
    ])
  );
  return { ...document, data } as T;
}
