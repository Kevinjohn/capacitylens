import { randomUUID } from 'node:crypto';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import { accountId, newAllocation, session } from './helpers.js';

export const allocationsUrl = `/api/accounts/${accountId}/allocations`;
export const note = 'Gotham night shift briefing';

export interface Reply {
  revision: number;
  code?: string;
  restorableItemCount?: number;
  restoration: { consumedGroupId: string | null; replacementGroupId: string };
  projection: { changed: { removed: Array<{ entity: string; id: string }> } };
}

export async function send(
  client: ApiClient,
  cookie: string,
  url: string,
  baseRevision: number,
  intent: Record<string, unknown>,
  mutationId: string = randomUUID(),
  method: 'post' | 'patch' = 'post',
  confirmedRestorationCount?: number
) {
  const response = await session(method === 'post' ? client.post(url) : client.patch(url), cookie)
    .json({
      mutationId,
      baseRevision,
      intent,
      ...(confirmedRestorationCount === undefined ? {} : { confirmedRestorationCount }),
    })
    .send();
  // Only the receipt fields exercised by these restoration tests are read.
  return response as unknown as Omit<typeof response, 'body'> & { body(): Reply };
}

export const deleteOne = (
  client: ApiClient,
  cookie: string,
  id: string,
  baseRevision: number,
  mutationId?: string
) =>
  send(
    client,
    cookie,
    `${allocationsUrl}/${id}/delete`,
    baseRevision,
    { operation: 'allocation.delete', id },
    mutationId
  );

export const deleteGroup = (
  client: ApiClient,
  cookie: string,
  ids: string[],
  baseRevision: number
) =>
  send(client, cookie, `${allocationsUrl}/delete-group`, baseRevision, {
    operation: 'allocation.deleteGroup',
    ids,
  });

export const restore = (
  client: ApiClient,
  cookie: string,
  restorationGroupId: string,
  baseRevision: number,
  mutationId?: string,
  account = accountId
) =>
  send(
    client,
    cookie,
    `/api/accounts/${account}/planning/restore-group`,
    baseRevision,
    { operation: 'planning.restoreGroup', restorationGroupId },
    mutationId
  );

export async function createAllocations(client: ApiClient, cookie: string, count: number) {
  const data = await readState(accountId, true);
  const allocations = Array.from({ length: count }, () => ({
    ...newAllocation(data),
    note,
    task: 'Watchtower rota',
  }));
  const created = await send(client, cookie, `${allocationsUrl}/create-group`, 0, {
    operation: 'allocation.createGroup',
    allocations,
  });
  created.assertStatus(200);
  return allocations.map((row) => row.id);
}

export async function stored(id: string) {
  const state = await readState(accountId, true);
  return state.allocations.find((row) => row.id === id);
}

export async function currentRevision(client: ApiClient, cookie: string, account = accountId) {
  const snapshot = await session(client.get(`/api/accounts/${account}/planning`), cookie).send();
  snapshot.assertStatus(200);
  return Number((snapshot.body() as { revision: number }).revision);
}

export const markers = () => db.from('planning_mutations').where('account_id', accountId);
export const planningAudit = () =>
  db
    .from('audit_entries')
    .where({ account_id: accountId, entity: 'planning' })
    .select('entity_id', 'action');
export const group = (groupId: string) =>
  db.from('deleted_groups').where('group_id', groupId).first();
export async function consumedAt(groupId: string) {
  const row = await group(groupId);
  return row?.consumed_at;
}
