import { describe, expect, it } from 'vitest';
import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import { emptyAppData } from '../types/entities.js';
import type {
  Activity,
  Allocation,
  AppData,
  Client,
  Closure,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '../types/entities.js';
import { remapAndValidateImport } from './importFold.js';

// The round-trip suites prove a clean import lands. This file feeds one deliberately broken row
// per repair branch and asserts the counters and the repaired row, which those suites never read.

const TS = '2026-01-01T00:00:00.000Z';
const NOW = '2026-11-01T09:00:00.000Z';
const SOURCE = 'a-source';
const TARGET = 'a-studio';

const meta = (id: unknown) => ({ id: id as ID, accountId: SOURCE, createdAt: TS, updatedAt: TS });
const discipline = (id: ID): Discipline => ({
  ...meta(id),
  name: 'Design',
  color: '#2d75da',
  sortOrder: 0,
});
const client = (id: ID, overrides: Partial<Client> = {}): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...meta(id),
  name: 'Gotham City',
  color: '#2d75da',
  ...overrides,
});
const project = (id: ID, overrides: Partial<Project> = {}): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...meta(id),
  name: 'Batcave refit',
  clientId: 'c1',
  color: '#2d75da',
  ...overrides,
});
const phase = (id: ID, projectId: ID): Phase => ({ ...meta(id), name: 'Discovery', projectId });
const person = (id: unknown, overrides: Partial<Resource> = {}): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...meta(id),
  kind: 'person',
  name: 'Bruce Wayne',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#2d75da',
  disciplineId: 'd1',
  ...overrides,
});
const activity = (id: ID, overrides: Partial<Activity> = {}): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id),
  name: 'Wireframes',
  kind: 'project',
  projectId: 'p1',
  phaseId: 'ph1',
  ...overrides,
});
const allocation = (id: ID, overrides: Partial<Allocation> = {}): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...meta(id),
  resourceId: 'r1',
  activityId: 't1',
  startDate: '2026-06-01',
  endDate: '2026-06-02',
  hoursPerDay: 8,
  status: 'confirmed',
  ...overrides,
});
const timeOff = (id: ID, overrides: Partial<TimeOff> = {}): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...meta(id),
  resourceId: 'r1',
  startDate: '2026-06-03',
  endDate: '2026-06-03',
  type: 'holiday',
  ...overrides,
});
const closure = (id: ID): Closure => ({
  ...meta(id),
  name: 'Gotham founders day',
  startDate: '2026-06-05',
  endDate: '2026-06-05',
});

// One valid row per table, all wired together.
function validIncoming(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [discipline('d1')],
    resources: [person('r1')],
    clients: [client('c1')],
    projects: [project('p1')],
    phases: [phase('ph1', 'p1')],
    activities: [activity('t1')],
    allocations: [allocation('al1')],
    timeOff: [timeOff('to1')],
    closures: [closure('cl1')],
  };
}

function importInto(incoming: AppData) {
  return remapAndValidateImport(emptyAppData(), TARGET, incoming, NOW);
}

function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

const userClients = (data: AppData) => data.clients.filter((row) => row.builtin !== true);

describe('remapAndValidateImport counts', () => {
  it('lands exactly one row per table from a valid import', () => {
    const { data, imported, skipped } = importInto(validIncoming());
    expect({ imported, skipped }).toEqual({ imported: 9, skipped: 0 });
    expect(data.disciplines).toHaveLength(1);
    expect(data.resources).toHaveLength(1);
    expect(userClients(data)).toHaveLength(1);
    expect(data.projects).toHaveLength(1);
    expect(data.phases).toHaveLength(1);
    expect(data.activities).toHaveLength(1);
    expect(data.allocations).toHaveLength(1);
    expect(data.timeOff).toHaveLength(1);
    expect(data.closures).toHaveLength(1);
  });

  it('counts built-in clients on neither side, but a stray builtin flag elsewhere on both', () => {
    const incoming = validIncoming();
    incoming.clients.push(client('c-internal', { builtin: true, name: 'Internal' }));
    incoming.projects.push({ ...project('p2'), builtin: true } as Project);
    const { imported, skipped } = importInto(incoming);
    expect({ imported, skipped }).toEqual({ imported: 10, skipped: 0 });
  });
});

