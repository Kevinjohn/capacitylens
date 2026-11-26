import db from '@adonisjs/lucid/services/db';
import type { ApiRequest } from '@japa/api-client';
import User from '#models/user';
import { createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture';
import { signUpAndIn } from '#tests/helpers/identities';
import { StorageMaintenanceService } from '#services/storage_maintenance_service';
import { ClientFactory } from '#database/factories/client_factory';
import { UserFactory } from '#database/factories/user_factory';
import { DateTime } from 'luxon';

export const storageMaintenance = new StorageMaintenanceService();

export const password = 'batman-secret-2026';

/**
 * Signs `request` in as `user` with `loginAs`, or with a sign-in's session `cookie` where a test
 * depends on that one sign-in, and sends the masquerade context when given.
 */
export function asSession<T extends ApiRequest>(
  request: T,
  credential: string | User,
  context?: string
): T {
  const signedIn =
    typeof credential === 'string'
      ? request.setup((prepared) => {
          prepared.withCookie('adonis-session', credential);
        })
      : request.loginAs(credential);
  return context ? signedIn.header('X-Masquerade-Context', context) : signedIn;
}

/** A verified identity with no password, made by the model factory once a company exists. */
export function verifiedIdentity(email: string, displayName: string) {
  return db.transaction((trx) =>
    UserFactory.client(trx).merge({ email, displayName, emailVerifiedAt: DateTime.now() }).create()
  );
}

export async function masqueradeToken(client: any, cookie: string) {
  const response = await asSession(client.visit('api.masquerade.show'), cookie).send();
  response.assertStatus(200);
  const token = response.body().data?.masqueradeToken;
  if (typeof token !== 'string') throw new Error('Masquerade context token was not returned.');
  return token;
}

export async function startView(client: any, cookie: string, targetUserId: string) {
  const token = await masqueradeToken(client, cookie);
  return asSession(
    client
      .visit('api.masquerade.store', { companyId: 'a-studio' })
      .header('sec-fetch-site', 'same-origin'),
    cookie,
    token
  )
    .json({ targetUserId })
    .send();
}

export async function fixture(client: any, targetRole: 'viewer' | 'editor' | 'admin' = 'viewer') {
  const owner = await signUpAndIn(client, {
    email: 'bruce.wayne@wayne.example',
    password,
    name: 'Bruce Wayne',
  });
  owner.assertStatus(200);
  const cookie = owner.cookie('adonis-session')!.value;
  const ownerId = String((owner.body().data as { user: { id: string } }).user.id);
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
  const { id: targetId } = await verifiedIdentity('clark.kent@wayne.example', 'Clark Kent');
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: 'a-studio',
    user_id: targetId,
    role: targetRole,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  return { cookie, ownerId, targetId, owner: await User.findOrFail(ownerId) };
}

/** `fixture` with the signed-in viewer as an Admin under a separate company Owner, Diana Prince. */
export async function adminFixture(
  client: any,
  targetRole: 'viewer' | 'editor' | 'admin' = 'editor'
) {
  const { cookie, ownerId: adminId, targetId, owner } = await fixture(client, targetRole);
  const { id: companyOwnerId } = await verifiedIdentity(
    'diana.prince@themyscira.example',
    'Diana Prince'
  );
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: 'a-studio',
    user_id: companyOwnerId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: adminId })
    .update({ role: 'admin' });
  return { cookie, adminId, companyOwnerId, targetId, owner };
}

/** Makes the target the Owner of a-studio and the former Owner an Admin, as a transfer would. */
export async function promoteToOwner(targetId: string, formerOwnerId: string) {
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: formerOwnerId })
    .update({ role: 'admin' });
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: targetId })
    .update({ role: 'owner' });
}

export const privateClientName = 'Wayne Confidential Client';

/** A private a-studio client whose real name only an effective Owner receives. */
export async function insertPrivateClient() {
  await ClientFactory.merge({
    companyId: 'a-studio',
    name: privateClientName,
    codeName: 'Nightwing',
    color: '#123456',
    isPrivate: true,
  }).create();
}

export async function endView(client: any, cookie: string) {
  const token = await masqueradeToken(client, cookie);
  const ended = await asSession(
    client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
    cookie,
    token
  )
    .json({ token, reason: 'explicit' })
    .send();
  ended.assertStatus(200);
}
