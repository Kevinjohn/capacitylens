import User from '#models/user';
import { createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture';
import { signUpAndIn } from '#tests/helpers/identities';

export const password = 'batman-secret-2026';

/** Signs in an Owner of `a-studio` and a second admitted person, returning the second's session. */
export async function outsider(client: any) {
  const owner = await signUpAndIn(client, {
    email: 'bruce.wayne@wayne.example',
    password,
    name: 'Bruce Wayne',
  });
  owner.assertStatus(200);
  const ownerId = String((owner.body().data as { user: { id: string } }).user.id);
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
  const other = await signUpAndIn(client, {
    email: 'selina.kyle@gotham.example',
    password,
    name: 'Selina Kyle',
  });
  other.assertStatus(200);
  const userId = String((other.body().data as { user: { id: string } }).user.id);
  return { user: await User.findOrFail(userId), userId };
}

export async function refusals(client: any, user: User) {
  const status = await client.visit('api.masquerade.show').loginAs(user).send();
  status.assertStatus(200);
  const company = await client
    .visit('api.getting_started.update', { companyId: 'a-studio' })
    .header('sec-fetch-site', 'same-origin')
    .header(
      'X-Masquerade-Context',
      (status.body().data as { masqueradeToken: string }).masqueradeToken
    )
    .loginAs(user)
    .json({ dismissed: true })
    .send();
  const planning = await client
    .visit('api.planning.show', { companyId: 'a-studio' })
    .loginAs(user)
    .send();
  return { company, planning };
}
