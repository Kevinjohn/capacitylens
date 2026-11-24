import { describe, expect, it } from 'vitest';
import { seed } from './seed.js';
import {
  CompanyExportError,
  buildCompanyExport,
  parseCompanyExport,
  prepareCompanyImport,
} from './companyExport.js';
import { APP_DATA_KEYS } from '../types/entities.js';
import type { AppData, AppDataKey } from '../types/entities.js';
import type { CompanyExport } from './companyExport.js';
import { buildExampleCompany } from './exampleCompany.js';
import { buildInternalClient } from './internalClient.js';
import * as fixtures from './fixtures.js';

function requireValue<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('The complete beta fixture is missing a required row.');
  return value;
}

const context = { companyId: 'a-studio', memberResourceLinks: [] };
const freshDocument = () => {
  const source = seed();
  const company = requireValue(source.companies.find((row) => row.id === context.companyId));
  source.closures.push({
    id: 'gotham-closure',
    companyId: context.companyId,
    name: 'Gotham closure',
    startDate: '2026-12-25',
    endDate: '2026-12-25',
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  });
  return buildCompanyExport(source, { companyId: context.companyId, completeness: 'full' });
};
type CorruptDocument = (document: CompanyExport) => void;

const failures: [string, CorruptDocument][] = [
  [
    'zero-capacity placeholders',
    (doc) => {
      requireValue(
        doc.data.resources.find((row) => row.kind === 'placeholder'),
      ).workingHoursPerDay = 0;
    },
  ],
  [
    'supplementary placeholders',
    (doc) => {
      requireValue(doc.data.resources.find((row) => row.kind === 'placeholder')).engagement =
        'supplementary';
    },
  ],
  [
    'external discipline links',
    (doc) => {
      requireValue(doc.data.resources.find((row) => row.kind === 'external')).disciplineId =
        requireValue(doc.data.disciplines[0]).id;
    },
  ],
  ...(['placeholder', 'external'] as const).flatMap((kind) =>
    (['firstAvailableDate', 'lastAvailableDate'] as const).map(
      (field): [string, CorruptDocument] => [
        `${kind} ${field}`,
        (doc) => {
          requireValue(doc.data.resources.find((row) => row.kind === kind))[field] = '2026-10-20';
        },
      ],
    ),
  ),
  [
    'numeric strings',
    (doc) => {
      Object.assign(requireValue(doc.data.allocations[0]), { hoursPerDay: '8' });
    },
  ],
  [
    'control characters in identifiers',
    (doc) => {
      requireValue(doc.data.clients[0]).id = 'client\u0000id';
    },
  ],
  [
    'non-finite values',
    (doc) => {
      requireValue(doc.data.allocations[0]).hoursPerDay = Infinity;
    },
  ],
  [
    'invalid timestamps',
    (doc) => {
      requireValue(doc.data.clients[0]).updatedAt = '2026-02-30T12:00:00.000Z';
    },
  ],
  [
    'timestamps without milliseconds',
    (doc) => {
      requireValue(doc.data.clients[0]).updatedAt = '2026-11-24T10:11:12Z';
    },
  ],
  [
    'timestamps with a numeric offset',
    (doc) => {
      requireValue(doc.data.clients[0]).updatedAt = '2026-11-24T11:11:12.000+01:00';
    },
  ],
  [
    'reversed date ranges',
    (doc) => {
      requireValue(doc.data.allocations[0]).endDate = '2020-01-01';
    },
  ],
  [
    'boolean strings',
    (doc) => {
      Object.assign(requireValue(doc.data.companies[0]), { placeholdersEnabled: 'false' });
    },
  ],
  [
    'unsupported time zones',
    (doc) => {
      requireValue(doc.data.companies[0]).timezone = 'Gotham/Invalid';
    },
  ],
  [
    'repeated weekdays',
    (doc) => {
      requireValue(doc.data.resources[0]).workingDays = [1, 1];
    },
  ],
  [
    'half days outside working days',
    (doc) => {
      requireValue(doc.data.resources[0]).workingDays = [1];
      requireValue(doc.data.resources[0]).halfDays = [2];
    },
  ],
  [
    'unsafe avatars',
    (doc) => {
      requireValue(doc.data.resources[0]).avatarUrl =
        'https://bruce:secret@wayne.example/avatar.png';
    },
  ],
  [
    'unsupported text',
    (doc) => {
      requireValue(doc.data.companies[0]).name = 'Wayne\u0000Enterprises';
    },
  ],
  [
    'a missing phase project',
    (doc) => {
      requireValue(doc.data.phases[0]).projectId = 'missing-project';
    },
  ],
  [
    'activity kind/reference disagreement',
    (doc) => {
      requireValue(doc.data.activities[0]).kind = 'internal';
      requireValue(doc.data.activities[0]).projectId = requireValue(doc.data.projects[0]).id;
    },
  ],
  [
    'a missing allocation activity',
    (doc) => {
      requireValue(doc.data.allocations[0]).activityId = 'missing-activity';
    },
  ],
  [
    'a missing time-off resource',
    (doc) => {
      requireValue(doc.data.timeOff[0]).resourceId = 'missing-resource';
    },
  ],
  [
    'private Internal',
    (doc) => {
      requireValue(doc.data.clients.find((row) => row.builtin)).isPrivate = true;
    },
  ],
  [
    'renamed Internal',
    (doc) => {
      requireValue(doc.data.clients.find((row) => row.builtin)).name = 'Wayne Enterprises';
    },
  ],
  [
    'duplicate Internal',
    (doc) => {
      const row = requireValue(doc.data.clients.find((row) => row.builtin));
      doc.data.clients.push({ ...row, id: 'second-internal' });
    },
  ],
  [
    'a full private name without a code name',
    (doc) => {
      const row = requireValue(doc.data.clients.find((row) => !row.builtin));
      row.isPrivate = true;
      row.codeName = null;
    },
  ],
];

