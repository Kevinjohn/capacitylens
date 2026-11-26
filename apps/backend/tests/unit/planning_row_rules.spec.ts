import { test } from '@japa/runner';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { INTERNAL_CLIENT_COLOR } from '@capacitylens/shared/data/internalClient';
import { NEUTRAL_COLOR, PRESET_COLORS } from '@capacitylens/shared/lib/color';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings';
import { rowOutcome } from '#tests/helpers/unit/planning_operations';

const swatch = PRESET_COLORS[0]!;

/**
 * One row and the outcome the merged-row check gave it before the rules were shared: `accepted`,
 * or the first refusal's rule and sentence. The expectations were recorded from that check.
 */
const cases: Array<[string, AppDataKey, Record<string, unknown>, string]> = [
  ['name at the length limit', 'clients', { name: 'a'.repeat(MAX_NAME_LENGTH) }, 'accepted'],
  [
    'name over the length limit',
    'clients',
    { name: 'a'.repeat(MAX_NAME_LENGTH + 1) },
    'entityField: name is too long.',
  ],
  [
    'name with a control character',
    'clients',
    { name: 'Wayne\u0007' },
    'entityField: name contains unsupported characters.',
  ],
  ['blank name', 'clients', { name: '   ' }, 'entityField: name is required.'],
  [
    'blank placeholder name',
    'resources',
    { kind: 'placeholder', name: '' },
    'entityField: name is required.',
  ],
  ['text that is not a string', 'allocations', { task: 5 }, 'entityField: task must be text.'],
  ['note at the length limit', 'allocations', { note: 'a'.repeat(MAX_NOTE_LENGTH) }, 'accepted'],
  [
    'note over the length limit',
    'allocations',
    { note: 'a'.repeat(MAX_NOTE_LENGTH + 1) },
    'entityField: note is too long.',
  ],
  ['multiline note', 'allocations', { note: 'one\ntwo' }, 'accepted'],
  [
    'multiline task',
    'allocations',
    { task: 'one\ntwo' },
    'entityField: task contains unsupported characters.',
  ],
  ['zero hours', 'allocations', { hoursPerDay: 0 }, 'accepted'],
  ['24 hours', 'allocations', { hoursPerDay: 24 }, 'accepted'],
  [
    '24.01 hours',
    'allocations',
    { hoursPerDay: 24.01 },
    'entityField: hoursPerDay must be between 0 and 24.',
  ],
  [
    'negative hours',
    'allocations',
    { hoursPerDay: -1 },
    'entityField: hoursPerDay must be between 0 and 24.',
  ],
  [
    'infinite hours',
    'allocations',
    { hoursPerDay: Infinity },
    'entityField: hoursPerDay must be a finite number.',
  ],
  [
    'hours as text',
    'allocations',
    { hoursPerDay: '8' },
    'entityField: hoursPerDay must be a finite number.',
  ],
  [
    'zero working hours',
    'resources',
    { workingHoursPerDay: 0 },
    'entityField: workingHoursPerDay must be greater than 0 and at most 24.',
  ],
  ['24 working hours', 'resources', { workingHoursPerDay: 24 }, 'accepted'],
  [
    '24.01 working hours',
    'resources',
    { workingHoursPerDay: 24.01 },
    'entityField: workingHoursPerDay must be greater than 0 and at most 24.',
  ],
  [
    'fractional sort order',
    'disciplines',
    { sortOrder: 1.5 },
    'entityField: sortOrder must be a safe integer.',
  ],
  ['calendar date', 'allocations', { startDate: '2026-02-28' }, 'accepted'],
  [
    'impossible date',
    'allocations',
    { startDate: '2026-02-30' },
    'entityField: startDate must be a valid calendar date (YYYY-MM-DD).',
  ],
  [
    'duplicate weekday',
    'resources',
    { workingDays: [1, 1] },
    'entityField: workingDays must contain distinct weekdays from 0 to 6.',
  ],
  [
    'weekday out of range',
    'resources',
    { halfDays: [7] },
    'entityField: halfDays must contain distinct weekdays from 0 to 6.',
  ],
  [
    'no working day',
    'resources',
    { workingDays: [] },
    'entityField: workingDays must contain a working day.',
  ],
  [
    'no company working day',
    'companies',
    { workingDays: [] },
    'entityField: workingDays must contain a working day.',
  ],
  ['no half day', 'resources', { halfDays: [] }, 'accepted'],
  ['swatch colour', 'clients', { color: swatch }, 'accepted'],
  [
    'non-swatch colour',
    'clients',
    { color: '#123456' },
    'entityField: color must be a preset colour.',
  ],
  [
    'neutral colour on a person',
    'resources',
    { kind: 'person', color: NEUTRAL_COLOR },
    'entityField: color must be a preset colour.',
  ],
  [
    'neutral colour on an external',
    'resources',
    { kind: 'external', color: NEUTRAL_COLOR },
    'accepted',
  ],
  [
    'internal colour on the built-in client',
    'clients',
    { builtin: true, color: INTERNAL_CLIENT_COLOR },
    'accepted',
  ],
  [
    'internal colour on another client',
    'clients',
    { builtin: false, color: INTERNAL_CLIENT_COLOR },
    'accepted',
  ],
  ['https avatar', 'resources', { avatarUrl: 'https://example.com/clark.png' }, 'accepted'],
  [
    'http avatar',
    'resources',
    { avatarUrl: 'http://example.com/clark.png' },
    'resource_avatar_url_invalid: Avatar URL must be an HTTPS URL without embedded credentials.',
  ],
  ['supported time zone', 'companies', { timezone: 'Europe/London' }, 'accepted'],
  [
    'unknown time zone',
    'companies',
    { timezone: 'Mars/Gale' },
    'entityField: timezone must be a supported time zone.',
  ],
  ['Sunday week start', 'companies', { weekStartsOn: 0 }, 'accepted'],
  [
    'Tuesday week start',
    'companies',
    { weekStartsOn: 2 },
    'entityField: weekStartsOn must be Sunday or Monday.',
  ],
  ['allocation status', 'allocations', { status: 'tentative' }, 'accepted'],
  [
    'unknown allocation status',
    'allocations',
    { status: 'maybe' },
    'entityField: status is not supported.',
  ],
  ['activity kind', 'activities', { kind: 'allProjects' }, 'accepted'],
  [
    'activity kind on a resource',
    'resources',
    { kind: 'allProjects' },
    'entityField: kind is not supported.',
  ],
  ['unknown language', 'companies', { language: 'fr' }, 'entityField: language is not supported.'],
  [
    'boolean as text',
    'allocations',
    { ignoreWorkingDays: 'yes' },
    'entityField: ignoreWorkingDays must be a boolean.',
  ],
  ['identifier', 'allocations', { resourceId: 'r-clark' }, 'accepted'],
  [
    'empty identifier',
    'allocations',
    { resourceId: '' },
    'entityField: resourceId must be a bounded identifier.',
  ],
  [
    'identifier with a space',
    'allocations',
    { resourceId: 'r clark' },
    'entityField: resourceId must be a bounded identifier.',
  ],
  [
    'identifier over 256 characters',
    'allocations',
    { resourceId: 'r'.repeat(257) },
    'entityField: resourceId must be a bounded identifier.',
  ],
  ['null on a nullable field', 'allocations', { note: null }, 'accepted'],
  [
    'null on a required field',
    'allocations',
    { status: null },
    'entityField: status cannot be null.',
  ],
  ['unknown field', 'allocations', { colour: 'red' }, 'accepted'],
];

