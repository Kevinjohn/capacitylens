import { APP_DATA_KEYS, SCOPED_KEYS } from '../types/entityKeys.js';
import type { AppData, ScopedEntityKey } from '../types/entities.js';
import { isRecord } from '../lib/isRecord.js';
import { hasUsablePrivateCodeName } from '../domain/privateNames.js';
import { assert, fail, isId, isOneOf, own } from './companyDocument.errors.js';
import { FIELDS } from './companyDocument.fields.js';
import { projectCompanyData } from './companyDocument.projection.js';
import { validateRow } from './companyDocument.validation.js';
import { validateCompanyReferences } from './companyDocument.references.js';
import { CompanyDocumentError } from './companyDocument.errors.js';

export { CompanyDocumentError };

/** Stable identifier for the beta-native interchange format. */
export const COMPANY_EXPORT_FORMAT = 'capacitylens-beta' as const;
/** Beta interchange schema version, independent of database and legacy export versions. */
export const COMPANY_EXPORT_SCHEMA_VERSION = 2 as const;

export interface CompanyExportDocument {
  format: typeof COMPANY_EXPORT_FORMAT;
  schemaVersion: typeof COMPANY_EXPORT_SCHEMA_VERSION;
  completeness: 'full' | 'redacted';
  data: AppData;
}

/** The destination facts needed to validate imported scheduling rows. */
export interface CompanyImportContext {
  companyId: string;
  memberResourceLinks: readonly { memberId: string; resourceId: string }[];
}

/** A validated full import, ready for an atomic account replacement. */
export interface PreparedCompanyImport {
  data: AppData;
  imported: number;
}

type Row = Record<string, unknown>;

/**
 * Renames each scoped row's company field; the export names it `accountId`, the domain `companyId`.
 * Anything that is not a well-formed table is passed through for validation to report.
 */
function renameScope(data: unknown, from: string, to: string): unknown {
  if (!isRecord(data)) return data;
  const renamed: Row = { ...data };
  for (const key of SCOPED_KEYS) {
    const rows = data[key];
    if (!Array.isArray(rows)) continue;
    renamed[key] = rows.map((row: unknown) => {
      if (!isRecord(row) || !own(row, from)) return row;
      const { [from]: companyId, ...rest } = row;
      return { ...rest, [to]: companyId };
    });
  }
  return renamed;
}

function toWire(document: unknown): unknown {
  if (!isRecord(document)) return document;
  return { ...document, data: renameScope(document.data, 'companyId', 'accountId') };
}

function fromWire(document: CompanyExportDocument): CompanyExportDocument {
  return {
    ...document,
    data: renameScope(document.data, 'accountId', 'companyId') as AppData,
  };
}

// Validates the interchange shape: the returned rows still carry `accountId`.

