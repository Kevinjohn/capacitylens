import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach } from 'vitest';
import { hasActiveFilters, useStore } from './useStore';
import {
  resetStoreWithAccount,
  resetStoreWithData,
  makeAppData,
  makeAccount,
  makeResourceDraft,
  requireValue,
  DEFAULT_ACCOUNT_ID,
  updatePlanningFixtureSource,
  WORKDAYS,
} from '@/test/fixtures';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { addDaysISO, weekdayOf } from '@capacitylens/shared/lib/dateMath';
import { formatDayMonth } from '@/lib/dateDisplay';
import { resolveDateStyle } from './selectors';
import { buildBetaExport, serializeBetaExport } from '@capacitylens/shared/data/betaTransfer';
import { seed } from '@capacitylens/shared/data/seed';
import { PAST_BUFFER_DAYS } from '@/lib/schedulerConfig';

const s = () => useStore.getState();
beforeEach(() => resetStoreWithAccount());

const personDraft = makeResourceDraft({ name: 'Ty', role: 'Dev', color: '#1' });

function registerStoreCrudPart1(): void {
  it('adds entities with a generated id and timestamps', async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    expect(r.id).toBeTruthy();
    expect(r.createdAt).toBeTruthy();
    expect(r.updatedAt).toBeTruthy();
    expect(s().data.resources).toHaveLength(1);
  });

  it('applies the timestamp returned by the planning receipt', async () => {
    const client = await requireCreated(s().addClient({ name: 'Boundary', color: '#111111' }));
    const data = s().data;
    const timestamp = '2098-01-01T00:00:00.000Z';
    const timestampFixture = {
      ...data,
      clients: data.clients.map((row) =>
        row.id === client.id ? { ...row, updatedAt: timestamp } : row,
      ),
    };
    await resetStoreWithData(timestampFixture, DEFAULT_ACCOUNT_ID);
    await s().updateClient(client.id, { name: 'Last successor' });
    const updated = s().data.clients.find((row) => row.id === client.id);
    expect(updated).toMatchObject({ name: 'Last successor' });
    expect(updated?.updatedAt).not.toBe(timestamp);
    expect(Number.isFinite(Date.parse(updated?.updatedAt ?? ''))).toBe(true);
  });
}

function registerStoreCrudPart2(): void {
  it('updates fields from the planning receipt', async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await s().updateResource(r.id, { name: 'Tyler' });
    const updated = s().data.resources[0];
    if (!updated) throw new Error('Expected updated resource');
    expect(updated.name).toBe('Tyler');
    expect(updated.id).toBe(r.id);
  });

  it('rejects assigning a placeholder to an activity outside its bound project', async () => {
    const client = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    const p1 = await requireCreated(
      s().addProject({ name: 'P1', clientId: client.id, color: '#2' }),
    );
    const p2 = await requireCreated(
      s().addProject({ name: 'P2', clientId: client.id, color: '#3' }),
    );
    const activityP2 = await requireCreated(
      s().addActivity({
        name: 'T2',
        kind: 'project',
        projectId: p2.id,
      }),
    );
    const ph = await requireCreated(
      s().addResource({
        kind: 'placeholder',
        role: 'Designer',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: '#1',
        projectId: p1.id,
      }),
    );
    await expect(
      s().addAllocation({
        resourceId: ph.id,
        activityId: activityP2.id,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    ).rejects.toThrow(/placeholder.*bound project/i);
    expect(s().data.allocations).toHaveLength(0);
  });
}

describe('store CRUD', () => {
  registerStoreCrudPart1();
  registerStoreCrudPart2();
});

function registerSchedulerUiPart1(): void {
  it('setZoom sets the weeks-visible level', () => {
    s().setZoom(8);
    expect(s().ui.zoom).toBe(8);
    s().setZoom(1);
    expect(s().ui.zoom).toBe(1);
  });

  it('panDays shifts the origin', () => {
    s().setOriginDate('2026-06-01');
    s().panDays(7);
    expect(s().ui.originDate).toBe('2026-06-08');
  });
}

function registerSchedulerUiPart5(): void {
  it('setActiveAccount reopens on the current week (resets a panned origin/focus)', () => {
    s().setOriginDate('2020-01-01');

    s().setActiveAccount(s().activeAccountId);
    expect(s().ui.originDate).not.toBe('2020-01-01');
    expect(weekdayOf(s().ui.focusDate)).toBe(1);

    expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS));
  });
}

