import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './useStore';
import { m } from '@/i18n';
import {
  makeCompany,
  makeAppData,
  resetStoreWithData,
  setPlanningAccess,
  WORKDAYS,
} from '@/test/fixtures';
import {
  getPlanningTransportHandle,
  getStubPlanningTransport,
} from '@/test/planningTransportHandle';
import type { AppData } from '@capacitylens/shared/types/entities';

// The store is the strict per-company write boundary: an update/delete must own
// the target row, and every foreign key on an add/update must point inside the
// active company. Reads are scoped elsewhere (useScopedData); these tests pin the
// write side, which forms can't reach but a direct call could.

const s = () => useStore.getState();

const A = 'acct-a';
const B = 'acct-b';

function assertDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to exist`);
  return value;
}

function twoCompanyData(): AppData {
  return makeAppData({
    accounts: [
      makeCompany({ id: A, name: 'Company A' }),
      makeCompany({ id: B, name: 'Company B' }),
    ],
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: 'cB',
        companyId: B,
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
        companyId: B,
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
        companyId: B,
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
        companyId: B,
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
  await resetStoreWithData(twoCompanyData(), A);
  s().setCompanySummaries({
    list: [
      { id: A, name: 'Company A', role: 'owner' },
      { id: B, name: 'Company B', role: 'owner' },
    ],
  });
  s().setActiveCompany(A);
  expect(s().activeCompanyId).toBe(A);
});

describe('active-account replacement invariant', () => {
  it('rejects scoped writes when a non-null active id has no loaded account row', async () => {
    s().setCompanySummaries({ list: [] });
    useStore.setState({ activeCompanyId: 'missing-account' });
    const dataBefore = s().data;

    await expect(
      requireCreated(s().addClient({ name: 'Orphan', color: '#111111' })),
    ).rejects.toThrow(/not loaded/i);
    expect(s().data).toBe(dataBefore);
  });
});

describe('active-account permission publication', () => {
  it('atomically fail-closes a switched tenant before an imperative write can use the prior authority', async () => {
    setPlanningAccess({ role: 'editor' });
    const rolesPublishedForB: Array<string | null> = [];
    const unsubscribe = useStore.subscribe((state) => {
      if (state.activeCompanyId === B) {
        rolesPublishedForB.push(state.planning.authority?.role ?? null);
      }
    });

    getStubPlanningTransport().setAccess({ role: 'viewer', canWrite: false });
    s().setActiveCompany(B);
    // B is known from the summaries before its rows load, so the write reaches the authority check,
    // which refuses it while B's planning read has not been accepted.
    await expect(s().addClient({ name: 'Must not land', color: '#111111' })).resolves.toEqual({
      kind: 'blocked',
    });
    await s().refreshPlanning();
    await s().addClient({ name: 'Still must not land', color: '#111111' });
    unsubscribe();

    expect(rolesPublishedForB[0]).toBeNull();
    expect(new Set(rolesPublishedForB)).toEqual(new Set([null, 'viewer']));
    expect(s().planning.authority?.role).toBe('viewer');
    expect(s().data.clients.some((client) => client.name.includes('must not land'))).toBe(false);
    expect(s().data.clients.find((client) => client.id === 'cB')?.companyId).toBe(B);
    expect(s().notice).toMatchObject({ tone: 'error' });
  });

  it("denies a write when the switched company's planning read fails", async () => {
    const transport = getStubPlanningTransport();
    const read = vi
      .spyOn(getPlanningTransportHandle(), 'read')
      .mockRejectedValue(new Error('offline'));
    s().setActiveCompany(B);
    await s().refreshPlanning();
    read.mockRestore();

    expect(s().planning.authority).toBeNull();
    const dataBefore = s().data;
    expect(transport.calls).toEqual([]);
    await expect(s().addClient({ name: 'Must not land', color: '#111111' })).rejects.toThrow(
      'No active company is selected.',
    );
    await s().sendPlanningCommand({
      intent: { operation: 'catalogue.archive', entity: { entity: 'clients', id: 'cB' } },
    });
    await expect(s().undoPlanning()).resolves.toBe(false);
    await expect(s().redoPlanning()).resolves.toBe(false);
    expect(transport.calls).toEqual([]);
    expect(s().data).toBe(dataBefore);
    expect(s().data.clients.some((client) => client.name === 'Must not land')).toBe(false);
    expect(s().notice?.message).toBe(m.access_unavailable_summary());
  });

  it('honors canonical read-only authority even when the role is owner', async () => {
    const transport = getStubPlanningTransport();
    transport.setAccess({ role: 'owner', canWrite: false });
    expect(await s().refreshPlanning({ fresh: true })).toBe(true);

    expect(s().planning.authority).toMatchObject({ role: 'owner', canWrite: false });
    expect(s().planningReadyForReplacement()).toBe(false);
    await expect(s().addClient({ name: 'Must not land', color: '#111111' })).resolves.toEqual({
      kind: 'blocked',
    });
    await expect(
      s().sendPlanningCommand({
        intent: { operation: 'catalogue.archive', entity: { entity: 'clients', id: 'cB' } },
      }),
    ).resolves.toBeUndefined();
    expect(s().notice?.message).toBe(m.notice_viewer_read_only());
    expect(transport.calls).toEqual([]);
    expect(s().data.clients.some((client) => client.name === 'Must not land')).toBe(false);
  });
});

describe('ownership guard on update/delete', () => {
  it('rejects a stale account update id and leaves data, undo and redo unchanged', async () => {
    await s().updateCompany(A, { name: 'Changed once' });
    await s().undoPlanning();
    const dataBefore = s().data;
    const historyBefore = s().planning.history;

    await expect(s().updateCompany('missing-account', { name: 'Gone' })).rejects.toThrow(
      /active company/i,
    );
    expect(s().data).toBe(dataBefore);
    expect(s().planning.history).toBe(historyBefore);
  });
  it('treats a stale / non-existent id as a silent no-op (does not throw)', async () => {
    // A drag committed after an undo, or a double Delete keypress, can target an id
    // that no longer exists. That must not throw (it fires from window listeners
    // outside React's error boundary).
    expect(await s().updateAllocation('gone', { status: 'tentative' })).toBe(false);
    await s().deleteAllocation('gone');
    await expect(s().updateClient('gone', { name: 'x' })).resolves.toBeUndefined();
    await expect(s().updateTimeOff('gone', { type: 'sick' })).resolves.toBeUndefined();
  });
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
    expect(t.companyId).toBe(A);
    const project = assertDefined(
      s().data.projects.find((x) => x.id === p.id),
      `project ${p.id}`,
    );
    expect(project.clientId).toBe(c.id);
  });
});

describe('unknown company selection', () => {
  it('surfaces the not-found notice even when activeCompanyId is already null', () => {
    s().setActiveCompany(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    s().setActiveCompany('company-does-not-exist');

    expect(s().activeCompanyId).toBeNull();
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

    s().setActiveCompany('company-does-not-exist');

    expect(s().activeCompanyId).toBeNull();
    expect(s().notice).toMatchObject({ tone: 'error' });
    expect(s().notice?.message).toMatch(/company no longer exists/i);
    expect(s().dirtyForm).toBe(false);
    expect(s().dirtyFormSources.size).toBe(0);
    expect(s().draggingAllocationId).toBeNull();
    expect(s().srAnnouncement).toBeNull();
    warn.mockRestore();
  });
});