function validateDocument(value: unknown): CompanyExportDocument {
  assert(isRecord(value), 'document', 'must be an object');
  assert(
    value.format === COMPANY_EXPORT_FORMAT,
    'format',
    'is not a beta-native CapacityLens export',
  );
  assert(value.schemaVersion === COMPANY_EXPORT_SCHEMA_VERSION, 'schemaVersion', 'is unsupported');
  assert(
    isOneOf(value.completeness, ['full', 'redacted']),
    'completeness',
    'must be full or redacted',
  );
  assert(isRecord(value.data), 'data', 'must be an object');
  for (const key of APP_DATA_KEYS) {
    assert(
      own(value.data, key) && Array.isArray(value.data[key]),
      `data.${key}`,
      'table is required and must be a list',
    );
    (value.data[key] as unknown[]).forEach((row, i) =>
      validateRow(key, row, `data.${key}[${i}]`, { redacted: value.completeness === 'redacted' }),
    );
  }
  const data = {} as AppData;
  for (const key of APP_DATA_KEYS) {
    const rows = value.data[key] as Row[];
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (seen.has(row.id as string)) fail(`data.${key}[${i}].id`, 'duplicates a table id');
      seen.add(row.id as string);
    });
    (data as unknown as Record<string, unknown>)[key] = rows.map((row) =>
      Object.fromEntries(
        (FIELDS[key] as readonly string[])
          .filter((field) => own(row, field))
          .map((field) => {
            const fieldValue = row[field];
            return [
              field,
              Array.isArray(fieldValue)
                ? (fieldValue as unknown[]).map((item: unknown) => item)
                : fieldValue,
            ];
          }),
      ),
    );
  }
  const accountRows = data.accounts;
  assert(accountRows.length === 1, 'data.accounts', 'must contain exactly one account');
  const scoped = APP_DATA_KEYS.filter((key) => key !== 'accounts') as ScopedEntityKey[];
  const account = accountRows[0];
  assert(account, 'data.accounts', 'must contain exactly one account');
  const accountId = account.id;
  for (const key of scoped) {
    (data[key] as unknown as Array<{ accountId: string }>).forEach((row, i) =>
      assert(
        row.accountId === accountId,
        `data.${key}[${i}].accountId`,
        'does not match the exported account',
      ),
    );
  }
  if (value.completeness === 'full') {
    for (const key of ['clients', 'projects'] as const) {
      data[key].forEach((row, i) => {
        if (row.isPrivate === true) {
          assert(
            hasUsablePrivateCodeName(row as unknown as Record<string, unknown>),
            `data.${key}[${i}].codeName`,
            'a full private export must include its code name',
          );
        }
      });
    }
  }
  validateCompanyReferences(data);
  return {
    format: COMPANY_EXPORT_FORMAT,
    schemaVersion: COMPANY_EXPORT_SCHEMA_VERSION,
    completeness: value.completeness as 'full' | 'redacted',
    data,
  };
}

/**
 * Build a portable projection for an account. The caller must authorize and redact the
 * supplied data before calling; completeness is metadata and does not grant visibility.
 */
export function buildCompanyExport(
  data: AppData,
  options: { companyId: string; completeness: 'full' | 'redacted' },
): CompanyExportDocument {
  const document = {
    format: COMPANY_EXPORT_FORMAT,
    schemaVersion: COMPANY_EXPORT_SCHEMA_VERSION,
    completeness: options.completeness,
    data: projectCompanyData(
      renameScope(data, 'companyId', 'accountId') as AppData,
      options.companyId,
    ),
  };
  return fromWire(validateDocument(document));
}

/** Serialize the named portable fields as formatted JSON after validating the entire document. */
export function serializeCompanyExport(document: CompanyExportDocument): string {
  const validated = validateDocument(toWire(document));
  return JSON.stringify(validated, null, 2);
}

/** Parse and strictly validate a beta-native export, projecting away undeclared properties. */
export function parseCompanyExport(json: string): CompanyExportDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new CompanyDocumentError('document', 'is not valid JSON', { cause });
  }
  return fromWire(validateDocument(raw));
}

/** Validate a full source document and bind its company scope to the selected destination. */
export function prepareCompanyImport(
  document: CompanyExportDocument,
  context: CompanyImportContext,
): PreparedCompanyImport {
  assert(
    isRecord(context) && isId(context.companyId) && Array.isArray(context.memberResourceLinks),
    'context',
    'companyId and memberResourceLinks are required',
  );
  const validated = fromWire(validateDocument(toWire(document)));
  assert(validated.completeness === 'full', 'completeness', 'only full exports can be imported');
  const data = validated.data;
  const importedAccount = data.accounts[0];
  assert(importedAccount, 'data.accounts', 'must contain exactly one account');
  // Validate source scope before rebinding; scheduling IDs and their relationships stay portable.
  importedAccount.id = context.companyId;
  for (const key of SCOPED_KEYS) {
    for (const row of data[key]) row.companyId = context.companyId;
  }
  const personIds = new Set(
    data.resources.filter((row) => row.kind === 'person').map((row) => row.id),
  );
  for (const [i, link] of context.memberResourceLinks.entries()) {
    assert(
      isRecord(link) && isId(link.memberId) && isId(link.resourceId),
      `context.memberResourceLinks[${i}]`,
      'requires memberId and resourceId',
    );
    assert(
      personIds.has(link.resourceId),
      `context.memberResourceLinks[${i}].resourceId`,
      `resource id ${link.resourceId} does not identify an imported person`,
    );
  }
  let imported = 0;
  for (const key of APP_DATA_KEYS) imported += data[key].length;
  return { data, imported };
}
