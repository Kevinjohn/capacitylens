import { describe, expect, it, vi } from 'vitest';
import { seed } from './seed.js';
import { buildCompanyExport, prepareCompanyImport } from './companyExport.js';
import type { CompanyExport } from './companyExport.js';

// A value that exists only in the shared lists below. Import validation must accept it, which it
// can only do by reading the shared list rather than a copy of its values.
const { ADDED } = vi.hoisted(() => ({ ADDED: 'added-by-test' }));

vi.mock('../types/entityTypes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../types/entityTypes.js')>();
  return {
    ...actual,
    SCHEDULING_MODES: [...actual.SCHEDULING_MODES, ADDED],
    CAPACITY_OVERVIEW_ACCESS_VALUES: [...actual.CAPACITY_OVERVIEW_ACCESS_VALUES, ADDED],
    DATE_STYLES: [...actual.DATE_STYLES, ADDED],
    EMPLOYMENT_TYPES: [...actual.EMPLOYMENT_TYPES, ADDED],
    RESOURCE_ENGAGEMENTS: [...actual.RESOURCE_ENGAGEMENTS, ADDED],
    ALLOCATION_STATUSES: [...actual.ALLOCATION_STATUSES, ADDED],
    TIME_OFF_TYPES: [...actual.TIME_OFF_TYPES, ADDED],
  };
});

const context = { companyId: 'a-studio', memberResourceLinks: [] };

function firstRow<T>(
  rows: T[],
  matches: (row: T) => boolean = () => true,
): Record<string, unknown> {
  const row = rows.find(matches);
  if (!row) throw new Error('The seed is missing a row this test edits.');
  return row as Record<string, unknown>;
}

const cases: [string, (doc: CompanyExport) => Record<string, unknown>][] = [
  ['companies.schedulingMode', (doc) => firstRow(doc.data.companies)],
  ['companies.capacityOverviewAccess', (doc) => firstRow(doc.data.companies)],
  ['companies.dateStyle', (doc) => firstRow(doc.data.companies)],
  ['resources.employmentType', (doc) => firstRow(doc.data.resources, (r) => r.kind === 'person')],
  ['resources.engagement', (doc) => firstRow(doc.data.resources, (r) => r.kind === 'person')],
  ['allocations.status', (doc) => firstRow(doc.data.allocations)],
  ['timeOff.type', (doc) => firstRow(doc.data.timeOff)],
];

describe('company import enum fields', () => {
  it.each(cases)('reads the allowed values of %s from the shared list', (path, pick) => {
    const document = buildCompanyExport(seed(), {
      companyId: context.companyId,
      completeness: 'full',
    });
    const field = path.split('.')[1] as string;
    pick(document)[field] = ADDED;
    expect(() => prepareCompanyImport(document, context)).not.toThrow();
  });
});
