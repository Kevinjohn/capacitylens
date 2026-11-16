import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, AppDataKey, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import { cleanText } from '@capacitylens/shared/lib/strings';
import { encodeRow } from '#services/state_repository';
import { assertFrozenAccountFields } from '#services/planning/entity_policy';
import { tables } from '#services/product_tables';
import { EntityWriteError, PlanningOperationError } from '#services/planning/errors';
import { createServerRevision } from '#services/planning/server_timestamp';
import { validateEntityRow } from '#validators/entities/index';
import type { PlanningCapabilities } from '#services/planning/data_policy';

export { PlanningOperationError };

export type Row = Record<string, unknown> & { id: string };

/** Resolves a stored row from the complete company snapshot, refusing missing targets. */
export function existingRow(data: AppData, table: AppDataKey, id: string): Row {
  const row = (data[table] as unknown as Row[]).find((item) => item.id === id);
  if (!row) throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The record was not found.');
  return row;
}

/**
 * Persists one prepared row in the caller's transaction and applies it to the unprojected company
 * snapshot, so later compound entries validate against it. `writeEntity` prepares the row.
 */
export async function writeRow({
  trx,
  data,
  accountId,
  table,
  row,
  existing,
}: {
  trx: TransactionClientContract;
  data: AppData;
  accountId: string;
  table: ScopedEntityKey;
  row: Record<string, unknown>;
  existing: Row | undefined;
}) {
  if (existing) {
    await trx
      .from(tables[table])
      .where({ id: row.id, account_id: accountId })
      .update(encodeRow(tables[table], row));
    Object.assign(existing, row);
  } else {
    await trx.table(tables[table]).insert(encodeRow(tables[table], row));
    (data[table] as unknown as Row[]).push(row as Row);
  }
  return row;
}

/**
 * Validates allowed settings and mutates the supplied complete company state after writing.
 * The caller owns rollback, no-change detection and the refetch/history-clear acknowledgement.
 */
export async function updateSettings(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  changes: Record<string, unknown>,
  capabilities: PlanningCapabilities
) {
  if (Object.hasOwn(changes, 'capacityOverviewAccess') && !isOwnerOrAdmin(capabilities.role)) {
    throw new PlanningOperationError(
      403,
      'AUTHORIZATION_DENIED',
      'This setting requires an administrator.'
    );
  }
  const existing = existingRow(data, 'accounts', accountId);
  const candidate = { ...existing, ...changes };
  try {
    assertFrozenAccountFields(changes, candidate, existing);
  } catch (error) {
    if (!(error instanceof EntityWriteError) || error.status !== 409) throw error;
    throw new PlanningOperationError(409, null, error.message);
  }
  const now = createServerRevision(existing.updatedAt);
  candidate.updatedAt = now;
  const validated = await validateEntityRow('accounts', candidate);
  if (typeof validated.name === 'string') validated.name = cleanText(validated.name);
  await trx.from('accounts').where('id', accountId).update(encodeRow('accounts', validated));
  Object.assign(existing, validated);
}
