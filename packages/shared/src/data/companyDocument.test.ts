import { describe, expect, it } from 'vitest';
import { seed } from './seed.js';
import {
  COMPANY_EXPORT_FORMAT,
  COMPANY_EXPORT_SCHEMA_VERSION,
  CompanyDocumentError,
  buildCompanyExport,
  parseCompanyExport,
  prepareCompanyImport,
  serializeCompanyExport,
} from './companyDocument.js';
import { APP_DATA_KEYS } from '../types/entityKeys.js';
import { buildInternalClientId } from './internalClient.js';

const original = seed();
const companyId = original.companies[0]?.id ?? '';
const context = {
  companyId,
  memberResourceLinks: [{ memberId: 'member-1', resourceId: original.resources[0]?.id ?? '' }],
};
function fixture<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} in the test fixture`);
  return value;
}

describe('beta-native transfer', () => {
  it('round-trips the Internal client ID created for a new company', () => {
    const source = structuredClone(original);
    const internal = fixture(
      source.clients.find((row) => row.companyId === companyId && row.builtin),
      'Internal client',
    );
    internal.id = buildInternalClientId(companyId);
    const exported = buildCompanyExport(source, { companyId, completeness: 'full' });
    const parsed = parseCompanyExport(serializeCompanyExport(exported));
    expect(parsed.data.clients.find((row) => row.builtin)?.id).toBe(internal.id);
    expect(prepareCompanyImport(parsed, context).data.clients.find((row) => row.builtin)?.id).toBe(
      internal.id,
    );
  });

  it('round-trips every table, supported private content, archived rows, settings and IDs', () => {
    const source = structuredClone(original);
    const account = fixture(source.companies[0], 'account');
    account.name = 'Wayne Enterprises';
    source.closures.push({
      id: 'closure-wayne-shutdown',
      companyId,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      name: 'Wayne Foundation Day',
      startDate: '2026-12-25',
      endDate: '2026-12-25',
    });
    const privateClient = fixture(
      source.clients.find((row) => row.builtin !== true),
      'non-Internal client',
    );
    privateClient.isPrivate = true;
    privateClient.codeName = 'Project Bat';
    const privateProject = fixture(source.projects[0], 'project');
    privateProject.isPrivate = true;
    privateProject.codeName = 'Project Bat Project';
    const placeholder = fixture(
      source.resources.find((row) => row.kind === 'placeholder'),
      'placeholder resource',
    );
    const internalActivity = fixture(
      source.activities.find((row) => row.kind === 'internal'),
      'internal activity',
    );
    const templateBooking = fixture(source.allocations[0], 'allocation');
    source.allocations.push({
      ...templateBooking,
      id: 'a-placeholder-internal',
      resourceId: placeholder.id,
      activityId: internalActivity.id,
      projectId: null,
    });
    const templateTimeOff = fixture(source.timeOff[0], 'time-off row');
    source.timeOff.push({ ...templateTimeOff, id: 'to-placeholder', resourceId: placeholder.id });
    const archived = fixture(source.projects[0], 'project');
    archived.archivedAt = archived.updatedAt;
    const built = buildCompanyExport(source, { companyId, completeness: 'full' });
    const parsed = parseCompanyExport(serializeCompanyExport(built));
    const prepared = prepareCompanyImport(parsed, context);
    expect(prepared.data).toEqual(built.data);
    expect(buildCompanyExport(prepared.data, { companyId, completeness: 'full' }).data).toEqual(
      built.data,
    );
    expect(prepared.imported).toBe(APP_DATA_KEYS.reduce((n, key) => n + built.data[key].length, 0));
    expect(parsed.format).toBe(COMPANY_EXPORT_FORMAT);
    expect(parsed.schemaVersion).toBe(COMPANY_EXPORT_SCHEMA_VERSION);
    expect(parsed.data.companies[0]?.id).toBe(companyId);
    expect(built.data.closures).toHaveLength(1);
    expect(built.data.clients.find((row) => row.id === privateClient.id)?.codeName).toBe(
      'Project Bat',
    );
    expect(built.data.projects.find((row) => row.id === privateProject.id)?.codeName).toBe(
      'Project Bat Project',
    );
  });

  it('keeps the wire literals existing exports carry', () => {
    expect(COMPANY_EXPORT_FORMAT).toBe('capacitylens-beta');
    expect(COMPANY_EXPORT_SCHEMA_VERSION).toBe(2);
  });

  it('names the row company companyId in the file and in memory', () => {
    const json = serializeCompanyExport(
      buildCompanyExport(structuredClone(original), { companyId, completeness: 'full' }),
    );
    const wire = JSON.parse(json) as { data: { resources: Record<string, unknown>[] } };
    const wireRow = fixture(wire.data.resources[0], 'exported resource');
    expect(wireRow.companyId).toBe(companyId);

    const parsedRow = fixture(parseCompanyExport(json).data.resources[0], 'parsed resource');
    expect(parsedRow.companyId).toBe(companyId);
  });

  it('projects named portable fields while preserving source objects', () => {
    const source = structuredClone(original) as typeof original & {
      resources: Array<(typeof original.resources)[number] & { Vine?: string }>;
    };
    fixture(source.resources[0], 'resource').Vine = 'secret future property';
    const exported = buildCompanyExport(source, { companyId, completeness: 'full' });
    expect(exported.data.resources[0]).not.toHaveProperty('Vine');
    expect(source.resources[0]).toHaveProperty('Vine', 'secret future property');
  });

  it('rejects malformed data, missing nullable fields, duplicates, wrong scope and unsupported wrappers', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    const cases: Array<[string, (doc: typeof document) => void]> = [
      [
        'date',
        (doc) => {
          fixture(doc.data.allocations[0], 'allocation').startDate = '2026-02-30';
        },
      ],
      [
        'enum',
        (doc) => {
          fixture(doc.data.allocations[0], 'allocation').status = 'maybe' as never;
        },
      ],
      [
        'field',
        (doc) => {
          delete (doc.data.companies[0] as Partial<(typeof doc.data.companies)[0]>).dateStyle;
        },
      ],
      [
        'duplicate',
        (doc) => {
          doc.data.clients.push({ ...fixture(doc.data.clients[0], 'client') });
        },
      ],
      [
        'scope',
        (doc) => {
          fixture(doc.data.resources[0], 'resource').companyId = 'other-account';
        },
      ],
      [
        'reference',
        (doc) => {
          fixture(doc.data.projects[0], 'project').clientId = 'missing';
        },
      ],
      [
        'identifier',
        (doc) => {
          fixture(doc.data.resources[0], 'resource').id = 'resource id';
        },
      ],
      [
        'avatar URL',
        (doc) => {
          fixture(
            doc.data.resources.find((row) => row.kind === 'person'),
            'person resource',
          ).avatarUrl = 'https://user:pass@example.test/avatar.png';
        },
      ],
    ];
    for (const [name, corrupt] of cases) {
      const changed = structuredClone(document);
      corrupt(changed);
      expect(() => prepareCompanyImport(changed, context), name).toThrow(CompanyDocumentError);
    }
    expect(() => parseCompanyExport(JSON.stringify({ schemaVersion: 24, data: original }))).toThrow(
      CompanyDocumentError,
    );
  });

  it('accepts zero-hour planning allocations and keeps external resources on their domain defaults', () => {
    const source = structuredClone(original);
    fixture(source.allocations[0], 'allocation').hoursPerDay = 0;
    const document = buildCompanyExport(source, { companyId, completeness: 'full' });
    expect(
      document.data.allocations.find(({ id }) => id === source.allocations[0]?.id)?.hoursPerDay,
    ).toBe(0);
    const external = document.data.resources.find(({ kind }) => kind === 'external');
    expect(external?.workingHoursPerDay).toBe(8);
    const externalBooking = source.allocations.find(
      (row) =>
        source.resources.find((resource) => resource.id === row.resourceId)?.kind === 'external',
    );
    if (!externalBooking) throw new Error('Expected the fixture external allocation');
    externalBooking.hoursPerDay = 1;
    expect(() => buildCompanyExport(source, { companyId, completeness: 'full' })).toThrow(
      /zero hours/i,
    );
  });

  it('refuses serializer input containing a row from another account', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    const foreign = fixture(
      original.resources.find(({ companyId: owner }) => owner !== companyId),
      'foreign resource',
    );
    document.data.resources.push(structuredClone(foreign));
    expect(() => serializeCompanyExport(document)).toThrow(/companyId/i);
  });

  it('keeps malformed JSON errors display-safe while retaining the parser cause', () => {
    let error: unknown;
    try {
      parseCompanyExport('{"private":"do not echo"');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CompanyDocumentError);
    expect((error as Error).message).not.toContain('do not echo');
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('requires a full export and rejects redacted imports', () => {
    const redacted = buildCompanyExport(original, { companyId, completeness: 'redacted' });
    expect(() => prepareCompanyImport(redacted, context)).toThrow(/full/i);
  });

  it('restores an unchanged full document into a new company without changing scheduling IDs or links', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    const before = structuredClone(document);
    const destinationId = 'new-company';
    const prepared = prepareCompanyImport(document, { ...context, companyId: destinationId });
    expect(prepared.data.companies).toEqual([{ ...document.data.companies[0], id: destinationId }]);
    for (const key of APP_DATA_KEYS) {
      if (key === 'companies') continue;
      expect(prepared.data[key]).toEqual(
        document.data[key].map((row) => ({ ...row, companyId: destinationId })),
      );
    }
    expect(prepared.data.clients.find((row) => row.builtin)?.id).toBe(
      document.data.clients.find((row) => row.builtin)?.id,
    );
    expect(document).toEqual(before);
  });

  it('serializes a caller-projected redacted document without inventing names or exposing code names', () => {
    const source = structuredClone(original);
    const privateClient = fixture(
      source.clients.find((row) => row.builtin !== true),
      'non-Internal client',
    );
    privateClient.isPrivate = true;
    privateClient.name = 'Private alias';
    privateClient.codeName = null;
    const redacted = buildCompanyExport(source, { companyId, completeness: 'redacted' });
    const json = serializeCompanyExport(redacted);
    expect(json).toContain('"name": "Private alias"');
    expect(json).not.toContain('Private name');
    expect(
      parseCompanyExport(json).data.clients.find((row) => row.id === privateClient.id)?.codeName,
    ).toBeNull();
  });

  it('rejects an imported member link to a non-person resource', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    const external = document.data.resources.find((row) => row.kind === 'external');
    if (!external) throw new Error('Expected the fixture external resource');
    expect(() =>
      prepareCompanyImport(document, {
        companyId,
        memberResourceLinks: [{ memberId: 'member', resourceId: external.id }],
      }),
    ).toThrow(/resource/i);
  });

  it('requires placeholder bookings to resolve to their bound project', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    const placeholder = document.data.resources.find((row) => row.kind === 'placeholder');
    const differentProjectActivity = document.data.activities.find(
      (row) => row.kind === 'project' && row.projectId !== placeholder?.projectId,
    );
    const booking = document.data.allocations.find((row) => row.resourceId === placeholder?.id);
    if (!placeholder || !differentProjectActivity || !booking) {
      throw new Error('Expected a placeholder fixture booking');
    }
    booking.activityId = differentProjectActivity.id;
    booking.projectId = null;
    expect(() => prepareCompanyImport(document, context)).toThrow(/bound project/i);
  });

  it('rejects missing Internal client and dangling member resource links without mutation', () => {
    const document = buildCompanyExport(original, { companyId, completeness: 'full' });
    document.data.clients = document.data.clients.filter((row) => row.builtin !== true);
    const before = structuredClone(document);
    expect(() => prepareCompanyImport(document, context)).toThrow(/Internal/i);
    expect(document).toEqual(before);
    const valid = buildCompanyExport(original, { companyId, completeness: 'full' });
    expect(() =>
      prepareCompanyImport(valid, {
        ...context,
        memberResourceLinks: [{ memberId: 'm', resourceId: 'nope' }],
      }),
    ).toThrow(/resource/i);
  });
});
