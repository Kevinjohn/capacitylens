import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { createIdentity } from '#tests/helpers/identities';

export const email = 'bruce.wayne@wayne.example';
export const password = 'batman-secret-2026';
export const companyId = 'a-studio';

export const companies = (client: ApiClient, cookie: string) =>
  asDataOwner(client.visit('api.companies.index'), cookie).send();
export const planning = (client: ApiClient, cookie: string) =>
  asDataOwner(client.visit('api.planning.show', { companyId }), cookie).send();
export const dismiss = (client: ApiClient, cookie: string) =>
  asDataOwner(client.visit('api.getting_started.update', { companyId }), cookie)
    .timeout({ response: 10000, deadline: 15000 })
    .json({ dismissed: true })
    .send();
export const dismissals = () => db.from('company_getting_started_dismissals');

export async function owner(options: { verified?: boolean; admitted?: boolean } = {}) {
  const userId = await createIdentity(email, { name: 'Bruce Wayne', password, ...options });
  await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', companyId);
  return userId;
}
