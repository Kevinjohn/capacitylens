import { randomUUID } from 'node:crypto';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { readState } from '#tests/helpers/state_fixture';
import { accountId, newAllocation, session } from './helpers.js';

export const allocationsUrl = `/api/companies/${accountId}/allocations`;
export const note = 'Gotham night shift briefing';

export interface Reply {
  revision: number;
  code?: string;
  restorableItemCount?: number;
  restoration: { consumedGroupId: string | null; replacementGroupId: string };
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
    `/api/companies/${account}/planning/restore-group`,
    baseRevision,
    { operation: 'planning.restoreGroup', restorationGroupId },
    mutationId
  );

/** Creates `count` allocations in one mutation: one create, or a weekly repeat of `count` occurrences. */
export async function createAllocations(client: ApiClient, cookie: string, count: number) {
  const data = await readState(accountId, true);
  const allocation = { ...newAllocation(data), note, task: 'Watchtower rota' };
  const occurrenceIds = Array.from({ length: count - 1 }, () => randomUUID());
  const created =
    count === 1
      ? await send(client, cookie, allocationsUrl, 0, {
          operation: 'allocation.create',
          allocation,
        })
      : await send(client, cookie, `${allocationsUrl}/create-group`, 0, {
          operation: 'allocation.createGroup',
          allocation,
          repeat: {
            pattern: { kind: 'weeks', interval: 1 },
            until: addDaysISO(allocation.startDate, 7 * (count - 1)),
          },
          occurrenceIds,
        });
  created.assertStatus(200);
  return [allocation.id, ...occurrenceIds];
}

export async function stored(id: string) {
  const state = await readState(accountId, true);
  return state.allocations.find((row) => row.id === id);
}

/** Allocation ids in the planning read the browser replaces its slice from. */
export async function readAllocationIds(client: ApiClient, cookie: string) {
  const snapshot = await session(client.get(`/api/companies/${accountId}/planning`), cookie).send();
  snapshot.assertStatus(200);
  return (snapshot.body() as { data: { allocations: Array<{ id: string }> } }).data.allocations.map(
    (row) => row.id
  );
}

export async function currentRevision(client: ApiClient, cookie: string, account = accountId) {
  const snapshot = await session(client.get(`/api/companies/${account}/planning`), cookie).send();
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
