import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import { makeResourceDraft, requireValue, resetStoreWithAccount } from '@/test/fixtures';

const s = () => useStore.getState();

beforeEach(async () => {
  await resetStoreWithAccount();
  s().clearFilters();
});

const personDraft = makeResourceDraft({ name: 'Person', role: 'Dev', color: '#1' });

// Omit the shared draft's false default to cover resources without the optional favourite flag.
const unflaggedDraft = { ...personDraft };
delete unflaggedDraft.isFavourite;

function registerStoreCrudEntity1(): void {
  it('accounts: update', async () => {
    const account = requireValue(s().data.accounts[0], 'account');
    await s().updateAccount(account.id, { name: 'Renamed company' });
    expect(s().data.accounts[0]?.name).toBe('Renamed company');
  });
}

function registerStoreCrudEntity2(): void {
  it('accounts: stores working days and keeps the update undoable', async () => {
    const account = requireValue(s().data.accounts[0], 'account');
    await s().updateAccount(account.id, { workingDays: [1, 3, 5] });
    expect(s().data.accounts[0]?.workingDays).toEqual([1, 3, 5]);

    await s().updateAccount(account.id, { workingDays: [2, 4] });
    await s().undoPlanning();
    expect(s().data.accounts.find((candidate) => candidate.id === account.id)?.workingDays).toEqual(
      [1, 3, 5],
    );
    await s().redoPlanning();
    expect(s().data.accounts.find((candidate) => candidate.id === account.id)?.workingDays).toEqual(
      [2, 4],
    );
  });
}

function registerStoreCrudEntity3(): void {
  it('disciplines: add / update / delete', async () => {
    const d = await requireCreated(
      s().addDiscipline({ name: 'Design', color: '#1', sortOrder: 0 }),
    );
    await s().updateDiscipline(d.id, { name: 'Design 2' });
    expect(s().data.disciplines[0]?.name).toBe('Design 2');
    await s().deleteDiscipline(d.id);
    expect(s().data.disciplines).toHaveLength(0);
  });

  // Clients/projects/resources use archive/restore rather than immediate hard deletion. These
  // cover add/update; lifecycle tests cover archive/restore separately.
}

function registerStoreCrudEntity4(): void {
  it('clients: add / update', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    await s().updateClient(c.id, { name: 'Ferris 2' });
    expect(s().data.clients[0]?.name).toBe('Ferris 2');
  });
}

function registerStoreCrudEntity5(): void {
  it('projects: add / update', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    await s().updateProject(p.id, { name: 'P2' });
    expect(s().data.projects[0]?.name).toBe('P2');
  });
}

function registerStoreCrudEntity7(): void {
  it('phases: add / update / delete', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    const ph = await requireCreated(s().addPhase({ name: 'Discovery', projectId: p.id }));
    await s().updatePhase(ph.id, { name: 'Disco' });
    expect(s().data.phases[0]?.name).toBe('Disco');
    await s().deletePhase(ph.id);
    expect(s().data.phases).toHaveLength(0);
  });
}

function registerStoreCrudEntity8(): void {
  it('activities: add / update / delete', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    const t = await requireCreated(
      s().addActivity({ name: 'T', kind: 'project', projectId: p.id }),
    );
    await s().updateActivity(t.id, { name: 'T2' });
    expect(s().data.activities[0]?.name).toBe('T2');
    await s().deleteActivity(t.id);
    expect(s().data.activities).toHaveLength(1);
    expect(s().data.activities[0]?.id).toBe(t.id);
    expect(typeof s().data.activities[0]?.archivedAt).toBe('string');
  });
}

function registerStoreCrudEntity9(): void {
  it('activities: a general (no-project) activity can be added without a projectId', async () => {
    const t = await requireCreated(s().addActivity({ name: 'Admin', kind: 'repeatable' }));
    expect(t.projectId).toBeNull();
    expect(requireValue(s().data.activities[0], 'activity')).toHaveProperty('projectId', null);
    expect(s().data.activities[0]?.name).toBe('Admin');
  });
}

