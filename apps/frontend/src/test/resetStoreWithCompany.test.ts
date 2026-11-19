import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlanningTransportHandle } from '@/test/planningTransportHandle';
import {
  makeCompany,
  makeAppData,
  makeResource,
  makeResourceDraft,
  replaceFixtureData,
  resetStoreWithCompany,
  resetStoreWithData,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';

afterEach(() => vi.restoreAllMocks());

describe('resetStoreWithCompany', () => {
  it('resets a cold company before its first canonical read', async () => {
    const transport = getPlanningTransportHandle();
    const read = vi.spyOn(transport, 'read');
    await expect(resetStoreWithCompany('acct-cold-reset')).resolves.toBe(true);
    expect(read).toHaveBeenCalled();
    expect(useStore.getState().planning.context?.companyId).toBe('acct-cold-reset');
    expect(useStore.getState().planning.status).toBe('ready');
    expect(useStore.getState().data.accounts.map(({ id }) => id)).toEqual(['acct-cold-reset']);
  });

  it('restores the seeded rows and revision on a repeated same-company reset', async () => {
    const companyId = 'acct-repeat-reset';
    await resetStoreWithCompany(companyId);
    await useStore.getState().updateCompany(companyId, { name: 'Changed Test Co' });
    expect(useStore.getState().planning.revision).toBe(1);

    await expect(resetStoreWithCompany(companyId)).resolves.toBe(true);

    expect(useStore.getState().planning.revision).toBe(0);
    expect(useStore.getState().data.accounts.map(({ name }) => name)).toEqual(['Test Co']);
    expect(useStore.getState().planning.context?.companyId).toBe(companyId);
    expect(useStore.getState().planning.status).toBe('ready');
  });
  it('resets a selected company after its context is cleared, removes prior rows and permits a new write', async () => {
    const companyId = 'acct-cleared-context';
    await resetStoreWithCompany(companyId);
    await useStore.getState().addResource(makeResourceDraft({ name: 'Clark Kent' }));
    expect(useStore.getState().data.resources).toHaveLength(1);
    useStore.setState({ planning: { ...useStore.getState().planning, context: null } });
    expect(useStore.getState().activeCompanyId).toBe(companyId);
    await expect(resetStoreWithCompany(companyId)).resolves.toBe(true);
    expect(useStore.getState().data.resources).toHaveLength(0);
    await useStore.getState().updateCompany(companyId, { name: 'New Company' });
    expect(useStore.getState().data.accounts[0]?.name).toBe('New Company');
  });

  it('re-enters the first company after visiting another and clearing the active context', async () => {
    const first = makeCompany({ id: 'acct-first' });
    const second = makeCompany({ id: 'acct-second', name: 'Stark Industries' });
    const data = makeAppData({
      accounts: [first, second],
      resources: [
        makeResource({ id: 'resource-first', companyId: first.id }),
        makeResource({ id: 'resource-second', companyId: second.id }),
      ],
    });
    await resetStoreWithData(data, first.id);
    useStore.getState().setCompanySummaries({
      list: [
        { id: first.id, name: first.name, role: 'owner' },
        { id: second.id, name: second.name, role: 'owner' },
      ],
    });
    replaceFixtureData(data);

    useStore.getState().setActiveCompany(second.id);
    await expect(useStore.getState().refreshPlanning({ fresh: true })).resolves.toBe(true);
    expect(useStore.getState().data.resources.map(({ id }) => id)).toEqual(['resource-second']);

    useStore.getState().setActiveCompany(null);
    useStore.getState().setCompanySummaries({
      list: [{ id: first.id, name: first.name, role: 'owner' }],
    });
    useStore.getState().setActiveCompany(first.id);
    await expect(useStore.getState().refreshPlanning({ fresh: true })).resolves.toBe(true);
    expect(useStore.getState().data.resources.map(({ id }) => id)).toEqual(['resource-first']);
  });
});