describe('company import failure boundaries', () => {
  it.each(['clients', 'projects'] as const)('retains the full-export name limit for %s', (key) => {
    const document = freshDocument();
    const row = requireValue(
      document.data[key].find((item) => key !== 'clients' || !('builtin' in item && item.builtin)),
    );
    row.name = 'N'.repeat(101);
    expect(() => prepareCompanyImport(document, context)).toThrow(/name/);
  });

  it('does not expand the public-name limit for redacted documents', () => {
    const document = { ...freshDocument(), completeness: 'redacted' as const };
    const row = requireValue(document.data.clients.find((item) => !item.builtin));
    row.name = 'N'.repeat(101);
    row.isPrivate = false;
    const file = JSON.stringify(document);
    expect(() => parseCompanyExport(file)).toThrow(/data\.clients\[\d+\]\.name/);
  });

  it('refuses a file whose rows name their company accountId', () => {
    const file = JSON.stringify(freshDocument()).replaceAll('"companyId":', '"accountId":');
    expect(() => parseCompanyExport(file)).toThrow(/data\.disciplines\[0\]\.companyId/);
  });

  it.each(['closure/one', '_closure', 'götham', 'x'.repeat(129)])(
    'refuses identifiers outside the typed planning route contract: %s',
    (id) => {
      const document = freshDocument();
      requireValue(document.data.closures[0]).id = id;
      expect(() => prepareCompanyImport(document, context)).toThrow(/id/);
    },
  );

  it('preserves the longest stable identifier accepted by typed planning routes', () => {
    const document = freshDocument();
    const id = `G${'a._~-9'.repeat(21)}0`;
    expect(id).toHaveLength(128);
    requireValue(document.data.closures[0]).id = id;
    expect(prepareCompanyImport(document, context).data.closures[0]?.id).toBe(id);
  });

  it.each(failures)('refuses %s without changing the supplied replacement', (_name, corrupt) => {
    const document = freshDocument();
    corrupt(document);
    const before = structuredClone(document);
    expect(() => prepareCompanyImport(document, context)).toThrow(CompanyExportError);
    expect(document).toEqual(before);
  });

  it.each(APP_DATA_KEYS)('rejects duplicate IDs in %s', (key) => {
    const document = freshDocument();
    const rows = document.data[key] as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    rows.push({ ...requireValue(rows[0]) });
    expect(() => prepareCompanyImport(document, context)).toThrow(/duplicates/i);
  });

  it.each([0, 1, 3, '2', null, undefined])(
    'rejects unsupported beta version %s',
    (schemaVersion) => {
      const document = { ...freshDocument(), schemaVersion };
      expect(() => parseCompanyExport(JSON.stringify(document))).toThrow(/schemaVersion/);
    },
  );

  it.each(APP_DATA_KEYS)('requires the complete %s table', (key: AppDataKey) => {
    const document = freshDocument();
    delete (document.data as Partial<typeof document.data>)[key];
    expect(() => prepareCompanyImport(document, context)).toThrow(new RegExp(`data.${key}`));
  });

  it('cannot supply destination scope or member links through document extras', () => {
    const document = { ...freshDocument(), companyId: 'a-loft', memberResourceLinks: [] };
    expect(() =>
      prepareCompanyImport(document, {
        companyId: 'a-studio',
        memberResourceLinks: [{ memberId: 'bruce-member', resourceId: 'missing-person' }],
      }),
    ).toThrow(/missing-person/);
    expect(() => prepareCompanyImport(document, undefined as never)).toThrow(/context/);
  });

  it('returns independent rows and working-day arrays for a prepared replacement', () => {
    const document = freshDocument();
    const before = structuredClone(document);
    const prepared = prepareCompanyImport(document, context);
    requireValue(prepared.data.companies[0]).name = 'Gotham Studio';
    requireValue(prepared.data.resources[0]).workingDays.push(0);
    expect(document).toEqual(before);
  });

  it.each(['clients', 'projects', 'resources', 'activities'] as const)(
    'refuses a deleted %s record and drops an empty deletedAt',
    (key) => {
      const deleted = freshDocument();
      Object.assign(requireValue(deleted.data[key][0]), { deletedAt: '2026-10-01T00:00:00.000Z' });
      expect(() => prepareCompanyImport(deleted, context)).toThrow(
        new RegExp(`data\\.${key}\\[0\\]\\.deletedAt`),
      );
      const empty = freshDocument();
      Object.assign(requireValue(empty.data[key][0]), { deletedAt: null });
      expect(prepareCompanyImport(empty, context).data[key][0]).not.toHaveProperty('deletedAt');
    },
  );

  it('projects access and device fields away rather than importing them', () => {
    const document = freshDocument();
    const input = {
      ...document,
      identities: [{ id: 'bruce-identity' }],
      sessions: [{ token: 'must-not-survive' }],
      memberships: [{ role: 'owner' }],
      activeAccountId: 'a-loft',
    };
    Object.assign(requireValue(input.data.companies[0]), {
      admissionPolicy: 'open',
      role: 'owner',
      theme: 'dark',
    });
    const prepared = prepareCompanyImport(input, context);
    expect(prepared.data).toEqual(freshDocument().data);
    expect(JSON.stringify(prepared)).not.toContain('must-not-survive');
    expect(prepared.data.companies[0]).not.toHaveProperty('admissionPolicy');
    expect(prepared.data.companies[0]).not.toHaveProperty('role');
    expect(prepared.data.companies[0]).not.toHaveProperty('theme');
  });
});

