import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  asDataOwner,
  authenticatedDataClient,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';

test.group('authenticated data fixture', (group) => {
  group.setup(() => freshDatabase());

  test('ordinary data reads require a signed-in company member', async ({ client, assert }) => {
    const session = await resetAuthenticatedData(client, 'single');
    const anonymous = await client
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio' })
      .send();
    anonymous.assertStatus(401);
    const me = await asDataOwner(client.visit('api.session.show'), session.cookie).send();
    me.assertStatus(200);
    const member = await asDataOwner(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      session.cookie
    ).send();
    member.assertStatus(200);
    assert.equal(member.body().data.companies[0]?.id, 'a-studio');
    const owner = authenticatedDataClient(client, session.cookie);
    const proxied = await owner
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio' })
      .send();
    proxied.assertStatus(200);
    const context = await owner.visit('api.masquerade.show').send();
    context.assertStatus(200);
    const masqueradeToken = (context.body()!.data as unknown as { masqueradeToken?: unknown })
      .masqueradeToken;
    assert.isString(masqueradeToken);
    assert.isAbove((masqueradeToken as string).length, 0);
    const write = await owner
      .visit('api.getting_started.update', { companyId: 'a-studio' })
      .json({ dismissed: true })
      .send();
    assert.equal(write.status(), 200, JSON.stringify(write.body().data));
  });
});
