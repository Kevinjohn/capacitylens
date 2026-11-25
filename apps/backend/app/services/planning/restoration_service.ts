import { randomUUID } from 'node:crypto';
import { inject } from '@adonisjs/core';
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
import { StateRepositoryService } from '#services/state_repository_service';
import { parseAffectedRows } from '#models_support/affected_rows';
import { RetainedRowService, type RetainedTable } from '#services/planning/retained_row_service';
import { tables } from '#models_support/product_tables';
import { companyRows, productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import { transformRow } from '#transformers/row_transformer';
import { createServerRevision } from '#services/planning/server_timestamp';
import { asRecord, requireExistingRow, type WrittenRow } from '#services/planning/writer';
import ValidationRefusalException from '#exceptions/validation_refusal_exception';
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception';
import PlanningConflictException from '#exceptions/planning_conflict_exception';

/** The identities that bind a restoration group to one actor's native session and mutation. */
export interface RestorationIdentity {
  actorId: string;
  sessionId: number;
  mutationId: string;
}

type DeletableTable = RetainedTable;
type RetainedRow = InstanceType<(typeof productModels)[RetainedTable]>;
type SavedRow = { kind: 'row' };
type SavedLink = { kind: 'link'; parentId: string };

function refuseRestorationConflict(): never {
  throw new PlanningConflictException('The deleted records can no longer be restored.');
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

/** Restoration groups and commitment markers, kept in the caller's transaction. */
@inject()
export class RestorationService {
  #stateRepository: StateRepositoryService;
  #retainedRows: RetainedRowService;

  constructor(stateRepository: StateRepositoryService, retainedRows: RetainedRowService) {
    this.#stateRepository = stateRepository;
    this.#retainedRows = retainedRows;
  }

  /** Saves expected row identities and surviving-child links, then retains the deleted rows. */
  async deleteRows(
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
    // Detaches each deleted parent's surviving children; every child must still name that parent.
    const childEntity = table === 'phases' ? 'activities' : 'resources';
    const column = table === 'phases' ? 'phase_id' : 'discipline_id';
    for (const row of rows) {
      const childIds = links.filter((link) => link.parentId === row.id).map((link) => link.rowId);
      for (let start = 0; start < childIds.length; start += 500) {
        const selected = childIds.slice(start, start + 500);
        const detached = await companyRows(childEntity, companyId, trx)
          .where(column, row.id)
          .whereIn('id', selected)
          .update({ [column]: null });
        if (parseAffectedRows(detached) !== selected.length) refuseRestorationConflict();
      }
    }
    for (const link of links) {
      const child = requireExistingRow(data, link.entity, link.rowId);
      const before = { ...child };
      if ('phaseId' in child) child.phaseId = null;
      else child.disciplineId = null;
      written.push({ entity: link.entity, id: link.rowId, before, after: { ...child } });
    }
    for (let start = 0; start < ids.length; start += 500) {
      const selected = ids.slice(start, start + 500);
      // Only live rows load, so a row already deleted or missing refuses the whole deletion.
      const live = await this.#retainedRows
        .buildRetainedQuery(trx, companyId, table)
        .whereIn('id', selected);
      if (live.length !== selected.length) refuseRestorationConflict();
      // Marks each row deleted in its group in one statement; their entries are recorded below.
      for (const row of live) {
        row.deletionGroupId = groupId;
        await row.delete();
      }
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
  deleteAllocations(
    trx: TransactionClientContract,
    data: AppData,
    companyId: string,
    ids: string[],
    identity: RestorationIdentity,
    written: WrittenRow[] = []
  ) {
    return this.deleteRows(trx, data, companyId, 'allocations', ids, identity, written);
  }

  /** Consumes the caller's group once, restoring parents before selectively relinking survivors. */
  async restoreGroup(
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
        throw new PlanningConflictException('This deletion has already been restored.');
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
        throw new PlanningConflictException('This deletion can no longer be restored.');
      }
      throw new PlanningAuthorizationException();
    }
    const saved = await trx
      .from('deleted_rows')
      .where({ group_id: groupId })
      .select('entity', 'row_id', 'payload_json');
    const rows: Array<{
      entity: DeletableTable;
      id: string;
      row: AppData[DeletableTable][number];
      stored: RetainedRow;
    }> = [];
    const links: Array<{ entity: 'activities' | 'resources'; rowId: string; parentId: string }> =
      [];
    for (const item of saved) {
      const payload = JSON.parse(String(item.payload_json)) as SavedRow | SavedLink;
      if (payload.kind === 'row') {
        const entity = item.entity as DeletableTable;
        if (!this.#retainedRows.isRetainedTable(entity)) refuseRestorationConflict();
        const stored = await this.#retainedRows
          .buildRetainedQuery(trx, companyId, entity)
          .onlyTrashed()
          .where('id', String(item.row_id))
          .where('deletion_group_id', groupId)
          .first();
        if (!stored) refuseRestorationConflict();
        // A retained row serializes to the same fields the snapshot reads for its table.
        rows.push({
          entity,
          id: String(item.row_id),
          row: transformRow(stored) as AppData[typeof entity][number],
          stored,
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
    const dependencies = await this.#stateRepository.readStateWithClient(trx, companyId, true);
    const company = dependencies.companies.find((row) => row.id === companyId);
    const companyWorkingDays = normalizeCompanyWorkingDays(
      company?.workingDays,
      company?.weekStartsOn === 0 ? 0 : 1
    );
    for (const { entity, row } of rows) {
      assertRestorationCandidate(() => {
        if (entity === 'allocations') {
          // The entry's table is allocations, so its row is an allocation.
          const allocation = row as Allocation;
          const activity = dependencies.activities.find(
            (item) => item.id === allocation.activityId
          );
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
    for (const { entity, id, row, stored } of rows) {
      if (row.companyId !== companyId || row.id !== id) refuseRestorationConflict();
      // Loaded above as this group's deleted row; one statement clears its group and deletion.
      stored.deletionGroupId = null;
      await stored.restore();
      const restoredRows: AppData[DeletableTable][number][] = data[entity];
      restoredRows.push({ ...row });
      written.push({ entity, id, before: null, after: { ...row } });
    }
    const current = await this.#stateRepository.readStateWithClient(trx, companyId, true);
    for (const { entity, rowId, parentId } of links) {
      const field = entity === 'activities' ? 'phaseId' : 'disciplineId';
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
      // The read above, in this transaction, found the child live and unlinked.
      const relinked = await companyRows(entity, companyId, trx).where('id', rowId).first();
      if (!relinked) refuseRestorationConflict();
      await relinked
        .merge(rowAttributes(productModels[entity], { ...candidate, updatedAt }))
        .save();
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
  async reclaimRetainedId(
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
      throw new ValidationRefusalException('The record already exists.');
    }
    if (
      !(await this.hasOwnUnconsumedGroup(trx, companyId, String(prior.deletion_group_id), identity))
    ) {
      throw new ValidationRefusalException('The record already exists.');
    }
    // Purges a row already deleted, which is not in the snapshot; the create that follows records it.
    const purged = await this.#retainedRows
      .buildRetainedQuery(trx, companyId, table)
      .onlyTrashed()
      .where('id', id)
      .where('deletion_group_id', String(prior.deletion_group_id))
      .forceDelete();
    if (purged !== 1) {
      throw new ValidationRefusalException('The record already exists.');
    }
  }

  /** Whether the caller's own session holds the unconsumed group that retained a row. */
  async hasOwnUnconsumedGroup(
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
  async discardRestorationGroups(trx: TransactionClientContract, companyId: string) {
    // Restoration bookkeeping, not a product row.
    await trx.from('deleted_groups').where('company_id', companyId).delete();
  }

  /** Whether this company already committed a mutation with this identity. */
  async isMutationCommitted(trx: TransactionClientContract, companyId: string, mutationId: string) {
    const marker = await trx
      .from('planning_mutations')
      .where({ company_id: companyId, mutation_id: mutationId })
      .select('mutation_id')
      .first();
    return Boolean(marker);
  }

  /** Records a committed mutation, and the restoration group it created, under its identity. */
  async recordCommittedMutation(
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
  async countRestorableItems(
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
      if (!this.#retainedRows.isRetainedTable(marker.entity)) continue;
      const row = await this.#retainedRows
        .buildRetainedQuery(trx, companyId, marker.entity)
        .onlyTrashed()
        .where('id', marker.row_id)
        .where('deletion_group_id', marker.group_id)
        .first();
      if (row) total++;
    }
    return total;
  }
}
