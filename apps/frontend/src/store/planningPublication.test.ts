import { describe, expect, it } from 'vitest';
import {
  makeAccount,
  makeAppData,
  makeResource,
  replaceFixtureData,
  resetStoreWithData,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { publishPlanning } from './planningPublication';

describe('publishPlanning', () => {
  it('replaces the active company while retaining exact rows from other companies', async () => {
    const otherAccount = makeAccount({ id: 'company-b', name: 'Stark Industries' });
    const otherResource = makeResource({
      id: 'resource-b',
      accountId: otherAccount.id,
      name: 'Pepper Potts',
    });
    const fixtureData = makeAppData({
      accounts: [makeAccount({ id: 'company-a' }), otherAccount],
      resources: [otherResource],
    });
    await resetStoreWithData(fixtureData, 'company-a');
    replaceFixtureData(fixtureData);
    const state = useStore.getState();
    const replacement = makeAppData({
      accounts: [makeAccount({ id: 'company-a', name: 'Updated Company A' })],
      resources: [makeResource({ id: 'resource-a', accountId: 'company-a' })],
    });

    const publication = publishPlanning(state, { data: replacement }, true);

    expect(publication.data?.accounts).toEqual([
      otherAccount,
      expect.objectContaining({ id: 'company-a', name: 'Updated Company A' }),
    ]);
    expect(publication.data?.resources).toEqual([
      otherResource,
      expect.objectContaining({ id: 'resource-a', accountId: 'company-a' }),
    ]);
  });
});