test.group('merged-row field rules', () => {
  for (const [name, table, row, expected] of cases) {
    test(name, async ({ assert }) => {
      assert.equal(await rowOutcome(table, row), expected);
    });
  }
});

/** The rules the row check shares with the company import: the one id rule and the timestamp rule. */
const sharedRuleCases: Array<[string, AppDataKey, Record<string, unknown>, string]> = [
  ['identifier of 128 characters', 'allocations', { resourceId: 'r'.repeat(128) }, 'accepted'],
  [
    'identifier over 128 characters',
    'allocations',
    { resourceId: 'r'.repeat(129) },
    'entityField: resourceId must be a bounded identifier.',
  ],
  [
    'identifier with a slash',
    'allocations',
    { resourceId: 'r/clark' },
    'entityField: resourceId must be a bounded identifier.',
  ],
  ['timestamp', 'allocations', { updatedAt: '2026-01-01T00:00:00.000Z' }, 'accepted'],
  [
    'timestamp on an impossible date',
    'allocations',
    { updatedAt: '2026-02-30T12:00:00.000Z' },
    'entityField: updatedAt must be a UTC timestamp with milliseconds.',
  ],
  [
    'timestamp without milliseconds',
    'allocations',
    { updatedAt: '2026-11-24T10:11:12Z' },
    'entityField: updatedAt must be a UTC timestamp with milliseconds.',
  ],
  [
    'timestamp in the year zero',
    'allocations',
    { updatedAt: '0000-01-01T00:00:00.000Z' },
    'entityField: updatedAt must be a UTC timestamp with milliseconds.',
  ],
  [
    'timestamp with an expanded year',
    'allocations',
    { updatedAt: '+010000-01-01T00:00:00.000Z' },
    'entityField: updatedAt must be a UTC timestamp with milliseconds.',
  ],
  ['null archive timestamp', 'clients', { archivedAt: null }, 'accepted'],
];

test.group('row rules shared with the company import', () => {
  for (const [name, table, row, expected] of sharedRuleCases) {
    test(name, async ({ assert }) => {
      assert.equal(await rowOutcome(table, row), expected);
    });
  }
});