function registerSchedulerUiPart7(): void {
  it('goToToday resets the origin and bumps recenterToken (so the grid re-scrolls)', () => {
    const before = s().ui.recenterToken;
    s().setOriginDate('2020-01-01');
    s().goToToday();
    expect(s().ui.recenterToken).toBe(before + 1);
    expect(s().ui.originDate).not.toBe('2020-01-01');

    expect(weekdayOf(s().ui.focusDate)).toBe(1);
    expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS));
  });

  it('setNotice sets and clears the transient message', () => {
    s().setNotice('Nope');
    expect(s().notice?.message).toBe('Nope');
    s().setNotice(null);
    expect(s().notice).toBeNull();
  });

  it('setNotice records severity (info default, error opt-in) so the UI can persist errors', () => {
    s().setNotice('Heads up');
    expect(s().notice?.tone).toBe('info');
    s().setNotice('Boom', 'error');
    expect(s().notice?.tone).toBe('error');

    s().setNotice(null);
    expect(s().notice).toBeNull();
  });

  it('goToDate snaps focusDate to the week start and bumps recenterToken', () => {
    const before = s().ui.recenterToken;

    s().goToDate('2026-09-09');
    expect(weekdayOf(s().ui.focusDate)).toBe(1);
    expect(s().ui.focusDate).toBe('2026-09-07');
    expect(s().ui.recenterToken).toBe(before + 1);

    expect(s().ui.originDate).toBe(addDaysISO('2026-09-07', -PAST_BUFFER_DAYS));
  });

  it('goToDate snaps to the account week start when weekStartsOn=0 (Sunday) — not a hardcoded Monday', async () => {
    const sunStart = 'acct-sun';
    await resetStoreWithData(
      makeAppData({
        accounts: [makeAccount({ id: sunStart, weekStartsOn: 0 })],
      }),
      sunStart,
    );

    useStore.getState().goToDate('2026-09-09');
    expect(useStore.getState().ui.focusDate).toBe('2026-09-06');
    expect(weekdayOf(useStore.getState().ui.focusDate)).toBe(0);

    expect(useStore.getState().ui.originDate).toBe(addDaysISO('2026-09-06', -PAST_BUFFER_DAYS));
  });
}

function registerSchedulerUiPart2(): void {
  it('preserves the visible week when refreshing the currently loaded account', async () => {
    s().goToDate('2026-09-09');
    const before = {
      originDate: s().ui.originDate,
      focusDate: s().ui.focusDate,
    };

    updatePlanningFixtureSource(
      makeAppData({ accounts: [makeAccount({ name: 'Updated account name' })] }),
    );
    await s().refreshPlanning();

    expect(s().data.accounts[0]?.name).toBe('Updated account name');
    expect({
      originDate: s().ui.originDate,
      focusDate: s().ui.focusDate,
    }).toEqual(before);
  });

  it('preserves undo and redo across an unchanged same-account replacement', async () => {
    await s().addClient({ name: 'Undoable', color: '#111111' });
    await s().undoPlanning();
    expect(s().planning.history.future).toHaveLength(1);

    updatePlanningFixtureSource(structuredClone(s().data));
    await s().refreshPlanning();

    expect(s().planning.history.future).toHaveLength(1);
    await s().redoPlanning();
    expect(s().data.clients.some((client) => client.name === 'Undoable')).toBe(true);
  });

  it('clears history when a same-account replacement contains a remote revision', async () => {
    const client = await requireCreated(s().addClient({ name: 'Local', color: '#111111' }));
    await s().addClient({ name: 'Another local client', color: '#222222' });
    await s().undoPlanning();
    expect(s().planning.history.future).toHaveLength(1);
    const revision = s().planning.revision;
    const context = s().planning.context;
    if (revision === null || !context) throw new Error('Expected a ready planning context.');
    const remoteClient = {
      ...requireValue(
        s().data.clients.find((row) => row.id === client.id),
        'remote client',
      ),
      name: 'Remote',
      updatedAt: '2099-01-01T00:00:00.000Z',
    };
    const mutationId = crypto.randomUUID();
    const remoteExecution: PlanningExecution = {
      mutationId,
      baseRevision: revision,
      confirmedRestorationCount: 0,
      intent: {
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: client.id, changes: { name: 'Remote' } },
      },
    };
    const remoteReceipt: PlanningMutationSuccess = {
      status: 'committed',
      mutationId,
      revision: revision + 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: {
        mode: 'patch',
        history: 'retain',
        changed: {
          removed: [],
          upserts: [{ entity: 'clients', row: remoteClient }],
        },
      },
    };
    getStubPlanningTransport().respondNext(remoteReceipt);
    await getStubPlanningTransport().execute(
      context,
      remoteExecution,
      new AbortController().signal,
    );
    await s().refreshPlanning();

    expect(s().planning.history.past).toEqual([]);
    expect(s().planning.history.future).toEqual([]);
  });

  it.each([0, 1] as const)(
    're-anchors the first canonical snapshot to the selected account week start (%s)',
    async (weekStartsOn) => {
      const accountId = 'late-account';
      s().setAccountSummaries({ list: [{ id: accountId, name: 'Late account', role: 'owner' }] });
      updatePlanningFixtureSource(
        makeAppData({
          accounts: [makeAccount({ id: accountId, weekStartsOn })],
        }),
      );
      s().setActiveAccount(accountId);
      s().goToDate('2031-09-10');
      await s().refreshPlanning();

      expect(weekdayOf(s().ui.focusDate)).toBe(weekStartsOn);
      // The panned week is deliberately far in the future so today's week does not coincide with it
      // until then; the assertion is about re-anchoring, not about the calendar.
      expect(s().ui.focusDate).not.toBe('2031-09-07');
      expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS));
    },
  );
}

