import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { createIdentity } from '#tests/helpers/identities';

export const companyId = 'a-studio';
export const owner = { email: 'bruce.wayne@wayne.example', password: 'batman-secret-2026' };
export const editor = { email: 'dick.grayson@wayne.example', password: 'nightwing-secret-2026' };

export const deleteAccount = (client: ApiClient, cookie: string, currentPassword: string) =>
  asDataOwner(client.visit('api.account.destroy'), cookie).json({ currentPassword }).send();
export const companies = (client: ApiClient, cookie: string) =>
  asDataOwner(client.visit('api.companies.index'), cookie).send();

export async function company() {
  const ownerId = await createIdentity(owner.email, {
    name: 'Bruce Wayne',
    password: owner.password,
  });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId);
  return ownerId;
}

export async function editorMember() {
  const userId = await createIdentity(editor.email, {
    name: 'Dick Grayson',
    password: editor.password,
  });
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    scope_id: companyId,
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
    company_id: companyId,
    user_id: userId,
    resource_id: 'person-dick',
    revision: 'test',
    created_at: now,
    updated_at: now,
  });
  return userId;
}

export async function rowsFor(userId: string) {
  return {
    users: await db.from('users').where('id', userId),
    memberships: await db.from('memberships').where('user_id', userId),
    links: await db.from('account_member_resources').where('user_id', userId),
    admissions: await db.from('account_admissions').where('user_id', userId),
    sessions: await db.from('account_sessions').where('user_id', userId),
  };
}