type Answer = 'accepted' | 'refused';

function answer(run: () => unknown): Answer {
  try {
    run();
    return 'accepted';
  } catch (error) {
    if (error instanceof CompanyExportError) return 'refused';
    throw error;
  }
}

const importCorrupted = (corrupt: CorruptDocument) => () =>
  answer(() => {
    const document = freshDocument();
    corrupt(document);
    prepareCompanyImport(document, context);
  });

const importCompany = (data: AppData, companyId: string) => () =>
  answer(() =>
    prepareCompanyImport(buildCompanyExport(data, { companyId, completeness: 'full' }), {
      companyId,
      memberResourceLinks: [],
    }),
  );

function buildExampleCompanyData(): AppData {
  const companyId = 'a-example';
  const now = '2031-09-17T10:00:00.000Z';
  const example = buildExampleCompany({ companyId, referenceDate: '2031-09-17', now });
  return {
    ...example,
    companies: [{ ...fixtures.FIXTURE_COMPANY, id: companyId, createdAt: now, updatedAt: now }],
    clients: [buildInternalClient(companyId, now), ...example.clients],
    closures: [],
  };
}

function buildFixtureCompanyData(): AppData {
  const company = fixtures.FIXTURE_COMPANY;
  return {
    companies: [company],
    disciplines: [fixtures.FIXTURE_DISCIPLINE],
    resources: [
      fixtures.FIXTURE_RESOURCE,
      fixtures.FIXTURE_RESOURCE_PERSON,
      fixtures.FIXTURE_RESOURCE_EXTERNAL,
    ],
    clients: [buildInternalClient(company.id, company.createdAt), fixtures.FIXTURE_CLIENT],
    projects: [fixtures.FIXTURE_PROJECT],
    phases: [fixtures.FIXTURE_PHASE],
    activities: [
      fixtures.FIXTURE_ACTIVITY,
      fixtures.FIXTURE_ACTIVITY_INTERNAL,
      fixtures.FIXTURE_ACTIVITY_ALL_PROJECTS,
    ],
    allocations: [fixtures.FIXTURE_ALLOCATION, fixtures.FIXTURE_ALLOCATION_ATTRIBUTED],
    timeOff: [fixtures.FIXTURE_TIME_OFF],
    closures: [fixtures.FIXTURE_CLOSURE],
  };
}