function registerSchedulerUiPart3(): void {
  it('snaps free scrolling to the week start when no test override is stored', () => {
    expect(s().weekSnapEnabled).toBe(true);
  });

  it('the date format is account data: undoable, exported, and mirrored to the formatters', async () => {
    const accountId = s().activeAccountId;
    if (!accountId) throw new Error('Expected an active account.');
    await s().updateAccount(accountId, { dateStyle: 'month-day' });
    expect(resolveDateStyle(s().data, accountId)).toBe('month-day');

    expect(formatDayMonth('2026-09-09')).toBe('Sep 9');

    await s().undoPlanning();
    expect(resolveDateStyle(s().data, accountId)).toBe('day-month');
    expect(formatDayMonth('2026-09-09')).toBe('9 Sep');

    await s().updateAccount(accountId, { dateStyle: 'month-day' });
    const exportData = seed();
    const exportAccount = exportData.accounts[0];
    if (!exportAccount) throw new Error('Expected a valid export fixture account.');
    exportAccount.dateStyle =
      s().data.accounts.find((account) => account.id === accountId)?.dateStyle ?? null;
    expect(
      serializeBetaExport(
        buildBetaExport(exportData, { accountId: exportAccount.id, completeness: 'full' }),
      ),
    ).toContain('"dateStyle": "month-day"');

    // Restore the default. The store is a singleton, so leaving it changed would bleed into
    // later specs that format a date.
    await s().updateAccount(accountId, { dateStyle: 'day-month' });
  });

  it('setDrawMode toggles between work and time off', () => {
    s().setDrawMode('timeoff');
    expect(s().ui.drawMode).toBe('timeoff');
    s().setDrawMode('work');
    expect(s().ui.drawMode).toBe('work');
  });

  it('toggleGroup collapses and expands a discipline', () => {
    s().toggleGroup('d-design');
    expect(s().ui.collapsedGroups).toContain('d-design');
    s().toggleGroup('d-design');
    expect(s().ui.collapsedGroups).not.toContain('d-design');
  });
}

