import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type {
  AppData,
  AppDataKey,
  ScopedEntityKey,
  Weekday,
} from '@capacitylens/shared/types/entities';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
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
import { writeRow, type Row } from './writer.js';

interface WriteEntityOptions {
  trx: TransactionClientContract;
  data: AppData;
  accountId: string;
  table: ScopedEntityKey;
  id: string;
  fields: Record<string, unknown>;
  capabilities: PlanningCapabilities;
  mode: 'create' | 'update';
  identity: RestorationIdentity;
  permissiveRepeatStart?: boolean;
}

function lookupFor(data: AppData): ValidationDataLookup {
  const rows = (table: AppDataKey) => data[table] as unknown as Row[];
  return {
    row: (table, id) => rows(table).find((row) => row.id === id),
    allocationsForResource: (accountId, resourceId) =>
      data.allocations.filter(
        (row) => row.accountId === accountId && row.resourceId === resourceId
      ),
    allocationsForActivity: (accountId, activityId) =>
      data.allocations.filter(
        (row) => row.accountId === accountId && row.activityId === activityId
      ),
    resourceHasLoadedAllocation: (accountId, resourceId) =>
      data.allocations.some(
        (row) =>
          row.accountId === accountId && row.resourceId === resourceId && row.hoursPerDay !== 0
      ),
    resourceHasTimeOff: (accountId, resourceId) =>
      data.timeOff.some((row) => row.accountId === accountId && row.resourceId === resourceId),
    accountWorkingDays: (accountId): Weekday[] => {
      const account = data.accounts.find((row) => row.id === accountId);
      return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn === 0 ? 0 : 1);
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
  accountId,
  table,
  id,
  fields,
  capabilities,
  mode,
  identity,
  permissiveRepeatStart,
}: WriteEntityOptions) {
  const existing = (data[table] as unknown as Row[]).find((row) => row.id === id);
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
  const candidate: Record<string, unknown> = {
    ...(existing ?? {}),
    ...fields,
    id,
    accountId,
  };
  if (!existing) applyCreateDefaults(table, candidate);
  const lookup = lookupFor(data);
  const clean = await prepareEntityWrite(table, candidate, existing, data, capabilities, {
    lookup,
    hasOtherBuiltinClient: (companyId, clientId) =>
      data.clients.some(
        (row) => row.accountId === companyId && row.id !== clientId && row.builtin === true
      ),
  });
  if (table === 'allocations' && !permissiveRepeatStart) {
    assertAllocationStartsOnWorkingDay(clean, existing, lookup, accountId);
  }
  if (mode === 'create' && isRetainedTable(table)) {
    await reclaimRetainedId(trx, accountId, table, id, identity);
  }
  return writeRow({ trx, data, accountId, table, row: clean, existing });
}
