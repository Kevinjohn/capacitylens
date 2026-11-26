import { ApiClient, type ApiRequest } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import { randomUUID } from 'node:crypto';
import { resetState } from '#tests/helpers/state_fixture';
import { insertProductRows } from '#tests/helpers/product_rows';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color';
import { createIdentity, sessionCookieHeader, signIn } from '#tests/helpers/identities';
import type User from '#models/user';

const ownerEmail = 'bruce.wayne@wayne.example';

/** Resets Japa's disposable database and signs in an owner with actual company memberships. */
export async function resetAuthenticatedData(client: ApiClient, seed: boolean | 'single' = true) {
  await resetState(seed);
  if (!(await db.from('users').where('email', ownerEmail).select('id').first()))
    await createIdentity(ownerEmail, { name: 'Bruce Wayne' });
  const { cookie, cookieHeader, userId } = await signIn(client, ownerEmail);
  const companies = await db.from('companies').select('id');
  const now = new Date().toISOString();
  for (const company of companies)
    await db.table('memberships').insert({
      scope_id: company.id,
      user_id: userId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  return { cookie, cookieHeader, userId };
}

/** Applies a real native session and its current write context to a Japa request. */
export function asDataOwner<T extends ApiRequest>(request: T, cookie: string): T {
  return request
    .setup(async (prepared) => {
      prepared.withCookie('adonis-session', cookie);
      const status = await fetch(new URL('/api/v1/masquerade', prepared.config.baseUrl), {
        headers: {
          'cookie': sessionCookieHeader(cookie),
          'sec-fetch-site': 'same-origin',
        },
      });
      if (!status.ok) throw new Error(`Could not capture masquerade context: ${status.status}`);
      const { data: body } = (await status.json()) as { data: { masqueradeToken?: unknown } };
      if (typeof body.masqueradeToken === 'string' && body.masqueradeToken)
        prepared.header('X-Masquerade-Context', body.masqueradeToken);
    })
    .header('sec-fetch-site', 'same-origin') as T;
}

/** Signs `user` in with `loginAs` and applies their current write context to a Japa request. */
export function asLoggedInDataOwner<T extends ApiRequest>(request: T, user: User): T {
  return request
    .loginAs(user)
    .setup(async (prepared) => {
      // The context token is the identity's, so a separate sign-in may read it.
      const status = await new ApiClient(prepared.config.baseUrl)
        .get('/api/v1/masquerade')
        .loginAs(user)
        .header('sec-fetch-site', 'same-origin');
      if (status.status() !== 200)
        throw new Error(`Could not capture masquerade context: ${status.status()}`);
      const { data: body } = status.body() as { data: { masqueradeToken?: unknown } };
      if (typeof body.masqueradeToken === 'string' && body.masqueradeToken)
        prepared.header('X-Masquerade-Context', body.masqueradeToken);
    })
    .header('sec-fetch-site', 'same-origin') as T;
}

/** Preserves an API client's normal request methods while adding a proved native session. */
export function authenticatedDataClient(client: ApiClient, cookie: string): ApiClient {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'visit']);
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key !== 'string' || !methods.has(key) || typeof value !== 'function')
        return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => asDataOwner(value.apply(target, args), cookie);
    },
  });
}

/** Resets disposable company data and returns a client carrying its owner's real session. */
export async function resetAuthenticatedClient(client: ApiClient, seed: boolean | 'single' = true) {
  const session = await resetAuthenticatedData(client, seed);
  return authenticatedDataClient(client, session.cookie);
}

/** Gives a fixture user explicit standing in a company inserted directly by a test. */
export async function grantDataOwner(userId: string, companyId: string) {
  const existing = await db
    .from('memberships')
    .where({ user_id: userId, scope_id: companyId })
    .first();
  if (existing) return;
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: userId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
}

/** Inserts one isolated company for an existing native test user without clearing other rows. */
export async function createFixtureCompanyForOwner(
  userId: string,
  name: string,
  id: string = randomUUID()
) {
  const companyName = name.trim();
  if (!companyName) throw new Error('A fixture company requires a name.');
  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    const user = await trx.from('users').where('id', userId).select('id').first();
    if (!user) throw new Error('A fixture company requires an existing native user.');
    await insertProductRows(
      'companies',
      [
        {
          id,
          name: companyName,
          color: FALLBACK_PRESET_COLOR,
          schedulingMode: 'days',
          inlineActivityCreateEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      trx
    );
    await insertProductRows('clients', [buildInternalClient(id, now)], trx);
    await trx.table('memberships').insert({
      scope_id: id,
      user_id: userId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    await trx.table('company_planning_revisions').insert({ company_id: id, revision: 1 });
  });
  return id;
}