function registerSchedulerUiPart4(): void {
  it('undo and redo move through mutation history', async () => {
    await resetStoreWithAccount();
    const c = await requireCreated(s().addClient({ name: 'Ferris', color: '#1' }));
    expect(s().data.clients).toHaveLength(1);
    await s().undoPlanning();
    expect(s().data.clients).toHaveLength(1);
    expect(s().data.clients[0]?.id).toBe(c.id);
    expect(typeof s().data.clients[0]?.archivedAt).toBe('string');
    await s().redoPlanning();
    expect(s().data.clients).toHaveLength(1);
    expect(s().data.clients[0]).toMatchObject({ id: c.id, archivedAt: null });
  });

  it('undo restores changed client fields without changing unrelated rows', async () => {
    await resetStoreWithAccount();
    const clients = [];
    for (let index = 0; index < 100; index += 1) {
      clients.push(await requireCreated(s().addClient({ name: `Client ${index}`, color: '#1' })));
    }
    const unrelatedClients = clients.slice(1);
    await s().updateClient(requireValue(clients[0], 'first client').id, { name: 'Changed' });

    await s().undoPlanning();

    expect(s().data.clients[0]?.name).toBe('Client 0');
    expect(s().data.clients).toHaveLength(clients.length);
    for (const client of unrelatedClients) {
      expect(s().data.clients.find(({ id }) => id === client.id)).toEqual(client);
    }
  });
}

function registerSchedulerUiPart6(): void {
  it('setFilters merges, hasActiveFilters reflects state, clearFilters resets', () => {
    s().clearFilters();
    expect(hasActiveFilters(s().ui.filters)).toBe(false);
    s().setFilters({ search: 'ty', hideTentative: true });
    expect(s().ui.filters.search).toBe('ty');
    expect(s().ui.filters.hideTentative).toBe(true);
    expect(hasActiveFilters(s().ui.filters)).toBe(true);
    s().clearFilters();
    expect(s().ui.filters.search).toBe('');
    expect(hasActiveFilters(s().ui.filters)).toBe(false);
  });

  it('setFilters keeps the specific-activity and activity-kind lenses mutually exclusive', () => {
    s().clearFilters();
    s().setFilters({ activityKind: 'internal' });
    s().setFilters({ activityId: 'activity-1' });
    expect(s().ui.filters.activityId).toBe('activity-1');
    expect(s().ui.filters.activityKind).toBeNull();

    s().setFilters({ activityKind: 'repeatable' });
    expect(s().ui.filters.activityKind).toBe('repeatable');
    expect(s().ui.filters.activityId).toBeNull();
  });

  it('gives activity kind precedence when one patch supplies both activity lenses', () => {
    s().clearFilters();
    s().setFilters({ activityId: 'activity-1', activityKind: 'internal' });

    expect(s().ui.filters.activityKind).toBe('internal');
    expect(s().ui.filters.activityId).toBeNull();
  });
  it('clears a stale project when the client filter changes', async () => {
    const queen = await requireCreated(
      s().addClient({ name: 'Queen Consolidated', color: '#111' }),
    );
    const lex = await requireCreated(s().addClient({ name: 'LexCorp', color: '#222' }));
    const project = await requireCreated(
      s().addProject({ name: 'Project Watchtower', clientId: queen.id, color: '#333' }),
    );
    s().setFilters({ clientId: queen.id, projectId: project.id });
    s().setFilters({ clientId: lex.id });
    expect(s().ui.filters).toMatchObject({ clientId: lex.id, projectId: null });
  });

  it('keeps a project when the client filter changes to its client', async () => {
    const queen = await requireCreated(
      s().addClient({ name: 'Queen Consolidated', color: '#111' }),
    );
    const project = await requireCreated(
      s().addProject({ name: 'Project Watchtower', clientId: queen.id, color: '#333' }),
    );
    s().setFilters({ projectId: project.id });
    s().setFilters({ clientId: queen.id });
    expect(s().ui.filters).toMatchObject({ clientId: queen.id, projectId: project.id });
  });

  it('clears a stale project when the client filter is cleared', () => {
    s().setFilters({ clientId: 'client-1', projectId: 'project-1' });
    s().setFilters({ clientId: null });
    expect(s().ui.filters).toMatchObject({ clientId: null, projectId: null });
  });

  it('gives the activity lens precedence when one patch spans both lens families', () => {
    s().clearFilters();
    s().setFilters({ activityId: 'activity-1', clientId: 'client-1' });

    expect(s().ui.filters.activityId).toBe('activity-1');
    expect(s().ui.filters.clientId).toBeNull();
    expect(s().ui.filters.projectId).toBeNull();
  });
}

describe('store scheduler UI', () => {
  registerSchedulerUiPart1();
  registerSchedulerUiPart5();
  registerSchedulerUiPart2();
  registerSchedulerUiPart3();
  registerSchedulerUiPart4();
  registerSchedulerUiPart6();
  registerSchedulerUiPart7();
});