/**
 * The answers the import gave before it validated from the entity field table, recorded from the
 * validator at 1fce8c41d over every import fixture and every failure case in this file. The new
 * validator must give the same answer.
 */
const previousAnswers: [string, () => Answer, Answer][] = [
  ...seed().companies.map((company): [string, () => Answer, Answer] => [
    `the seed company ${company.id}`,
    importCompany(seed(), company.id),
    'accepted',
  ]),
  ['the seed company with a closure', importCorrupted(() => undefined), 'accepted'],
  ['the example company', importCompany(buildExampleCompanyData(), 'a-example'), 'accepted'],
  [
    'the fixture company',
    importCompany(buildFixtureCompanyData(), fixtures.FIXTURE_COMPANY.id),
    'accepted',
  ],
  ...failures.map(([name, corrupt]): [string, () => Answer, Answer] => [
    name,
    importCorrupted(corrupt),
    'refused',
  ]),
  ...(['clients', 'projects'] as const).map((key): [string, () => Answer, Answer] => [
    `a ${key} name over the full-export limit`,
    importCorrupted((doc) => {
      requireValue(doc.data[key].find((row) => !('builtin' in row && row.builtin))).name =
        'N'.repeat(101);
    }),
    'refused',
  ]),
  [
    'a public name over the limit in a redacted document',
    () =>
      answer(() => {
        const document = { ...freshDocument(), completeness: 'redacted' as const };
        const row = requireValue(document.data.clients.find((item) => !item.builtin));
        row.name = 'N'.repeat(101);
        row.isPrivate = false;
        parseCompanyExport(JSON.stringify(document));
      }),
    'refused',
  ],
  [
    'rows naming their company accountId',
    () =>
      answer(() =>
        parseCompanyExport(
          JSON.stringify(freshDocument()).replaceAll('"companyId":', '"accountId":'),
        ),
      ),
    'refused',
  ],
  ...['closure/one', '_closure', 'götham', 'x'.repeat(129)].map(
    (id): [string, () => Answer, Answer] => [
      `the identifier ${id}`,
      importCorrupted((doc) => {
        requireValue(doc.data.closures[0]).id = id;
      }),
      'refused',
    ],
  ),
  [
    'the longest identifier',
    importCorrupted((doc) => {
      requireValue(doc.data.closures[0]).id = `G${'a._~-9'.repeat(21)}0`;
    }),
    'accepted',
  ],
];

