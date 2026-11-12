import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './useStore';
import { m } from '@/i18n';
import { makeAccount, makeAppData, resetStoreWithData, WORKDAYS } from '@/test/fixtures';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import type { AppData } from '@capacitylens/shared/types/entities';

// The store is the strict per-account write boundary: an update/delete must own
// the target row, and every foreign key on an add/update must point inside the
// active account. Reads are scoped elsewhere (useScopedData); these tests pin the
// write side, which forms can't reach but a direct call could.

const s = () => useStore.getState();

const A = 'acct-a';
const B = 'acct-b';

function assertDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to exist`);
  return value;
}

function twoAccountData(): AppData {
  return makeAppData({
    accounts: [
      makeAccount({ id: A, name: 'Company A' }),
      makeAccount({ id: B, name: 'Company B' }),
    ],
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: 'cB',
        accountId: B,
        name: 'B Client',
        color: '#111111',
        createdAt: 't',
        updatedAt: 't',
      },
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: 'pB',
        accountId: B,
        name: 'B Project',
        clientId: 'cB',
        color: '#222222',
        createdAt: 't',
        updatedAt: 't',
      },
    ],
    activities: [
      {
        ...NULLABLE_FIELDS.activities,
        id: 'tB',
        accountId: B,
        name: 'B Activity',
        kind: 'project',
        projectId: 'pB',
        createdAt: 't',
        updatedAt: 't',
      },
    ],
    resources: [
      {
        ...NULLABLE_FIELDS.resources,
        id: 'rB',
        accountId: B,
        kind: 'person',
        role: 'Dev',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: '#333333',
        createdAt: 't',
        updatedAt: 't',
      },
    ],
  });
}

beforeEach(async () => {
  await resetStoreWithData(twoAccountData(), A);
  s().setAccountSummaries({
    list: [
      { id: A, name: 'Company A', role: 'owner' },
      { id: B, name: 'Company B', role: 'owner' },
    ],
  });
  s().setActiveAccount(A);
  s().setActiveRole('owner');
  expect(s().activeAccountId).toBe(A);
});

describe('active-account replacement invariant', () => {
  it("rejects scoped writes only while the active account's hydration is marked failed", async () => {
    useStore.setState({ activeAccountLoadFailed: A });
    await expect(
      requireCreated(s().addClient({ name: 'Wayne Enterprises', color: '#111111' })),
    ).rejects.toThrow(/not loaded/i);

    useStore.setState({ activeAccountLoadFailed: B });
    await expect(
      requireCreated(s().addClient({ name: 'Wayne Foundation', color: '#111111' })),
    ).resolves.toBeDefined();
  });

  it('rejects scoped writes when a non-null active id has no loaded account row', async () => {
    s().setAccountSummaries({ list: [] });
    useStore.setState({ activeAccountId: 'missing-account' });
    const dataBefore = s().data;

    await expect(
      requireCreated(s().addClient({ name: 'Orphan', color: '#111111' })),
    ).rejects.toThrow(/no active company/i);
    expect(s().data).toBe(dataBefore);
  });
});

describe('active-account permission publication', () => {
  it('atomically fail-closes a switched tenant before an imperative write can use the prior role', async () => {
    s().setActiveRole('editor');
    const rolesPublishedForB: Array<string | null> = [];
    const unsubscribe = useStore.subscribe((state) => {
      if (state.activeAccountId === B) rolesPublishedForB.push(state.activeRole);
    });

    s().setActiveAccount(B);
    await expect(s().addClient({ name: 'Must not land', color: '#111111' })).rejects.toThrow(
      /no active company/i,
    );
    await s().refreshPlanning();
    await s().addClient({ name: 'Still must not land', color: '#111111' });
    unsubscribe();

    expect(rolesPublishedForB[0]).toBe('viewer');
    expect(new Set(rolesPublishedForB)).toEqual(new Set(['viewer']));
    expect(s().activeRole).toBe('viewer');
    expect(s().data.clients.some((client) => client.name.includes('must not land'))).toBe(false);
    expect(s().data.clients.find((client) => client.id === 'cB')?.accountId).toBe(B);
    expect(s().notice).toMatchObject({ tone: 'error' });
  });

  it('denies a write with null role across an account switch', async () => {
    s().setActiveRole(null);
    s().setActiveAccount(B);
    await s().refreshPlanning();

    expect(s().activeRole).toBeNull();
    const dataBefore = s().data;
    const transport = getStubPlanningTransport();
    expect(transport.calls).toEqual([]);
    await s().addClient({ name: 'Must not land', color: '#111111' });
    await s().sendPlanningCommand({
      intent: { operation: 'catalogue.archive', entity: { entity: 'clients', id: 'cB' } },
      inverse: null,
    });
    await expect(s().undoPlanning()).resolves.toBe(false);
    await expect(s().redoPlanning()).resolves.toBe(false);
    expect(transport.calls).toEqual([]);
    expect(s().data).toBe(dataBefore);
    expect(s().data.clients.some((client) => client.name === 'Must not land')).toBe(false);
    expect(s().notice?.message).toBe(m.access_unavailable_summary());
  });

  it('honors canonical read-only authority even when the local role says owner', async () => {
    s().setActiveRole('owner');
    const transport = getStubPlanningTransport();
    transport.setCanWrite(false);
    expect(await s().refreshPlanning({ fresh: true })).toBe(true);

    expect(s().activeRole).toBe('owner');
    expect(s().planning.canWrite).toBe(false);
    expect(s().planningReadyForReplacement()).toBe(false);
    await expect(s().addClient({ name: 'Must not land', color: '#111111' })).rejects.toThrow();
    await expect(
      s().sendPlanningCommand({
        intent: { operation: 'catalogue.archive', entity: { entity: 'clients', id: 'cB' } },
        inverse: null,
      }),
    ).rejects.toThrow(/read-only/i);
    expect(transport.calls).toEqual([]);
    expect(s().data.clients.some((client) => client.name === 'Must not land')).toBe(false);
  });
});

function registerAccountOwnershipTests(): void {
  it('treats stale account update ids as true no-ops that preserve undo and redo', async () => {
    await s().updateAccount(A, { name: 'Changed once' });
    await s().undoPlanning();
    const dataBefore = s().data;
    const pastBefore = s().planning.history.past;
    const futureBefore = s().planning.history.future;

    await expect(s().updateAccount('missing-account', { name: 'Gone' })).rejects.toThrow(
      /active company/i,
    );
    expect(s().data).toBe(dataBefore);
    expect(s().planning.history.past).toBe(pastBefore);
    expect(s().planning.history.future).toBe(futureBefore);
  });
}

function registerEntityOwnershipTests(): void {
  it('treats a stale / non-existent id as a silent no-op (does not throw)', async () => {
    // A drag committed after an undo, or a double Delete keypress, can target an id
    // that no longer exists. That must not throw (it fires from window listeners
    // outside React's error boundary).
    expect(await s().updateAllocation('gone', { status: 'tentative' })).toBe(false);
    await s().deleteAllocation('gone');
    await expect(s().updateClient('gone', { name: 'x' })).resolves.toBeUndefined();
    await expect(s().updateTimeOff('gone', { type: 'sick' })).resolves.toBeUndefined();
  });
}

describe('ownership guard on update/delete', () => {
  registerAccountOwnershipTests();
  registerEntityOwnershipTests();
});

describe('foreign-key refs must stay in the active account', () => {
  it('still allows valid in-account references', async () => {
    const c = await requireCreated(s().addClient({ name: 'A Client', color: '#555555' }));
    const p = await requireCreated(
      s().addProject({ name: 'A Project', clientId: c.id, color: '#666666' }),
    );
    const t = await requireCreated(
      s().addActivity({ name: 'An Activity', kind: 'project', projectId: p.id }),
    );
    expect(t.accountId).toBe(A);
    const project = assertDefined(
      s().data.projects.find((x) => x.id === p.id),
      `project ${p.id}`,
    );
    expect(project.clientId).toBe(c.id);
  });
});

describe('unknown company selection', () => {
  it('surfaces the not-found notice even when activeAccountId is already null', () => {
    s().setActiveAccount(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    s().setActiveAccount('company-does-not-exist');

    expect(s().activeAccountId).toBeNull();
    expect(s().notice).toMatchObject({ tone: 'error' });
    warn.mockRestore();
  });

  it('clears the leaving company session state when selection is unknown', () => {
    const dirtySourceA = Symbol('company A form');
    const dirtySourceB = Symbol('company A dialog');
    s().setDirtyFormSource({ source: dirtySourceA, dirty: true });
    s().setDirtyFormSource({ source: dirtySourceB, dirty: true });
    s().setDraggingAllocation('allocation-a');
    s().announceCapacity('Company A capacity changed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    s().setActiveAccount('company-does-not-exist');

    expect(s().activeAccountId).toBeNull();
    expect(s().notice).toMatchObject({ tone: 'error' });
    expect(s().notice?.message).toMatch(/company no longer exists/i);
    expect(s().dirtyForm).toBe(false);
    expect(s().dirtyFormSources.size).toBe(0);
    expect(s().draggingAllocationId).toBeNull();
    expect(s().srAnnouncement).toBeNull();
    warn.mockRestore();
  });
});
