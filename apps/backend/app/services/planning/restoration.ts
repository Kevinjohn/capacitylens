import { randomUUID } from 'node:crypto';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '@capacitylens/shared/domain/mutations';
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement';
import { DomainError } from '@capacitylens/shared/domain/errors';
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import type { Allocation, AppData } from '@capacitylens/shared/types/entities';
import { readStateWithClient } from '#services/state_repository';
import { affectedRows } from '#services/affected_rows';
import { retainedQuery, isRetainedTable, type RetainedTable } from './retained_rows.js';
import { tables } from '#services/product_tables';
import { createServerRevision } from '#services/planning/server_timestamp';
import { existingRow } from './writer.js';
import { PlanningOperationError } from './errors.js';

/** The identities that bind a restoration group to one actor's native session and mutation. */
export interface RestorationIdentity {
  actorId: string;
  sessionId: number;
  mutationId: string;
}

type DeletableTable = RetainedTable;
type SavedRow = { kind: 'row' };
type SavedLink = { kind: 'link'; parentId: string };

function conflict(): never {
  throw new PlanningOperationError(409, null, 'The deleted records can no longer be restored.');
}

/** Maps expected domain refusals to a restoration conflict while surfacing implementation faults. */
function assertRestorationCandidate(assertion: () => void) {
  try {
    assertion();
  } catch (error) {
    if (error instanceof DomainError) conflict();
    throw error;
  }
}

/** Saves expected row identities and surviving-child links, then retains the deleted rows. */
export async function deleteRows(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  table: DeletableTable,
  ids: string[],
  identity: RestorationIdentity,
  now = new Date().toISOString()
) {
  const rows = ids.map((id) => existingRow(data, table, id));
  const groupId = randomUUID();
  await trx.table('deleted_groups').insert({
    group_id: groupId,
    account_id: accountId,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
    mutation_id: identity.mutationId,
    created_at: now,
    consumed_at: null,
  });
  const links = rows.flatMap<{
    entity: 'activities' | 'resources';
    rowId: string;
    parentId: string;
  }>((row) =>
    table === 'phases'
      ? data.activities
          .filter((child) => child.phaseId === row.id)
          .map((child) => ({ entity: 'activities', rowId: child.id, parentId: row.id }))
      : table === 'disciplines'
        ? data.resources
            .filter((child) => child.disciplineId === row.id)
            .map((child) => ({ entity: 'resources', rowId: child.id, parentId: row.id }))
        : []
  );
  const saved = [
    ...rows.map((row) => ({
      group_id: groupId,
      entity: table,
      row_id: row.id,
      payload_json: JSON.stringify({ kind: 'row' } satisfies SavedRow),
    })),
    ...links.map((link) => ({
      group_id: groupId,
      entity: link.entity,
      row_id: link.rowId,
      payload_json: JSON.stringify({ kind: 'link', parentId: link.parentId } satisfies SavedLink),
    })),
  ];
  // SQLite bounds compound inserts and variables; all slices remain in the caller's transaction.
  for (let start = 0; start < saved.length; start += 500) {
    await trx.table('deleted_rows').multiInsert(saved.slice(start, start + 500));
  }
  for (const link of links) {
    const column = link.entity === 'activities' ? 'phase_id' : 'discipline_id';
    const detached = await trx
      .from(tables[link.entity])
      .where({ id: link.rowId, account_id: accountId, [column]: link.parentId })
      .update({ [column]: null });
    if (affectedRows(detached) !== 1) conflict();
  }
  for (let start = 0; start < ids.length; start += 500) {
    const selected = ids.slice(start, start + 500);
    const deleted = await retainedQuery(trx, accountId, table).whereIn('id', selected).softDelete();
    if (deleted !== selected.length) conflict();
    const attached = await trx
      .from(tables[table])
      .where('account_id', accountId)
      .whereIn('id', selected)
      .whereNotNull('deleted_at')
      .whereNull('deletion_group_id')
      .update({ deletion_group_id: groupId });
    if (affectedRows(attached) !== selected.length) conflict();
  }
  return groupId;
}

/** Existing allocation callers share the same restoration representation. */
export const deleteAllocations = (
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  ids: string[],
  identity: RestorationIdentity
) => deleteRows(trx, data, accountId, 'allocations', ids, identity);

