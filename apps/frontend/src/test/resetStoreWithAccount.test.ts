import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlanningTransportHandle } from '@/test/planningTransportHandle';
import {
  makeAccount,
  makeAppData,
  makeResource,
  makeResourceDraft,
  replaceFixtureData,
  resetStoreWithAccount,
  resetStoreWithData,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';

afterEach(() => vi.restoreAllMocks());

describe('resetStoreWithAccount', () => {
  it('resets a cold company before its first canonical read', async () => {
    const transport = getPlanningTransportHandle();
    const read = vi.spyOn(transport, 'read');
    await expect(resetStoreWithAccount('acct-cold-reset')).resolves.toBe(true);
    expect(read).toHaveBeenCalled();
    expect(useStore.getState().planning.context?.companyId).toBe('acct-cold-reset');
    expect(useStore.getState().planning.status).toBe('ready');
    expect(useStore.getState().data.accounts.map(({ id }) => id)).toEqual(['acct-cold-reset']);
  });

  it('restores the seeded rows and revision on a repeated same-company reset', async () => {
    const companyId = 'acct-repeat-reset';
    await resetStoreWithAccount(companyId);
    await useStore.getState().updateAccount(companyId, { name: 'Changed Test Co' });
    expect(useStore.getState().planning.revision).toBe(1);

    await expect(resetStoreWithAccount(companyId)).resolves.toBe(true);

    expect(useStore.getState().planning.revision).toBe(0);
    expect(useStore.getState().data.accounts.map(({ name }) => name)).toEqual(['Test Co']);
    expect(useStore.getState().planning.context?.companyId).toBe(companyId);
    expect(useStore.getState().planning.status).toBe('ready');
  });
  it('resets a selected company after its context is cleared, removes prior rows and permits a new write', async () => {
    const companyId = 'acct-cleared-context';
    await resetStoreWithAccount(companyId);
    await useStore.getState().addResource(makeResourceDraft({ name: 'Clark Kent' }));
    expect(useStore.getState().data.resources).toHaveLength(1);
    useStore.setState({ planning: { ...useStore.getState().planning, context: null } });
    expect(useStore.getState().activeAccountId).toBe(companyId);
    await expect(resetStoreWithAccount(companyId)).resolves.toBe(true);
    expect(useStore.getState().data.resources).toHaveLength(0);
    await useStore.getState().updateAccount(companyId, { name: 'New Company' });
    expect(useStore.getState().data.accounts[0]?.name).toBe('New Company');
  });

  it('re-enters the first company after visiting another and clearing the active context', async () => {
    const first = makeAccount({ id: 'acct-first' });
    const second = makeAccount({ id: 'acct-second', name: 'Stark Industries' });
    const data = makeAppData({
      accounts: [first, second],
      resources: [
        makeResource({ id: 'resource-first', companyId: first.id }),
        makeResource({ id: 'resource-second', companyId: second.id }),
      ],
    });
    await resetStoreWithData(data, first.id);
    useStore.getState().setAccountSummaries({
      list: [
        { id: first.id, name: first.name, role: 'owner' },
        { id: second.id, name: second.name, role: 'owner' },
      ],
    });
    replaceFixtureData(data);

    useStore.getState().setActiveAccount(second.id);
    await expect(useStore.getState().refreshPlanning({ fresh: true })).resolves.toBe(true);
    expect(useStore.getState().data.resources.map(({ id }) => id)).toEqual(['resource-second']);

    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries({
      list: [{ id: first.id, name: first.name, role: 'owner' }],
    });
    useStore.getState().setActiveAccount(first.id);
    await expect(useStore.getState().refreshPlanning({ fresh: true })).resolves.toBe(true);
    expect(useStore.getState().data.resources.map(({ id }) => id)).toEqual(['resource-first']);
  });
});
