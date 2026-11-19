import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ScopedEntityKey, Weekday } from '@capacitylens/shared/types/entities';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { tables } from '#services/product_tables';
import type { PlanningCapabilities } from '#services/planning/data_policy';
import {
  applyCreateDefaults,
  assertMayWriteRestrictedFields,
  prepareEntityWrite,
} from '#services/planning/entity_policy';
import { assertAllocationStartsOnWorkingDay } from '#services/planning/entity_validation/domain';
import { PlanningOperationError } from '#services/planning/errors';
import { isRetainedTable } from './retained_rows.js';
import { reclaimRetainedId, type RestorationIdentity } from './restoration.js';
import { listRows, writeRow } from './writer.js';

interface WriteEntityOptions {
  trx: TransactionClientContract;
  data: AppData;
  companyId: string;
  table: ScopedEntityKey;
  id: string;
  fields: Record<string, unknown>;
  capabilities: PlanningCapabilities;
  mode: 'create' | 'update';
  identity: RestorationIdentity;
  permissiveRepeatStart?: boolean;
  /** An update refuses the write when the stored row's `updatedAt` differs from this value. */
  expectedUpdatedAt?: string;
}

function lookupFor(data: AppData): ValidationDataLookup {
  return {
    row: (table, id) => listRows(data, table).find((row) => row.id === id),
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
      const company = data.accounts.find((row) => row.id === companyId);
      return normalizeCompanyWorkingDays(company?.workingDays, company?.weekStartsOn === 0 ? 0 : 1);
    },
  };
}

/**
 * Validates and writes one row in the caller's transaction, then mutates its unprojected company state.
 * Later compound entries validate against those changes. The caller owns rollback and atomic
 * revision, audit and commitment recording. Only later occurrences of a repeated create may use
 * permissiveRepeatStart; creates, duplicates and the first occurrence retain the working-day gate.
 * Reusing a retained id requires the deleting actor's original native session; otherwise the
 * existing id-conflict refusal leaves the pending deletion intact. Identity is server-verified.
 */
export async function writeEntity({
  trx,
  data,
  companyId,
  table,
  id,
  fields,
  capabilities,
  mode,
  identity,
  permissiveRepeatStart,
  expectedUpdatedAt,
}: WriteEntityOptions) {
  const existing = listRows(data, table).find((row) => row.id === id);
  assertMayWriteRestrictedFields(table, fields, capabilities, mode);
  if (mode === 'create' && existing) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (
    mode === 'create' &&
    !isRetainedTable(table) &&
    (await trx.from(tables[table]).select('id').where('id', id).first())
  ) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record already exists.');
  }
  if (mode === 'update' && !existing) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record was not found.');
  }
  if (
    mode === 'update' &&
    expectedUpdatedAt !== undefined &&
    existing?.updatedAt !== expectedUpdatedAt
  ) {
    throw new PlanningOperationError(
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
  const lookup = lookupFor(data);
  const clean = await prepareEntityWrite(table, candidate, existing, data, capabilities, {
    lookup,
    hasOtherBuiltinClient: (targetCompanyId, clientId) =>
      data.clients.some(
        (row) => row.companyId === targetCompanyId && row.id !== clientId && row.builtin === true
      ),
  });
  if (table === 'allocations' && !permissiveRepeatStart) {
    assertAllocationStartsOnWorkingDay(clean, existing, lookup, companyId);
  }
  if (mode === 'create' && isRetainedTable(table)) {
    await reclaimRetainedId(trx, companyId, table, id, identity);
  }
  return writeRow({ trx, data, companyId, table, row: clean, existing });
}