type TextRow = (data: AppData) => Record<string, unknown>;
const companyRow: TextRow = (data) => requireValue(data.companies[0]) as never;
const allocationRow: TextRow = (data) => requireValue(data.allocations[0]) as never;
const placeholderRow: TextRow = (data) =>
  requireValue(data.resources.find((row) => row.kind === 'placeholder')) as never;

/**
 * The cases the settled text rule changes: import applies the ordinary write path's text rule and
 * stores text as that path stores it (`cleanText`), so text it used to refuse only for not being
 * canonical now imports in its canonical form, and a blank placeholder name that ordinary writes
 * refuse is refused. Each row: the row and field, the supplied text, the previous and the current
 * answer, and the stored text when it imports.
 */
const textRuleChanges: [string, TextRow, string, string, Answer, Answer, string | null][] = [
  [
    'a name with doubled inner spacing',
    companyRow,
    'name',
    'Wayne  Enterprises',
    'refused',
    'accepted',
    'Wayne Enterprises',
  ],
  [
    'a name with surrounding spaces',
    companyRow,
    'name',
    ' Wayne Enterprises ',
    'refused',
    'accepted',
    'Wayne Enterprises',
  ],
  [
    'a name in decomposed Unicode',
    companyRow,
    'name',
    'Ge\u0301nosha',
    'refused',
    'accepted',
    'G\u00e9nosha',
  ],
  [
    'a name at the limit followed by a space',
    companyRow,
    'name',
    `${'N'.repeat(100)} `,
    'refused',
    'accepted',
    'N'.repeat(100),
  ],
  [
    'a name padded past the limit with inner spaces',
    companyRow,
    'name',
    `Wayne${' '.repeat(200)}Enterprises`,
    'refused',
    'accepted',
    'Wayne Enterprises',
  ],
  [
    'a note with three line breaks',
    allocationRow,
    'note',
    'Gotham\n\n\nMetropolis',
    'refused',
    'accepted',
    'Gotham\n\nMetropolis',
  ],
  [
    'a note with a tab',
    allocationRow,
    'note',
    'Gotham\tMetropolis',
    'refused',
    'accepted',
    'Gotham Metropolis',
  ],
  ['a blank task', allocationRow, 'task', '   ', 'refused', 'accepted', ''],
  ['an empty placeholder name', placeholderRow, 'name', '', 'accepted', 'refused', null],
];

function prepareWithText(row: TextRow, field: string, text: string) {
  const document = freshDocument();
  row(document.data)[field] = text;
  return prepareCompanyImport(document, context);
}

describe('company import answers against the previous validator', () => {
  it.each(previousAnswers)('gives the previous answer for %s', (_name, run, previous) => {
    expect(run()).toBe(previous);
  });

  it.each(textRuleChanges)(
    'changes the answer for %s under the write path text rule',
    (_name, row, field, text, previous, now) => {
      expect(previous).not.toBe(now);
      expect(answer(() => prepareWithText(row, field, text))).toBe(now);
    },
  );

  it.each(textRuleChanges.filter((change) => change[6] !== null))(
    'stores %s as ordinary writes store it',
    (_name, row, field, text, _previous, _now, stored) => {
      expect(row(prepareWithText(row, field, text).data)[field]).toBe(stored);
    },
  );
});