function registerStoreCrudEntity10(): void {
  it('activities: a project-specific activity converts to all-projects by clearing its project + kind together', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    const t = await requireCreated(
      s().addActivity({ name: 'T', kind: 'project', projectId: p.id }),
    );
    await s().updateActivity(t.id, { kind: 'repeatable', projectId: null });
    expect(s().data.activities[0]?.kind).toBe('repeatable');
    expect(requireValue(s().data.activities[0], 'activity')).toHaveProperty('projectId', null);
  });
}

function registerStoreCrudEntity13(): void {
  it('updateActivity preserves the project for a phase-only patch', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p1 = await requireCreated(s().addProject({ name: 'P1', clientId: c.id, color: '#2' }));
    const ph1 = await requireCreated(s().addPhase({ name: 'Disco', projectId: p1.id }));
    const t = await requireCreated(
      s().addActivity({
        name: 'T',
        kind: 'project',
        projectId: p1.id,
        phaseId: ph1.id,
      }),
    );

    await expect(s().updateActivity(t.id, { phaseId: ph1.id })).resolves.toBeUndefined();
    expect(s().data.activities[0]).toMatchObject({ projectId: p1.id, phaseId: ph1.id });
  });
}

function registerStoreCrudEntity14(): void {
  it('resources: add / update', async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await s().updateResource(r.id, { role: 'Lead' });
    expect(s().data.resources[0]?.role).toBe('Lead');
  });
}

function registerStoreCrudEntity15(): void {
  it('resources: defaults legacy people and placeholders to Studio engagement', async () => {
    const legacyPersonDraft = { ...personDraft };
    delete legacyPersonDraft.engagement;
    const person = await requireCreated(s().addResource(legacyPersonDraft));
    expect(person.engagement).toBe('studio');

    const client = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const project = await requireCreated(
      s().addProject({ name: 'Project', clientId: client.id, color: '#2' }),
    );
    const placeholder = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: 'placeholder',
        projectId: project.id,
      }),
    );
    expect(placeholder.engagement).toBe('studio');
  });
}

function registerStoreCrudEntity16(): void {
  it('resources: favourite updates are account data and undoable', async () => {
    const resource = await requireCreated(s().addResource({ ...unflaggedDraft }));

    await s().updateResource(resource.id, { isFavourite: true });
    expect(s().data.resources[0]?.isFavourite).toBe(true);

    await s().undoPlanning();
    expect(requireValue(s().data.resources[0], 'resource')).toHaveProperty('isFavourite', null);
  });
}

function registerStoreCrudEntity17(): void {
  it('resources: a viewer cannot change an account favourite', async () => {
    const resource = await requireCreated(s().addResource({ ...unflaggedDraft }));

    s().setActiveRole('viewer');
    await s().updateResource(resource.id, { isFavourite: true });

    expect(requireValue(s().data.resources[0], 'resource')).toHaveProperty('isFavourite', null);
    expect(s().notice).toMatchObject({ tone: 'error' });
  });
}

function registerStoreCrudEntity18(): void {
  it('allocations: add / update / delete', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    const t = await requireCreated(
      s().addActivity({ name: 'T', kind: 'project', projectId: p.id }),
    );
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    expect(await s().updateAllocation(a.id, { hoursPerDay: 4, status: 'tentative' })).toBe(true);
    expect(s().data.allocations[0]).toMatchObject({
      hoursPerDay: 4,
      status: 'tentative',
    });
    await s().deleteAllocation(a.id);
    expect(s().data.allocations).toHaveLength(0);
  });
}

function registerStoreCrudEntity19(): void {
  it('time off: add / update / delete', async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const to = await requireCreated(
      s().addTimeOff({
        resourceId: r.id,
        startDate: '2026-06-10',
        endDate: '2026-06-11',
        type: 'holiday',
      }),
    );
    await s().updateTimeOff(to.id, { type: 'sick' });
    expect(s().data.timeOff[0]?.type).toBe('sick');
    await s().deleteTimeOff(to.id);
    expect(s().data.timeOff).toHaveLength(0);
  });
}

