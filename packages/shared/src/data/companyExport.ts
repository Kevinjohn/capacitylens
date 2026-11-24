import { APP_DATA_KEYS, SCOPED_KEYS } from '../types/entityKeys.js';
import type { AppData, ScopedEntityKey } from '../types/entities.js';
import { isRecord } from '../lib/isRecord.js';
import { hasUsablePrivateCodeName } from '../domain/privateNames.js';
import { isEntityId } from '../types/entityFieldRules.js';
import { ENTITY_FIELDS } from '../types/entityFields.js';
import type { FieldSpec } from '../types/entityFields.js';
import { cleanText } from '../lib/strings.js';
import { assert, fail, isOneOf, hasOwn } from './companyExport.errors.js';
import { FIELDS } from './companyExport.fields.js';
import { projectCompanyData } from './companyExport.projection.js';
import { assertRow } from './companyExport.validation.js';
import { assertCompanyReferences } from './companyExport.references.js';
import { CompanyExportError } from './companyExport.errors.js';

export { CompanyExportError };

/** Stable identifier for the beta-native export format. */
export const COMPANY_EXPORT_FORMAT = 'capacitylens-beta' as const;
/** Beta export schema version, independent of the database schema. */
const RETIRED_DELETED_TABLES: ReadonlySet<string> = new Set([
  'clients',
  'projects',
  'resources',
  'activities',
]);

export const COMPANY_EXPORT_SCHEMA_VERSION = 2 as const;

export interface CompanyExport {
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

/** A validated full import, ready for an atomic company replacement. */
export interface PreparedCompanyImport {
  data: AppData;
  imported: number;
}

type Row = Record<string, unknown>;

// Checks the export shape and throws on the first fault.
function assertDocument(value: unknown): CompanyExport {
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
      hasOwn(value.data, key) && Array.isArray(value.data[key]),
      `data.${key}`,
      'table is required and must be a list',
    );
    (value.data[key] as unknown[]).forEach((row, i) =>
      assertRow(key, row, `data.${key}[${i}]`, { redacted: value.completeness === 'redacted' }),
    );
  }
  const data = {} as AppData;
  for (const key of APP_DATA_KEYS) {
    const rows = value.data[key] as Row[];
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (seen.has(row.id as string)) fail(`data.${key}[${i}].id`, 'duplicates a table id');
      seen.add(row.id as string);
      // Deleted catalogue records are no longer a state; importing one would bring it back active.
      if (
        RETIRED_DELETED_TABLES.has(key) &&
        row.deletedAt !== undefined &&
        row.deletedAt !== null
      ) {
        fail(`data.${key}[${i}].deletedAt`, 'deleted records are not supported');
      }
    });
    (data as unknown as Record<string, unknown>)[key] = rows.map((row) =>
      Object.fromEntries(
        FIELDS[key]
          .filter((field) => hasOwn(row, field))
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
  const companyRows = data.companies;
  assert(companyRows.length === 1, 'data.companies', 'must contain exactly one company');
  const scoped = APP_DATA_KEYS.filter((key) => key !== 'companies') as ScopedEntityKey[];
  const company = companyRows[0];
  assert(company, 'data.companies', 'must contain exactly one company');
  const companyId = company.id;
  for (const key of scoped) {
    data[key].forEach((row, i) =>
      assert(
        row.companyId === companyId,
        `data.${key}[${i}].companyId`,
        'does not match the exported company',
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
  assertCompanyReferences(data);
  return {
    format: COMPANY_EXPORT_FORMAT,
    schemaVersion: COMPANY_EXPORT_SCHEMA_VERSION,
    completeness: value.completeness as 'full' | 'redacted',
    data,
  };
}

/**
 * Build a portable projection for a company. The caller must authorize and redact the
 * supplied data before calling; completeness is metadata and does not grant visibility.
 */
export function buildCompanyExport(
  data: AppData,
  options: { companyId: string; completeness: 'full' | 'redacted' },
): CompanyExport {
  const document = {
    format: COMPANY_EXPORT_FORMAT,
    schemaVersion: COMPANY_EXPORT_SCHEMA_VERSION,
    completeness: options.completeness,
    data: projectCompanyData(data, options.companyId),
  };
  return assertDocument(document);
}

/** Serialize the named portable fields as formatted JSON after validating the entire document. */
export function serializeCompanyExport(document: CompanyExport): string {
  const validated = assertDocument(document);
  return JSON.stringify(validated, null, 2);
}

/** Parse and strictly validate a beta-native export, projecting away undeclared properties. */
export function parseCompanyExport(json: string): CompanyExport {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new CompanyExportError('document', 'is not valid JSON', { cause });
  }
  return assertDocument(raw);
}

/** Validate a full source document and bind its company scope to the selected destination. */
export function prepareCompanyImport(
  document: CompanyExport,
  context: CompanyImportContext,
): PreparedCompanyImport {
  assert(
    isRecord(context) &&
      isEntityId(context.companyId) &&
      Array.isArray(context.memberResourceLinks),
    'context',
    'companyId and memberResourceLinks are required',
  );
  const validated = assertDocument(document);
  assert(validated.completeness === 'full', 'completeness', 'only full exports can be imported');
  const data = validated.data;
  const importedCompany = data.companies[0];
  assert(importedCompany, 'data.companies', 'must contain exactly one company');
  // Validate source scope before rebinding; scheduling IDs and their relationships stay portable.
  importedCompany.id = context.companyId;
  for (const key of SCOPED_KEYS) {
    for (const row of data[key]) row.companyId = context.companyId;
  }
  // Store text as ordinary writes store it; a file this product exported is unchanged by this.
  for (const key of APP_DATA_KEYS) {
    const specs: Record<string, FieldSpec> = ENTITY_FIELDS[key];
    for (const row of data[key] as unknown as Row[]) {
      for (const [field, spec] of Object.entries(specs)) {
        const value = row[field];
        if ((spec.kind === 'text' || spec.kind === 'note') && typeof value === 'string') {
          row[field] = cleanText(value, { multiline: spec.kind === 'note' });
        }
      }
    }
  }
  const personIds = new Set(
    data.resources.filter((row) => row.kind === 'person').map((row) => row.id),
  );
  for (const [i, link] of context.memberResourceLinks.entries()) {
    assert(
      isRecord(link) && isEntityId(link.memberId) && isEntityId(link.resourceId),
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
