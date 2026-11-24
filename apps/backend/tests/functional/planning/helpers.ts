import { randomUUID } from 'node:crypto';
import type { ApiClient, ApiRequest } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import env from '#start/env';
import { seed } from '@capacitylens/shared/data/seed';
import { type AppData } from '@capacitylens/shared/types/entities';
import { resetState } from '#tests/helpers/state_fixture';
import {
  clearIdentities,
  createIdentity,
  signIn as signInIdentity,
} from '#tests/helpers/identities';
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import User from '#models/user';

export const companyId = 'a-studio';

/** The sentence of a validation refusal: the first message of its 422 `{ errors }` body. */
export const validationSentence = (response: { body(): unknown }) =>
  (response.body() as { errors?: Array<{ message?: unknown }> }).errors?.[0]?.message;
export const planningUrl = `/api/companies/${companyId}/planning`;
const password = 'batman-secret-2026';

export const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin');

/** A real session cookie, or a user each request signs in afresh with `loginAs`. */
export type Credential = string | User;

export function session<T extends ApiRequest>(request: T, cookie: Credential): T {
  return typeof cookie === 'string'
    ? asDataOwner(request, cookie)
    : asLoggedInDataOwner(request, cookie);
}

export function configureAuth(cleanup: (callback: () => void) => void) {
  const prior = env.get('CAPACITYLENS_RATE_LIMIT');
  env.set('CAPACITYLENS_RATE_LIMIT', '0');
  cleanup(() => env.set('CAPACITYLENS_RATE_LIMIT', prior as never));
}

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** A real password sign-in establishes the Account Kit session; membership is fixture data. */
export async function signIn(client: ApiClient, role: Role = 'owner') {
  const email = `bruce-${randomUUID()}@wayne.example`;
  const userId = await createIdentity(email, { name: 'Bruce Wayne', password });
  const cookie = await signInAgain(client, email);
  await joinCompany(userId, role);
  return { cookie, userId, email };
}

/**
 * The same member as `signIn` without the password round trip: `session` signs `cookie` in with
 * `loginAs` on every request, so nothing bound to one session lasts from one request to the next.
 */
export async function loginAsMember(role: Role = 'owner') {
  const email = `bruce-${randomUUID()}@wayne.example`;
  const userId = await createIdentity(email, { name: 'Bruce Wayne', password });
  await joinCompany(userId, role);
  return { cookie: await User.findOrFail(userId), userId, email };
}

async function joinCompany(userId: string, role: Role) {
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: userId,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
}

/** A real password sign-in opens another native session for an existing user. */
export async function signInAgain(client: ApiClient, email: string) {
  const signInResult = await signInIdentity(client, email, password);
  return signInResult.cookie;
}

export async function resetPlanningFixture(): Promise<AppData> {
  await clearIdentities();
  await db.from('rate_limits').delete();
  await resetState(false);
  await resetState(true);
  const data = seed();
  return data;
}

export function newAllocation(data: AppData) {
  const resource = data.resources.find(
    (row) => row.companyId === companyId && row.kind === 'person' && !row.archivedAt
  )!;
  const activity = data.activities.find(
    (row) => row.companyId === companyId && row.kind === 'internal' && !row.archivedAt
  )!;
  return {
    id: randomUUID(),
    resourceId: resource.id,
    activityId: activity.id,
    projectId: null,
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    hoursPerDay: 7.5,
    status: 'confirmed' as const,
  };
}
