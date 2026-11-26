import { randomUUID } from 'node:crypto';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { readState } from '#tests/helpers/state_fixture';
import { companyId, newAllocation, session } from '#tests/functional/planning/helpers';

export const note = 'Gotham night shift briefing';

export interface Reply {
  revision: number;
  restoration: { consumedGroupId: string | null; replacementGroupId: string };
}

/** A success is wrapped in `data`; a refusal is flat. */
interface ReplyBody {
  data: Reply;
  code?: string;
  restorableItemCount?: number;
}

export async function send(
  client: ApiClient,
  cookie: string,
  company: string,
  baseRevision: number,
  intent: Record<string, unknown>,
  mutationId: string = randomUUID(),
  confirmedRestorationCount?: number
) {
  const response = await session(
    client.visit('api.planning_mutations.store', { companyId: company }),
    cookie
  )
    .json({
      mutationId,
      baseRevision,
      intent,
      ...(confirmedRestorationCount === undefined ? {} : { confirmedRestorationCount }),
    })
    .send();
  // Only the receipt fields exercised by these restoration tests are read.
  return response as unknown as Omit<typeof response, 'body'> & { body(): ReplyBody };
}

export const deleteOne = (
  client: ApiClient,
  cookie: string,
  id: string,
  baseRevision: number,
  mutationId?: string
) =>
  send(client, cookie, companyId, baseRevision, { operation: 'allocation.delete', id }, mutationId);

export const deleteGroup = (
  client: ApiClient,
  cookie: string,
  ids: string[],
  baseRevision: number
) =>
  send(client, cookie, companyId, baseRevision, {
    operation: 'allocation.deleteGroup',
    ids,
  });

export const restore = (
  client: ApiClient,
  cookie: string,
  restorationGroupId: string,
  baseRevision: number,
  mutationId?: string,
  company = companyId
) =>
  send(
    client,
    cookie,
    company,
    baseRevision,
    { operation: 'planning.restoreGroup', restorationGroupId },
    mutationId
  );

/** Creates `count` allocations in one mutation: one create, or a weekly repeat of `count` occurrences. */
export async function createAllocations(client: ApiClient, cookie: string, count: number) {
  const data = await readState(companyId, true);
  const allocation = { ...newAllocation(data), note, task: 'Watchtower rota' };
  const created =
    count === 1
      ? await send(client, cookie, companyId, 0, {
          operation: 'allocation.create',
          allocation,
        })
      : await send(client, cookie, companyId, 0, {
          operation: 'allocation.createGroup',
          allocation,
          repeat: {
            pattern: { kind: 'weeks', interval: 1 },
            until: addDaysISO(allocation.startDate, 7 * (count - 1)),
          },
        });
  created.assertStatus(200);
  return count === 1 ? [allocation.id] : listCreatedAllocationIds(created.body().data);
}

export async function stored(id: string) {
  const state = await readState(companyId, true);
  return state.allocations.find((row) => row.id === id);
}

/** Allocation ids in the planning read the browser replaces its slice from. */
export async function readAllocationIds(client: ApiClient, cookie: string) {
  const snapshot = await session(client.visit('api.planning.show', { companyId }), cookie).send();
  snapshot.assertStatus(200);
  return (
    snapshot.body().data as { data: { allocations: Array<{ id: string }> } }
  ).data.allocations.map((row) => row.id);
}

export async function currentRevision(client: ApiClient, cookie: string, company = companyId) {
  const snapshot = await session(
    client.visit('api.planning.show', { companyId: company }),
    cookie
  ).send();
  snapshot.assertStatus(200);
  return Number((snapshot.body().data as { revision: number }).revision);
}

export const markers = () => db.from('planning_mutations').where('company_id', companyId);
export const planningAudit = () =>
  db
    .from('audit_entries')
    .where({ company_id: companyId, entity: 'planning' })
    .select('entity_id', 'action');
export const group = (groupId: string) =>
  db.from('deleted_groups').where('group_id', groupId).first();
export async function consumedAt(groupId: string) {
  const row = await group(groupId);
  return row?.consumed_at;
}

/** The allocation ids a receipt created, earliest start first; the server mints a repeat's later ids. */
export function listCreatedAllocationIds(receipt: unknown): string[] {
  const { changes } = receipt as {
    changes: { upserts: Array<{ entity: string; row: { id: string; startDate: string } }> };
  };
  return changes.upserts
    .filter((change) => change.entity === 'allocations')
    .map((change) => change.row)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((row) => row.id);
}
