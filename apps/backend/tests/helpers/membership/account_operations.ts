import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import User from '#models/user';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { signUpAndIn } from '#tests/helpers/identities';
import { password } from '#tests/helpers/membership/members';

/** The company the account-operation retry specs work in. */
export const companyId = 'a-studio';

/** A numbered pair of account-operation headers. */
export const operation = (n: number) => ({
  'x-account-operation-id': `retry-command-${String(n).padStart(4, '0')}`,
  'idempotency-key': `retry-idempotency-${String(n).padStart(4, '0')}`,
});

/** The refusal code of a typed response. */
export const codeOf = (response: { body(): unknown }) =>
  (response.body() as { code?: string }).code;

/** Signs a person up and in; returns their id, sign-in cookie and model. */
export async function signedUpPerson(client: ApiClient, email: string, name: string) {
  const response = await signUpAndIn(client, { email, password, name });
  response.assertStatus(200);
  const row = await db.from('users').where('email', email).firstOrFail();
  return {
    id: String(row.id),
    cookie: response.cookie('adonis-session')!.value,
    user: await User.findOrFail(row.id),
  };
}

/** A company with a signed-in Owner and an Admin member. */
export async function retryCompany(client: ApiClient) {
  const owner = await signedUpPerson(client, 'bruce.wayne@wayne.example', 'Bruce Wayne');
  await createFixtureCompanyForOwner(owner.id, 'Wayne Enterprises', companyId);
  const admin = await signedUpPerson(client, 'clark.kent@wayne.example', 'Clark Kent');
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: admin.id,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  return { owner, admin };
}

/** Requests a password confirmation for transferring the company to `toUserId`. */
export async function transferConfirmation(client: ApiClient, cookie: string, toUserId: string) {
  return asDataOwner(client.visit('api.password_confirmations.store'), cookie)
    .header('sec-fetch-site', 'same-origin')
    .json({ action: 'transfer-ownership', companyId, intent: { toUserId }, password })
    .send();
}