/** Consumes the caller's group once, restoring parents before selectively relinking survivors. */
export async function restoreGroup(
  trx: TransactionClientContract,
  accountId: string,
  groupId: string,
  identity: RestorationIdentity,
  now = new Date().toISOString()
) {
  const owner = {
    group_id: groupId,
    account_id: accountId,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
  };
  // Lucid types the update result as rows; SQLite reports the affected count.
  const consumed = Number(
    await trx
      .from('deleted_groups')
      .where(owner)
      .whereNull('consumed_at')
      .update({ consumed_at: now })
  );
  if (consumed === 0) {
    if (await trx.from('deleted_groups').where(owner).select('group_id').first()) {
      throw new PlanningOperationError(409, null, 'This deletion has already been restored.');
    }
    const origin = await trx
      .from('planning_mutations')
      .where({
        account_id: accountId,
        actor_id: identity.actorId,
        origin_session_id: identity.sessionId,
        restoration_group_id: groupId,
      })
      .select('mutation_id')
      .first();
    if (origin) {
      throw new PlanningOperationError(409, null, 'This deletion can no longer be restored.');
    }
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  const saved = await trx
    .from('deleted_rows')
    .where({ group_id: groupId })
    .select('entity', 'row_id', 'payload_json');
  const rows: Array<{ entity: DeletableTable; id: string; row: Record<string, unknown> }> = [];
  const links: Array<{ entity: 'activities' | 'resources'; rowId: string; parentId: string }> = [];
  for (const item of saved) {
    const payload = JSON.parse(String(item.payload_json)) as SavedRow | SavedLink;
    if (payload.kind === 'row') {
      const entity = item.entity as DeletableTable;
      if (!isRetainedTable(entity)) conflict();
      const stored = await retainedQuery(trx, accountId, entity)
        .onlyTrashed()
        .where('id', String(item.row_id))
        .where('deletion_group_id', groupId)
        .first();
      if (!stored) conflict();
      rows.push({ entity, id: String(item.row_id), row: stored.serialize() });
    } else {
      links.push({
        entity: item.entity as 'activities' | 'resources',
        rowId: String(item.row_id),
        parentId: payload.parentId,
      });
    }
  }
  if (rows.length === 0) conflict();
  const dependencies = await readStateWithClient(trx, accountId, true);
  const account = dependencies.accounts.find((row) => row.id === accountId);
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn === 0 ? 0 : 1
  );
  for (const { entity, row } of rows) {
    assertRestorationCandidate(() => {
      if (entity === 'allocations') {
        // Retained rows are read as plain records, so they do not overlap the entity type.
        const allocation = row as unknown as Allocation;
        const activity = dependencies.activities.find((item) => item.id === allocation.activityId);
        if (activity) assertScopedRefs(dependencies, accountId, 'activities', { ...activity });
        assertAllocationRefs(
          dependencies,
          accountId,
          allocation.resourceId,
          allocation.activityId,
          allocation.hoursPerDay,
          allocation.projectId
        );
        assertDateRange(allocation.startDate, allocation.endDate);
        const resource = dependencies.resources.find((item) => item.id === allocation.resourceId);
        if (!resource) {
          throw new Error('The allocation reference check above guarantees the resource exists.');
        }
        assertAllocationPlacement({ allocation, resource, accountWorkingDays });
      }
      if (entity === 'phases') assertScopedRefs(dependencies, accountId, 'phases', row);
      if (entity === 'timeOff') {
        assertResourceExists(dependencies, accountId, String(row.resourceId));
      }
    });
  }
  for (const { entity, id, row } of rows) {
    if (row.accountId !== accountId || row.id !== id) conflict();
    const cleared = await trx
      .from(tables[entity])
      .where({ id, account_id: accountId, deletion_group_id: groupId })
      .whereNotNull('deleted_at')
      .update({ deletion_group_id: null });
    if (affectedRows(cleared) !== 1) conflict();
    const restored = await retainedQuery(trx, accountId, entity)
      .onlyTrashed()
      .where('id', id)
      .whereNull('deletion_group_id')
      .restore();
    if (restored !== 1) conflict();
  }
  const current = await readStateWithClient(trx, accountId, true);
  for (const { entity, rowId, parentId } of links) {
    const field = entity === 'activities' ? 'phaseId' : 'disciplineId';
    const column = entity === 'activities' ? 'phase_id' : 'discipline_id';
    const child = current[entity].find((row) => row.id === rowId);
    const parent = current[entity === 'activities' ? 'phases' : 'disciplines'].find(
      (row) => row.id === parentId
    );
    // The link field differs by table, and an entity interface has no index signature.
    if (!child || !parent || (child as unknown as Record<string, unknown>)[field] !== null) {
      conflict();
    }
    const candidate = { ...child, [field]: parentId };
    assertRestorationCandidate(() => {
      assertScopedRefs(current, accountId, entity, candidate, child);
    });
    await trx
      .from(tables[entity])
      .where({ id: rowId, account_id: accountId })
      .whereNull(column)
      .update({ [column]: parentId, updated_at: createServerRevision(child.updatedAt) });
    Object.assign(child, candidate);
  }
}