describe('remapAndValidateImport ids', () => {
  it('gives a row with a non-string id a fresh id and keeps it', () => {
    const incoming = validIncoming();
    incoming.resources.push(person(42, { name: 'Clark Kent' }));
    const { data, imported } = importInto(incoming);
    const clark = only(data.resources.filter((row) => row.name === 'Clark Kent'));
    expect(typeof clark.id).toBe('string');
    expect(clark.id).not.toBe(only(data.resources.filter((row) => row.name === 'Bruce Wayne')).id);
    expect(imported).toBe(10);
  });

  it('binds references to the first of two rows sharing an id', () => {
    const incoming = validIncoming();
    incoming.resources.push(person('r1', { name: 'Clark Kent' }));
    const { data, resourceIdMap } = importInto(incoming);
    const bruce = only(data.resources.filter((row) => row.name === 'Bruce Wayne'));
    const clark = only(data.resources.filter((row) => row.name === 'Clark Kent'));
    expect(resourceIdMap.get('r1')).toBe(bruce.id);
    expect(clark.id).not.toBe(bruce.id);
    expect(only(data.allocations).resourceId).toBe(bruce.id);
    expect(only(data.timeOff).resourceId).toBe(bruce.id);
  });

  it('scrubs only deleted resources, leaving other deleted rows as imported', () => {
    const incoming = validIncoming();
    incoming.clients[0] = client('c1', { archivedAt: TS, deletedAt: TS });
    incoming.resources.push(person('r2', { name: 'Selina Kyle', archivedAt: TS, deletedAt: TS }));
    const { data } = importInto(incoming);
    expect(only(userClients(data)).name).toBe('Gotham City');
    const names = data.resources.map((row) => row.name);
    expect(names).toContain('Bruce Wayne');
    expect(names).not.toContain('Selina Kyle');
  });
});

describe('remapAndValidateImport hierarchy repair', () => {
  it('rebinds a project from a folded built-in client to the kept one', () => {
    const incoming = validIncoming();
    incoming.clients.push(
      client('internal-1', { builtin: true }),
      client('internal-2', { builtin: true }),
    );
    incoming.projects.push(project('p2', { name: 'Internal tooling', clientId: 'internal-2' }));
    const { data } = importInto(incoming);
    const builtins = data.clients.filter((row) => row.builtin === true);
    const kept = only(builtins);
    expect(only(data.projects.filter((row) => row.name === 'Internal tooling')).clientId).toBe(
      kept.id,
    );
  });

  it('drops a project whose client is unknown, with its phases', () => {
    const incoming = validIncoming();
    incoming.projects[0] = project('p1', { clientId: 'c-missing' });
    const { data } = importInto(incoming);
    expect(data.projects).toEqual([]);
    expect(data.phases).toEqual([]);
  });

  it('unbinds a dangling discipline or project on a resource and keeps valid ones', () => {
    const incoming = validIncoming();
    incoming.resources.push(
      person('r2', { name: 'Selina Kyle', disciplineId: 'd-missing' }),
      person('r3', { name: 'Harvey Dent', kind: 'placeholder', projectId: 'p-missing' }),
      person('r4', { name: 'Lucius Fox', kind: 'placeholder', projectId: 'p1' }),
    );
    const { data } = importInto(incoming);
    const byName = (name: string) => only(data.resources.filter((row) => row.name === name));
    expect(byName('Bruce Wayne').disciplineId).toBe(only(data.disciplines).id);
    expect(byName('Selina Kyle').disciplineId).toBeNull();
    expect(byName('Harvey Dent').projectId).toBeNull();
    expect(byName('Lucius Fox').projectId).toBe(only(data.projects).id);
  });

  it('keeps a project activity whose project is missing as a project-less repeatable', () => {
    const incoming = validIncoming();
    incoming.activities.push(activity('t2', { name: 'Orphan', projectId: 'p-missing' }));
    const { data } = importInto(incoming);
    expect(only(data.activities.filter((row) => row.name === 'Orphan'))).toMatchObject({
      kind: 'repeatable',
      projectId: null,
      phaseId: null,
    });
  });

  it('keeps a valid project and phase, and unbinds a dangling or foreign phase', () => {
    const incoming = validIncoming();
    incoming.projects.push(project('p2', { name: 'Arkham wing' }));
    incoming.phases.push(phase('ph2', 'p2'));
    incoming.activities.push(
      activity('t2', { name: 'Dangling phase', phaseId: 'ph-missing' }),
      activity('t3', { name: 'Foreign phase', phaseId: 'ph2' }),
    );
    const { data } = importInto(incoming);
    const byName = (name: string) => only(data.activities.filter((row) => row.name === name));
    const p1 = only(data.projects.filter((row) => row.name === 'Batcave refit'));
    const ph1 = only(data.phases.filter((row) => row.projectId === p1.id));
    expect(byName('Wireframes')).toMatchObject({
      kind: 'project',
      projectId: p1.id,
      phaseId: ph1.id,
    });
    expect(byName('Dangling phase')).toMatchObject({
      kind: 'project',
      projectId: p1.id,
      phaseId: null,
    });
    expect(byName('Foreign phase')).toMatchObject({
      kind: 'project',
      projectId: p1.id,
      phaseId: null,
    });
  });

  it('strips project and phase from internal and repeatable activities', () => {
    const incoming = validIncoming();
    incoming.activities.push(
      activity('t2', { name: 'Standup', kind: 'internal' }),
      activity('t3', { name: 'Code review', kind: 'repeatable' }),
    );
    const { data } = importInto(incoming);
    for (const [name, kind] of [
      ['Standup', 'internal'],
      ['Code review', 'repeatable'],
    ] as const) {
      expect(only(data.activities.filter((row) => row.name === name))).toMatchObject({
        kind,
        projectId: null,
        phaseId: null,
      });
    }
  });
});

