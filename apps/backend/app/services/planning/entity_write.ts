import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ScopedEntityKey, Weekday } from '@capacitylens/shared/types/entities';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { tables } from '#services/product_tables';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import {
  applyCreateDefaults,
  assertMayWriteRestrictedFields,
  prepareEntityWrite,
} from '#services/planning/entity_rules';
import {
  assertAllocationStartIsAvailable,
  assertAllocationStartsOnWorkingDay,
} from '#services/planning/entity_validation/domain';
import { isRetainedTable } from '#services/planning/retained_rows';
import { reclaimRetainedId, type RestorationIdentity } from '#services/planning/restoration';
import { asRecord, writeRow, type WrittenRow } from '#services/planning/writer';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';

interface WriteEntityOptions<K extends ScopedEntityKey> {
  trx: TransactionClientContract;
  data: AppData;
  /** Receives one entry per row this write persists. */
  written: WrittenRow[];
  companyId: string;
  table: K;
  id: string;
  fields: Partial<AppData[K][number]>;
  accessGrant: PlanningAccessGrant;
  mode: 'create' | 'update';
  identity: RestorationIdentity;
  permissiveRepeatStart?: boolean;
  /** An update refuses the write when the stored row's `updatedAt` differs from this value. */
  expectedUpdatedAt?: string;
}

/** One past the company's highest discipline sort order, counting archived and deleted rows. */
function resolveNextDisciplineSortOrder(data: AppData, companyId: string): number {
  return data.disciplines
    .filter((row) => row.companyId === companyId)
    .reduce((next, row) => Math.max(next, row.sortOrder + 1), 0);
}

function lookupFor(data: AppData): ValidationDataLookup {
  return {
    row: (table, id) => {
      const rows: readonly { id: string }[] = data[table];
      return rows.find((row) => row.id === id);
    },
    allocationsForResource: (companyId, resourceId) =>
      data.allocations.filter(
        (row) => row.companyId === companyId && row.resourceId === resourceId
      ),
    allocationsForActivity: (companyId, activityId) =>
      data.allocations.filter(
        (row) => row.companyId === companyId && row.activityId === activityId
      ),
    resourceHasLoadedAllocation: (companyId, resourceId) =>
      data.allocations.some(
        (row) =>
          row.companyId === companyId && row.resourceId === resourceId && row.hoursPerDay !== 0
      ),
    resourceHasTimeOff: (companyId, resourceId) =>
      data.timeOff.some((row) => row.companyId === companyId && row.resourceId === resourceId),
    companyWorkingDays: (companyId): Weekday[] => {
      const company = data.companies.find((row) => row.id === companyId);
      return normalizeCompanyWorkingDays(company?.workingDays, company?.weekStartsOn === 0 ? 0 : 1);
    },
  };
}

/**
 * Validates and writes one row in the caller's transaction, then mutates its unprojected company state.
 * Later compound entries validate against those changes. The caller owns rollback and atomic
 * revision, audit and commitment recording. Only later occurrences of a repeated create may use
 * permissiveRepeatStart; creates, duplicates and the first occurrence retain the working-day check.
 * Reusing a retained id requires the deleting actor's original native session; otherwise the
 * existing id-conflict refusal leaves the pending deletion intact. Identity is server-verified.
 */
export async function writeEntity<K extends ScopedEntityKey>({
  trx,
  data,
  written,
  companyId,
  table,
  id,
  fields,
  accessGrant,
  mode,
  identity,
  permissiveRepeatStart,
  expectedUpdatedAt,
}: WriteEntityOptions<K>) {
  const rows: readonly AppData[K][number][] = data[table];
  const existing = rows.find((row) => row.id === id);
  assertMayWriteRestrictedFields(table, asRecord(fields), accessGrant, mode);
  if (mode === 'create' && existing) {
    throw new PlanningOperationException(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (
    mode === 'create' &&
    !isRetainedTable(table) &&
    (await trx.from(tables[table]).select('id').where('id', id).first())
  ) {
    throw new PlanningOperationException(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (mode === 'update' && !existing) {
    throw new PlanningOperationException(400, 'VALIDATION_ERROR', 'The record was not found.');
  }
  if (
    mode === 'update' &&
    expectedUpdatedAt !== undefined &&
    existing?.updatedAt !== expectedUpdatedAt
  ) {
    throw new PlanningOperationException(
      409,
      'STALE_REVISION',
      'The record changed since it was opened.'
    );
  }
  const candidate: Record<string, unknown> = {
    ...(existing ?? {}),
    ...fields,
    id,
    companyId,
  };
  if (!existing) applyCreateDefaults(table, candidate);
  if (!existing && table === 'disciplines') {
    candidate.sortOrder = resolveNextDisciplineSortOrder(data, companyId);
  }
  const lookup = lookupFor(data);
  const clean = await prepareEntityWrite(table, candidate, existing, data, accessGrant, {
    lookup,
    hasOtherBuiltinClient: (targetCompanyId, clientId) =>
      data.clients.some(
        (row) => row.companyId === targetCompanyId && row.id !== clientId && row.builtin === true
      ),
  });
  if (table === 'allocations' && !permissiveRepeatStart) {
    assertAllocationStartsOnWorkingDay(
      asRecord(clean),
      existing && asRecord(existing),
      lookup,
      companyId
    );
    assertAllocationStartIsAvailable(
      asRecord(clean),
      existing && asRecord(existing),
      lookup,
      data,
      companyId
    );
  }
  if (mode === 'create' && isRetainedTable(table)) {
    await reclaimRetainedId(trx, companyId, table, id, identity);
  }
  return writeRow({ trx, data, companyId, table, row: clean, existing, written });
}