/**
 * Lets a create reuse the id of a row this session deleted and can still restore: the retained
 * row is purged first. Any other existing row with that id refuses the create.
 */
export async function reclaimRetainedId(
  trx: TransactionClientContract,
  accountId: string,
  table: RetainedTable,
  id: string,
  identity: RestorationIdentity
) {
  const prior = await trx
    .from(tables[table])
    .select('account_id', 'deleted_at', 'deletion_group_id')
    .where('id', id)
    .first();
  if (!prior) return;
  if (prior.account_id !== accountId || !prior.deleted_at || !prior.deletion_group_id) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (!(await ownsUnconsumedGroup(trx, accountId, String(prior.deletion_group_id), identity))) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  const purged = await retainedQuery(trx, accountId, table)
    .onlyTrashed()
    .where('id', id)
    .where('deletion_group_id', String(prior.deletion_group_id))
    .forceDelete();
  if (purged !== 1) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
}

/** Whether the caller's own session holds the unconsumed group that retained a row. */
export async function ownsUnconsumedGroup(
  trx: TransactionClientContract,
  accountId: string,
  groupId: string,
  identity: Pick<RestorationIdentity, 'actorId' | 'sessionId'>
) {
  const group = await trx
    .from('deleted_groups')
    .where({
      group_id: groupId,
      account_id: accountId,
      actor_id: identity.actorId,
      session_id: identity.sessionId,
    })
    .whereNull('consumed_at')
    .select('group_id')
    .first();
  return Boolean(group);
}

/** Ends every restoration group the company holds; their saved rows are deleted with them. */
export async function discardRestorationGroups(trx: TransactionClientContract, accountId: string) {
  await trx.from('deleted_groups').where('account_id', accountId).delete();
}

/** Whether this company already committed a mutation with this identity. */
export async function isMutationCommitted(
  trx: TransactionClientContract,
  accountId: string,
  mutationId: string
) {
  const marker = await trx
    .from('planning_mutations')
    .where({ account_id: accountId, mutation_id: mutationId })
    .select('mutation_id')
    .first();
  return Boolean(marker);
}

/** Records a committed mutation, and the restoration group it created, under its identity. */
export async function recordCommittedMutation(
  trx: TransactionClientContract,
  marker: {
    accountId: string;
    mutationId: string;
    actorId: string;
    revision: number;
    restorationGroupId: string | null;
    originSessionId: number | null;
  }
) {
  await trx.table('planning_mutations').insert({
    account_id: marker.accountId,
    mutation_id: marker.mutationId,
    actor_id: marker.actorId,
    revision: marker.revision,
    restoration_group_id: marker.restorationGroupId,
    origin_session_id: marker.originSessionId,
  });
}

/**
 * Counts deleted records across every pending company group whose sign-in is still live;
 * surviving-child links are not items. An expired sign-in's groups wait only for pruning.
 */
export async function countRestorableItems(
  trx: TransactionClientContract,
  accountId: string,
  now = new Date().toISOString()
) {
  const markers = await trx
    .from('deleted_rows')
    .join('deleted_groups', 'deleted_groups.group_id', 'deleted_rows.group_id')
    .join('account_sessions', 'account_sessions.id', 'deleted_groups.session_id')
    .where('deleted_groups.account_id', accountId)
    .whereNull('deleted_groups.consumed_at')
    .where('account_sessions.expires_at', '>', now)
    .whereRaw("json_extract(deleted_rows.payload_json, '$.kind') = ?", ['row'])
    .select('deleted_rows.entity', 'deleted_rows.row_id', 'deleted_rows.group_id');
  let total = 0;
  for (const marker of markers) {
    if (!isRetainedTable(marker.entity)) continue;
    const row = await retainedQuery(trx, accountId, marker.entity)
      .onlyTrashed()
      .where('id', marker.row_id)
      .where('deletion_group_id', marker.group_id)
      .first();
    if (row) total++;
  }
  return total;
}

/** Carries only the count required for an explicit, revision-bound cleanup decision. */
export class RestorationConfirmationError extends PlanningOperationError {
  declare readonly code: 'RESTORATION_CONFIRMATION_REQUIRED' | 'RESTORATION_CONFIRMATION_STALE';

  constructor(
    readonly restorableItemCount: number,
    stale: boolean
  ) {
    super(
      409,
      stale ? 'RESTORATION_CONFIRMATION_STALE' : 'RESTORATION_CONFIRMATION_REQUIRED',
      stale
        ? 'The restorable items changed. Review this change again.'
        : `This change clears ${restorableItemCount} restorable ${restorableItemCount === 1 ? 'item' : 'items'}`
    );
  }
}
