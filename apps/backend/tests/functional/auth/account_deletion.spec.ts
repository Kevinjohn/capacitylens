import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import { resetState } from '#services/state_repository';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { clearIdentities, createIdentity, signIn, expectStatus } from '../../helpers/identities.js';

const accountId = 'a-studio';
const owner = { email: 'bruce.wayne@wayne.example', password: 'batman-secret-2026' };
const editor = { email: 'dick.grayson@wayne.example', password: 'nightwing-secret-2026' };

const required = { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' };

const requestConfirmation = (client: ApiClient, cookie: string, body: object) =>
  asDataOwner(client.post('/api/auth/password-confirmation'), cookie).json(body).send();

async function confirm(client: ApiClient, cookie: string, password: string) {
  const response = await requestConfirmation(client, cookie, {
    action: 'delete-account',
    intent: {},
    password,
  });
  response.assertStatus(200);
  return (response.body() as { confirmationId: string }).confirmationId;
}

interface DeleteAccountInput {
  cookie: string;
  currentPassword: string;
  confirmationId: string;
}

const deleteAccount = (
  client: ApiClient,
  { cookie, currentPassword, confirmationId }: DeleteAccountInput
) =>
  asDataOwner(client.post('/api/auth/delete-account'), cookie)
    .json({ currentPassword, confirmationId })
    .send();
const accounts = (client: ApiClient, cookie: string) =>
  asDataOwner(client.get('/api/accounts'), cookie).send();

async function company() {
  const ownerId = await createIdentity(owner.email, {
    name: 'Bruce Wayne',
    password: owner.password,
  });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  return ownerId;
}

async function editorMember() {
  const userId = await createIdentity(editor.email, {
    name: 'Dick Grayson',
    password: editor.password,
  });
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: accountId,
    user_id: userId,
    role: 'editor',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  await db.table('account_invitations').insert({
    email: 'barbara.gordon@wayne.example',
    scope: '',
    role: 'viewer',
    inviter_id: userId,
    token_hash: 'a'.repeat(64),
    expires_at: '2999-01-01T00:00:00.000Z',
    created_at: now,
    updated_at: now,
  });
  await db.table('account_member_resources').insert({
    id: 'link-dick-person',
    account_id: accountId,
    user_id: userId,
    resource_id: 'person-dick',
    revision: 'test',
    created_at: now,
    updated_at: now,
  });
  return userId;
}

async function rowsFor(userId: string) {
  return {
    users: await db.from('users').where('id', userId),
    memberships: await db.from('memberships').where('user_id', userId),
    links: await db.from('account_member_resources').where('user_id', userId),
    admissions: await db.from('account_admissions').where('user_id', userId),
    sessions: await db.from('account_sessions').where('user_id', userId),
  };
}

test.group('account deletion', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await db.from('account_member_resources').delete();
    await limiter.clear();
  });

  test('a member deletes their account with their memberships and member link', async ({
    client,
    assert,
  }) => {
    await company();
    const userId = await editorMember();
    const { cookie } = await signIn(client, editor.email, editor.password);
    const before = await rowsFor(userId);
    assert.lengthOf(before.memberships, 1);
    assert.lengthOf(before.links, 1);
    assert.lengthOf(before.admissions, 1);
    assert.lengthOf(before.sessions, 1);

    const confirmationId = await confirm(client, cookie, editor.password);
    const deleted = await deleteAccount(client, {
      cookie,
      currentPassword: editor.password,
      confirmationId,
    });
    deleted.assertStatus(200);
    deleted.assertBodyContains({ ok: true, signedOut: true });

    const after = await rowsFor(userId);
    assert.lengthOf(after.users, 0);
    assert.lengthOf(after.memberships, 0);
    assert.lengthOf(after.links, 0);
    assert.lengthOf(after.admissions, 0);
    assert.lengthOf(after.sessions, 0);
    await expectStatus(accounts(client, cookie), 401);
    const audit = await db
      .from('audit_entries')
      .where({ account_id: accountId, action: 'identity.deleted', actor_id: userId });
    assert.lengthOf(audit, 1);
    // The company and its Owner are untouched.
    assert.lengthOf(await db.from('memberships').where('scope_id', accountId), 1);
    // Invitations the person sent stay acceptable without naming them.
    const invitations = await db.from('account_invitations').select('inviter_id');
    assert.lengthOf(invitations, 1);
    assert.isNull(invitations[0].inviter_id);
  });

  test('an Owner is refused until ownership is transferred', async ({ client, assert }) => {
    const ownerId = await company();
    const { cookie } = await signIn(client, owner.email, owner.password);

    const confirmationId = await confirm(client, cookie, owner.password);
    const refused = await deleteAccount(client, {
      cookie,
      currentPassword: owner.password,
      confirmationId,
    });
    refused.assertStatus(409);
    refused.assertBodyContains({ code: 'LAST_OWNER' });

    const after = await rowsFor(ownerId);
    assert.lengthOf(after.users, 1);
    assert.lengthOf(after.memberships, 1);
    assert.lengthOf(after.admissions, 1);
    await expectStatus(accounts(client, cookie), 200);
  });

  test('a wrong password or malformed body changes nothing', async ({ client, assert }) => {
    await company();
    const userId = await editorMember();
    const { cookie } = await signIn(client, editor.email, editor.password);

    const refusedConfirmation = await requestConfirmation(client, cookie, {
      action: 'delete-account',
      intent: {},
      password: 'not-the-password-2026',
    });
    refusedConfirmation.assertStatus(403);
    refusedConfirmation.assertBodyContains({ code: 'PASSWORD_CONFIRMATION_DENIED' });
    const confirmationId = await confirm(client, cookie, editor.password);
    const wrong = await deleteAccount(client, {
      cookie,
      currentPassword: 'not-the-password-2026',
      confirmationId,
    });
    wrong.assertStatus(403);
    wrong.assertBodyContains({ code: 'CURRENT_PASSWORD_INCORRECT' });
    for (const body of [
      { currentPassword: editor.password },
      { currentPassword: editor.password, confirmationId, extra: true },
    ]) {
      const malformed = await asDataOwner(client.post('/api/auth/delete-account'), cookie)
        .json(body)
        .send();
      malformed.assertStatus(400);
    }
    const companyScoped = await requestConfirmation(client, cookie, {
      action: 'delete-account',
      accountId,
      intent: {},
      password: editor.password,
    });
    companyScoped.assertStatus(400);

    const after = await rowsFor(userId);
    assert.lengthOf(after.users, 1);
    assert.lengthOf(after.memberships, 1);
    assert.lengthOf(after.links, 1);
    await expectStatus(accounts(client, cookie), 200);
  });

  test('a missing confirmation is refused', async ({ client, assert }) => {
    await company();
    const userId = await editorMember();
    const { cookie } = await signIn(client, editor.email, editor.password);

    const missing = await deleteAccount(client, {
      cookie,
      currentPassword: editor.password,
      confirmationId: '',
    });
    missing.assertStatus(403);
    assert.deepEqual(missing.body(), required);

    const after = await rowsFor(userId);
    assert.lengthOf(after.users, 1);
    assert.lengthOf(after.memberships, 1);
    await expectStatus(accounts(client, cookie), 200);
  });

  test('a signed-out request is refused', async ({ client }) => {
    await company();
    const response = await client
      .post('/api/auth/delete-account')
      .header('sec-fetch-site', 'same-origin')
      .json({ currentPassword: owner.password, confirmationId: 'none' })
      .send();
    response.assertStatus(401);
  });
});
