import { test } from '@japa/runner';
import { freshDatabase } from '../helpers/fresh_database.js';
import {
  asDataOwner,
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js';

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
    assert.equal(member.body().data.accounts[0]?.id, 'a-studio');
    const owner = authenticatedDataClient(client, session.cookie);
    const proxied = await owner
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio' })
      .send();
    proxied.assertStatus(200);
    const context = await owner.visit('api.masquerade.show').send();
    context.assertStatus(200);
    const contextToken = (context.body()!.data as unknown as { contextToken?: unknown })
      .contextToken;
    assert.isString(contextToken);
    assert.isAbove((contextToken as string).length, 0);
    const write = await owner
      .visit('api.getting_started.update', { companyId: 'a-studio' })
      .json({ dismissed: true })
      .send();
    assert.equal(write.status(), 200, JSON.stringify(write.body().data));
  });
});