function registerStoreCrudEntity20(): void {
  it('company closure: add / update / delete', async () => {
    const closure = await requireCreated(
      s().addClosure({
        name: 'Christmas shutdown',
        startDate: '2026-12-24',
        endDate: '2026-12-25',
      }),
    );
    await s().updateClosure(closure.id, { name: 'Winter shutdown' });
    expect(s().data.closures[0]).toMatchObject({ name: 'Winter shutdown' });
    await s().deleteClosure(closure.id);
    expect(s().data.closures).toHaveLength(0);
  });
}

describe('store CRUD covers every entity', () => {
  registerStoreCrudEntity1();
  registerStoreCrudEntity2();
  registerStoreCrudEntity3();
  registerStoreCrudEntity4();
  registerStoreCrudEntity5();
  registerStoreCrudEntity7();
  registerStoreCrudEntity8();
  registerStoreCrudEntity9();
  registerStoreCrudEntity10();
  registerStoreCrudEntity13();
  registerStoreCrudEntity14();
  registerStoreCrudEntity15();
  registerStoreCrudEntity16();
  registerStoreCrudEntity17();
  registerStoreCrudEntity18();
  registerStoreCrudEntity19();
  registerStoreCrudEntity20();
});

describe('store UI + history extras', () => {
  it('selectAllocation, setOriginDate and goToToday', () => {
    s().selectAllocation('abc');
    expect(s().ui.selectedAllocationId).toBe('abc');
    s().setOriginDate('2026-01-01');
    expect(s().ui.originDate).toBe('2026-01-01');
    s().goToToday();
    expect(s().ui.originDate).not.toBe('2026-01-01');
  });

  it('undo/redo are no-ops on empty history', async () => {
    await expect(s().undoPlanning()).resolves.toBe(false);
    await expect(s().redoPlanning()).resolves.toBe(false);
    expect(s().data.clients).toHaveLength(0);
  });

  it('a new mutation clears the redo stack', async () => {
    await s().addClient({ name: 'A', color: '#1' });
    await s().undoPlanning();
    expect(s().planning.history.future).toHaveLength(1);
    await s().addClient({ name: 'B', color: '#2' });
    expect(s().planning.history.future).toHaveLength(0);
  });

  it('bounds typed history at 50 entries and drops the oldest entries', async () => {
    for (let index = 0; index < 60; index += 1) {
      await s().addClient({ name: `Client ${index}`, color: '#1' });
    }

    expect(s().planning.history.past).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) await s().undoPlanning();
    expect(s().data.clients.filter((client) => client.archivedAt === null)).toHaveLength(10);
    expect(s().planning.history.past).toHaveLength(0);

    expect(await s().undoPlanning()).toBe(false);
    expect(s().data.clients.filter((client) => client.archivedAt === null)).toHaveLength(10);
  });

  it('informs a viewer when undo and redo are refused', async () => {
    await s().addClient({ name: 'A', color: '#1' });
    await s().undoPlanning();
    const afterUndo = s().data;
    const futureAfterUndo = s().planning.history.future;

    s().setActiveRole('viewer');
    expect(await s().redoPlanning()).toBe(false);
    expect(s().data).toBe(afterUndo);
    expect(s().planning.history.future).toBe(futureAfterUndo);
    expect(s().notice).toMatchObject({ tone: 'error' });

    s().setActiveRole('editor');
    await s().redoPlanning();
    const afterRedo = s().data;
    const pastAfterRedo = s().planning.history.past;
    s().setNotice(null);
    s().setActiveRole('viewer');
    expect(await s().undoPlanning()).toBe(false);
    expect(s().data).toBe(afterRedo);
    expect(s().planning.history.past).toBe(pastAfterRedo);
    expect(s().notice).toMatchObject({ tone: 'error' });
  });
});

const seedAlloc = async () => {
  const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#111111' }));
  const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#222222' }));
  const t = await requireCreated(s().addActivity({ name: 'T', kind: 'project', projectId: p.id }));
  const r = await requireCreated(s().addResource({ ...personDraft }));
  return { r, t };
};

function registerDateRangeGuard2(): void {
  it('preserves a valid 24-hour allocation', async () => {
    const { r, t } = await seedAlloc();
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 24,
        status: 'confirmed',
      }),
    );
    expect(a.hoursPerDay).toBe(24);
    expect(s().data.allocations[0]?.hoursPerDay).toBe(24);
  });
}

