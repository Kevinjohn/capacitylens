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
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import type { Allocation, AppData } from '@capacitylens/shared/types/entities';
import { readStateWithClient } from '#services/state_repository';
import { parseAffectedRows } from '#services/affected_rows';
import { buildRetainedQuery, isRetainedTable, type RetainedTable } from './retained_rows.js';
import { tables } from '#services/product_tables';
import { createServerRevision } from '#services/planning/server_timestamp';
import { asRecord, requireExistingRow, type WrittenRow } from './writer.js';
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

function refuseRestorationConflict(): never {
  throw new PlanningOperationError(409, null, 'The deleted records can no longer be restored.');
}

/** Maps expected domain refusals to a restoration conflict while surfacing implementation faults. */
function assertRestorationCandidate(assertion: () => void) {
  try {
    assertion();
  } catch (error) {
    if (error instanceof DomainError) refuseRestorationConflict();
    throw error;
  }
}

/** Saves expected row identities and surviving-child links, then retains the deleted rows. */
export async function deleteRows(
  trx: TransactionClientContract,
  data: AppData,
  companyId: string,
  table: DeletableTable,
  ids: string[],
  identity: RestorationIdentity,
  written: WrittenRow[] = [],
  now = new Date().toISOString()
) {
  const rows = ids.map((id) => requireExistingRow(data, table, id));
  const groupId = randomUUID();
  // Restoration bookkeeping, not a product row.
  await trx.table('deleted_groups').insert({
    group_id: groupId,
    company_id: companyId,
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
  // Restoration bookkeeping, not a product row.
  for (let start = 0; start < saved.length; start += 500) {
    await trx.table('deleted_rows').multiInsert(saved.slice(start, start + 500));
  }
  for (const link of links) {
    const column = link.entity === 'activities' ? 'phase_id' : 'discipline_id';
    const detached = await trx
      .from(tables[link.entity])
      .where({ id: link.rowId, company_id: companyId, [column]: link.parentId })
      .update({ [column]: null });
    if (parseAffectedRows(detached) !== 1) refuseRestorationConflict();
    const child = requireExistingRow(data, link.entity, link.rowId);
    const before = { ...child };
    if ('phaseId' in child) child.phaseId = null;
    else child.disciplineId = null;
    written.push({ entity: link.entity, id: link.rowId, before, after: { ...child } });
  }
  for (let start = 0; start < ids.length; start += 500) {
    const selected = ids.slice(start, start + 500);
    const deleted = await buildRetainedQuery(trx, companyId, table)
      .whereIn('id', selected)
      .softDelete();
    if (deleted !== selected.length) refuseRestorationConflict();
    // Marks the rows deleted above; their entries are recorded below.
    const attached = await trx
      .from(tables[table])
      .where('company_id', companyId)
      .whereIn('id', selected)
      .whereNotNull('deleted_at')
      .whereNull('deletion_group_id')
      .update({ deletion_group_id: groupId });
    if (parseAffectedRows(attached) !== selected.length) refuseRestorationConflict();
  }
  // A deleted retained row is not part of the snapshot, so it leaves `data`.
  const deleted = new Set(ids);
  const stored: AppData[DeletableTable][number][] = data[table];
  for (const row of stored.filter((item) => deleted.has(item.id))) {
    written.push({ entity: table, id: row.id, before: { ...row }, after: null });
  }
  const remaining = stored.filter((row) => !deleted.has(row.id));
  stored.splice(0, stored.length, ...remaining);
  return groupId;
}

/** Existing allocation callers share the same restoration representation. */
export const deleteAllocations = (
  trx: TransactionClientContract,
  data: AppData,
  companyId: string,
  ids: string[],
  identity: RestorationIdentity,
  written: WrittenRow[] = []
) => deleteRows(trx, data, companyId, 'allocations', ids, identity, written);

/** Consumes the caller's group once, restoring parents before selectively relinking survivors. */
export async function restoreGroup(
  trx: TransactionClientContract,
  data: AppData,
  companyId: string,
  groupId: string,
  identity: RestorationIdentity,
  written: WrittenRow[],
  now = new Date().toISOString()
) {
  const owner = {
    group_id: groupId,
    company_id: companyId,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
  };
  // Lucid types the update result as rows; SQLite reports the affected count. Restoration
  // bookkeeping, not a product row.
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
        company_id: companyId,
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
  const rows: Array<{ entity: DeletableTable; id: string; row: AppData[DeletableTable][number] }> =
    [];
  const links: Array<{ entity: 'activities' | 'resources'; rowId: string; parentId: string }> = [];
  for (const item of saved) {
    const payload = JSON.parse(String(item.payload_json)) as SavedRow | SavedLink;
    if (payload.kind === 'row') {
      const entity = item.entity as DeletableTable;
      if (!isRetainedTable(entity)) refuseRestorationConflict();
      const stored = await buildRetainedQuery(trx, companyId, entity)
        .onlyTrashed()
        .where('id', String(item.row_id))
        .where('deletion_group_id', groupId)
        .first();
      if (!stored) refuseRestorationConflict();
      // A retained row serializes to the same fields the snapshot reads for its table.
      rows.push({
        entity,
        id: String(item.row_id),
        row: stored.serialize() as AppData[typeof entity][number],
      });
    } else {
      links.push({
        entity: item.entity as 'activities' | 'resources',
        rowId: String(item.row_id),
        parentId: payload.parentId,
      });
    }
  }
  if (rows.length === 0) refuseRestorationConflict();
  const dependencies = await readStateWithClient(trx, companyId, true);
  const company = dependencies.accounts.find((row) => row.id === companyId);
  const companyWorkingDays = normalizeCompanyWorkingDays(
    company?.workingDays,
    company?.weekStartsOn === 0 ? 0 : 1
  );
  for (const { entity, row } of rows) {
    assertRestorationCandidate(() => {
      if (entity === 'allocations') {
        // The entry's table is allocations, so its row is an allocation.
        const allocation = row as Allocation;
        const activity = dependencies.activities.find((item) => item.id === allocation.activityId);
        if (activity) assertScopedRefs(dependencies, companyId, 'activities', { ...activity });
        assertAllocationRefs(
          dependencies,
          companyId,
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
        assertAllocationPlacement({ allocation, resource, companyWorkingDays });
      }
      if (entity === 'phases') {
        assertScopedRefs(dependencies, companyId, 'phases', asRecord(row));
      }
      if (entity === 'timeOff') {
        assertResourceExists({
          data: dependencies,
          companyId,
          resourceId: String(asRecord(row).resourceId),
        });
      }
    });
  }
  for (const { entity, id, row } of rows) {
    if (row.companyId !== companyId || row.id !== id) refuseRestorationConflict();
    // Clears the deletion mark of the row restored below; its entry is recorded there.
    const cleared = await trx
      .from(tables[entity])
      .where({ id, company_id: companyId, deletion_group_id: groupId })
      .whereNotNull('deleted_at')
      .update({ deletion_group_id: null });
    if (parseAffectedRows(cleared) !== 1) refuseRestorationConflict();
    const restored = await buildRetainedQuery(trx, companyId, entity)
      .onlyTrashed()
      .where('id', id)
      .whereNull('deletion_group_id')
      .restore();
    if (restored !== 1) refuseRestorationConflict();
    const restoredRows: AppData[DeletableTable][number][] = data[entity];
    restoredRows.push({ ...row });
    written.push({ entity, id, before: null, after: { ...row } });
  }
  const current = await readStateWithClient(trx, companyId, true);
  for (const { entity, rowId, parentId } of links) {
    const field = entity === 'activities' ? 'phaseId' : 'disciplineId';
    const column = entity === 'activities' ? 'phase_id' : 'discipline_id';
    const child = current[entity].find((row) => row.id === rowId);
    const parent = current[entity === 'activities' ? 'phases' : 'disciplines'].find(
      (row) => row.id === parentId
    );
    const linked = child && ('phaseId' in child ? child.phaseId : child.disciplineId);
    if (!child || !parent || linked !== null) {
      refuseRestorationConflict();
    }
    const candidate = { ...child, [field]: parentId };
    assertRestorationCandidate(() => {
      assertScopedRefs(current, companyId, entity, candidate, child);
    });
    const updatedAt = createServerRevision(child.updatedAt);
    await trx
      .from(tables[entity])
      .where({ id: rowId, company_id: companyId })
      .whereNull(column)
      .update({ [column]: parentId, updated_at: updatedAt });
    const kept = requireExistingRow(data, entity, rowId);
    const before = { ...kept };
    Object.assign(kept, { [field]: parentId, updatedAt });
    written.push({ entity, id: rowId, before, after: { ...kept } });
    Object.assign(child, candidate);
  }
}

/**
 * Lets a create reuse the id of a row this session deleted and can still restore: the retained
 * row is purged first. Any other existing row with that id refuses the create.
 */
export async function reclaimRetainedId(
  trx: TransactionClientContract,
  companyId: string,
  table: RetainedTable,
  id: string,
  identity: RestorationIdentity
) {
  const prior = await trx
    .from(tables[table])
    .select('company_id', 'deleted_at', 'deletion_group_id')
    .where('id', id)
    .first();
  if (!prior) return;
  if (prior.company_id !== companyId || !prior.deleted_at || !prior.deletion_group_id) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (!(await hasOwnUnconsumedGroup(trx, companyId, String(prior.deletion_group_id), identity))) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  // Purges a row already deleted, which is not in the snapshot; the create that follows records it.
  const purged = await buildRetainedQuery(trx, companyId, table)
    .onlyTrashed()
    .where('id', id)
    .where('deletion_group_id', String(prior.deletion_group_id))
    .forceDelete();
  if (purged !== 1) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
}

/** Whether the caller's own session holds the unconsumed group that retained a row. */
export async function hasOwnUnconsumedGroup(
  trx: TransactionClientContract,
  companyId: string,
  groupId: string,
  identity: Pick<RestorationIdentity, 'actorId' | 'sessionId'>
) {
  const group = await trx
    .from('deleted_groups')
    .where({
      group_id: groupId,
      company_id: companyId,
      actor_id: identity.actorId,
      session_id: identity.sessionId,
    })
    .whereNull('consumed_at')
    .select('group_id')
    .first();
  return Boolean(group);
}

/** Ends every restoration group the company holds; their saved rows are deleted with them. */
export async function discardRestorationGroups(trx: TransactionClientContract, companyId: string) {
  // Restoration bookkeeping, not a product row.
  await trx.from('deleted_groups').where('company_id', companyId).delete();
}

/** Whether this company already committed a mutation with this identity. */
export async function isMutationCommitted(
  trx: TransactionClientContract,
  companyId: string,
  mutationId: string
) {
  const marker = await trx
    .from('planning_mutations')
    .where({ company_id: companyId, mutation_id: mutationId })
    .select('mutation_id')
    .first();
  return Boolean(marker);
}

/** Records a committed mutation, and the restoration group it created, under its identity. */
export async function recordCommittedMutation(
  trx: TransactionClientContract,
  marker: {
    companyId: string;
    mutationId: string;
    actorId: string;
    revision: number;
    restorationGroupId: string | null;
    originSessionId: number | null;
  }
) {
  // The commitment marker, not a product row.
  await trx.table('planning_mutations').insert({
    company_id: marker.companyId,
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
  companyId: string,
  now = new Date().toISOString()
) {
  const markers = await trx
    .from('deleted_rows')
    .join('deleted_groups', 'deleted_groups.group_id', 'deleted_rows.group_id')
    .join('account_sessions', 'account_sessions.id', 'deleted_groups.session_id')
    .where('deleted_groups.company_id', companyId)
    .whereNull('deleted_groups.consumed_at')
    .where('account_sessions.expires_at', '>', now)
    .whereRaw("json_extract(deleted_rows.payload_json, '$.kind') = ?", ['row'])
    .select('deleted_rows.entity', 'deleted_rows.row_id', 'deleted_rows.group_id');
  let total = 0;
  for (const marker of markers) {
    if (!isRetainedTable(marker.entity)) continue;
    const row = await buildRetainedQuery(trx, companyId, marker.entity)
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
