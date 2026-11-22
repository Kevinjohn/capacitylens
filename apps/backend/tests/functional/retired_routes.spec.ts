import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  authenticatedDataClient,
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';

test.group('retired persistence routes', (group) => {
  group.setup(() => freshDatabase());

  test('refuses old writes while keeping the authenticated export read', async ({
    client,
    assert,
  }) => {
    const session = await resetAuthenticatedData(client, false);
    const companyId = await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises');
    const owner = authenticatedDataClient(client, session.cookie);

    const requests = [
      owner.post('/api/batch').json({ ops: [] }),
      owner.post('/api/orgs').json({ name: 'Stark Industries' }),
      owner.post('/api/companies').json({ name: 'Stark Industries' }),
      owner.patch(`/api/companies/${companyId}`).json({ name: 'Other name' }),
      owner.delete(`/api/companies/${companyId}`),
    ];
    for (const request of requests) {
      const response = await request.send();
      response.assertStatus(404);
    }

    const read = await owner.visit('api.company_state.show').qs({ companyId }).send();
    read.assertStatus(200);
    assert.deepEqual(
      read.body().data.companies.map((account: { id: string }) => account.id),
      [companyId]
    );
  });

  test('fails closed on a multi-company directory without offering a selection', async ({
    client,
  }) => {
    const session = await resetAuthenticatedData(client, false);
    await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises');
    await createFixtureCompanyForOwner(session.userId, 'Stark Industries');
    const owner = authenticatedDataClient(client, session.cookie);
    const directory = await owner.visit('api.companies.index').send();
    directory.assertStatus(409);
  });
});