describe('remapAndValidateImport booking repair', () => {
  function withRepeatable(allocationOverrides: Partial<Allocation>) {
    const incoming = validIncoming();
    incoming.activities.push(activity('t2', { name: 'Code review', kind: 'repeatable' }));
    incoming.allocations = [allocation('al1', { activityId: 't2', ...allocationOverrides })];
    return importInto(incoming).data;
  }

  it('keeps a valid attribution on a repeatable activity', () => {
    const data = withRepeatable({ projectId: 'p1' });
    expect(only(data.allocations).projectId).toBe(only(data.projects).id);
  });

  it('removes attribution to an unknown project but keeps the allocation', () => {
    const data = withRepeatable({ projectId: 'p-missing' });
    expect(only(data.allocations).projectId).toBeNull();
  });

  it('removes attribution when the activity does not allow it', () => {
    const incoming = validIncoming();
    incoming.activities.push(activity('t2', { name: 'Standup', kind: 'internal' }));
    incoming.allocations = [allocation('al1', { activityId: 't2', projectId: 'p1' })];
    expect(only(importInto(incoming).data.allocations).projectId).toBeNull();
  });

  it('keeps an internal hourly allocation at its hours and zeroes an external one', () => {
    const incoming = validIncoming();
    incoming.resources.push(person('ext1', { kind: 'external', name: 'Kord Industries' }));
    incoming.allocations.push(allocation('al2', { resourceId: 'ext1', hoursPerDay: 6 }));
    const { data, resourceIdMap } = importInto(incoming);
    const hoursOf = (resourceId: string) =>
      only(data.allocations.filter((row) => row.resourceId === resourceIdMap.get(resourceId)))
        .hoursPerDay;
    expect(hoursOf('r1')).toBe(8);
    expect(hoursOf('ext1')).toBe(0);
  });

  it('erases notes only on bookings of a deleted resource, keeping the rest of the row', () => {
    const incoming = validIncoming();
    incoming.resources.push(person('r2', { name: 'Selina Kyle', archivedAt: TS, deletedAt: TS }));
    incoming.allocations = [
      allocation('al1', { note: 'Gala prep' }),
      allocation('al2', { resourceId: 'r2', note: 'Cat burglary' }),
    ];
    incoming.timeOff = [
      timeOff('to1', { note: 'Wedding' }),
      timeOff('to2', { resourceId: 'r2', note: 'Private' }),
    ];
    const { data, resourceIdMap } = importInto(incoming);
    const allocationOf = (id: string) =>
      only(data.allocations.filter((row) => row.resourceId === resourceIdMap.get(id)));
    const timeOffOf = (id: string) =>
      only(data.timeOff.filter((row) => row.resourceId === resourceIdMap.get(id)));
    expect(allocationOf('r1').note).toBe('Gala prep');
    expect(allocationOf('r2')).toMatchObject({
      note: null,
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
      accountId: TARGET,
    });
    expect(timeOffOf('r1').note).toBe('Wedding');
    expect(timeOffOf('r2')).toMatchObject({ note: null, startDate: '2026-06-03', type: 'holiday' });
  });
});