function registerDateRangeGuard3(): void {
  it('updateAllocation applies a status-only patch while retaining dates', async () => {
    const { r, t } = await seedAlloc();
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    await s().updateAllocation(a.id, { status: 'tentative' });
    expect(s().data.allocations[0]?.status).toBe('tentative');

    expect(s().data.allocations[0]?.endDate).toBe('2026-06-03');
  });
}

function registerDateRangeGuard7(): void {
  it('defaults placeholder working patterns on add', async () => {
    const client = await requireCreated(
      s().addClient({ name: 'Wayne Enterprises', color: '#737373' }),
    );
    const project = await requireCreated(
      s().addProject({ name: 'Watchtower', clientId: client.id, color: '#737373' }),
    );
    const resource = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: 'placeholder',
        projectId: project.id,
      }),
    );

    expect(resource).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
  });
}

describe('store allocation and resource defaults', () => {
  registerDateRangeGuard2();
  registerDateRangeGuard3();
  registerDateRangeGuard7();
});

function registerMergedRow1(): void {
  it('a normal-resource note/date-only updateAllocation + updateTimeOff still succeed (no false reject)', async () => {
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p = await requireCreated(s().addProject({ name: 'P', clientId: c.id, color: '#2' }));
    const t = await requireCreated(
      s().addActivity({ name: 'T', kind: 'project', projectId: p.id }),
    );
    const r = await requireCreated(s().addResource({ ...personDraft }));
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );

    await s().updateAllocation(a.id, { note: 'ping' });
    await s().updateAllocation(a.id, { startDate: '2026-06-02' });
    expect(s().data.allocations[0]?.note).toBe('ping');
    expect(s().data.allocations[0]?.startDate).toBe('2026-06-02');

    const to = await requireCreated(
      s().addTimeOff({
        resourceId: r.id,
        startDate: '2026-06-10',
        endDate: '2026-06-11',
        type: 'holiday',
      }),
    );
    await expect(s().updateTimeOff(to.id, { type: 'sick' })).resolves.toBeUndefined();
    await expect(s().updateTimeOff(to.id, { startDate: '2026-06-09' })).resolves.toBeUndefined();
    expect(s().data.timeOff[0]?.type).toBe('sick');
  });
}

describe('update* applies ordinary server rows', () => {
  registerMergedRow1();
});

function registerColourSnap3(): void {
  it('an external resource keeps NEUTRAL_COLOR (the one deliberate non-preset exception) instead of snapping', async () => {
    const NEUTRAL_COLOR = '#9ca3af';
    const ext = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: 'external',
        color: NEUTRAL_COLOR,
      }),
    );
    expect(ext.color).toBe(NEUTRAL_COLOR);
  });
}

function registerColourSnap5(): void {
  it('a colourless patch leaves the stored colour untouched', async () => {
    const client = await requireCreated(s().addClient({ name: 'Ferris', color: '#7adae3' }));
    await s().updateClient(client.id, { name: 'Ferris 2' });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe('#7adae3');
  });
}

function registerColourSnap6(): void {
  it('a viewer cannot add a client', async () => {
    s().setActiveRole('viewer');
    const returned = await s().addClient({ name: 'Ferris', color: '#2d75da' });
    expect(s().data.clients).toHaveLength(0);
    expect(s().notice).toMatchObject({ tone: 'error' });
    expect(returned).toEqual({ kind: 'blocked' });
  });
}

function registerColourSnap7(): void {
  it('a viewer cannot update a client colour', async () => {
    const client = await requireCreated(s().addClient({ name: 'Ferris', color: '#7adae3' }));
    s().setActiveRole('viewer');
    await s().updateClient(client.id, { color: '#e02727' });
    expect(s().data.clients.find((c) => c.id === client.id)?.color).toBe('#7adae3');
    expect(s().notice).toMatchObject({ tone: 'error' });
  });
}

describe('store colour and role behavior', () => {
  registerColourSnap3();
  registerColourSnap5();
  registerColourSnap6();
  registerColourSnap7();
});
