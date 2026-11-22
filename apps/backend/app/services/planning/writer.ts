import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, AppDataKey, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import { cleanText } from '@capacitylens/shared/lib/strings';
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields';
import { encodeRow } from '#services/state_repository';
import { assertFrozenCompanyFields } from '#services/planning/entity_rules';
import { tables } from '#services/product_tables';
import { createServerRevision } from '#services/planning/server_timestamp';
import { validateRow } from '#validators/planning/row';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import { EntityWriteException } from '#exceptions/entity_write_exception';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';

/** One row a planning operation wrote: its table, id, and the row before and after. */
export interface WrittenRow {
  entity: AppDataKey;
  id: string;
  before: AppData[AppDataKey][number] | null;
  after: AppData[AppDataKey][number] | null;
}

/**
 * A row read field by field. Rule checks that apply to several tables read and set fields by name;
 * every row is a plain object, so the view is the same object.
 */
export function asRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>;
}

/** Resolves a stored row of the named table from the complete company snapshot, refusing missing targets. */
export function requireExistingRow<K extends AppDataKey>(
  data: AppData,
  table: K,
  id: string
): AppData[K][number] {
  const rows: readonly { id: string }[] = data[table];
  const row = rows.find((item) => item.id === id);
  if (!row) {
    throw new PlanningOperationException(400, 'VALIDATION_ERROR', 'The record was not found.');
  }
  // Indexing the snapshot by a generic key loses the element type, so restore it here.
  return row as AppData[K][number];
}

/**
 * Persists one prepared row in the caller's transaction and applies it to the unprojected company
 * snapshot, so later compound entries validate against it. `writeEntity` prepares the row.
 */
export async function writeRow<K extends ScopedEntityKey>({
  trx,
  data,
  companyId,
  table,
  row,
  existing,
  written,
}: {
  trx: TransactionClientContract;
  data: AppData;
  companyId: string;
  table: K;
  row: AppData[K][number];
  existing: AppData[K][number] | undefined;
  written: WrittenRow[];
}): Promise<AppData[K][number]> {
  if (existing) {
    await trx
      .from(tables[table])
      .where({ id: row.id, company_id: companyId })
      .update(encodeRow(tables[table], asRecord(row)));
    const before = { ...existing };
    Object.assign(existing, row);
    written.push({ entity: table, id: existing.id, before, after: { ...existing } });
  } else {
    await trx.table(tables[table]).insert(encodeRow(tables[table], asRecord(row)));
    const rows: AppData[K][number][] = data[table];
    rows.push(row);
    written.push({ entity: table, id: row.id, before: null, after: { ...row } });
  }
  return row;
}

/**
 * Validates allowed settings and mutates the supplied complete company state after writing.
 * The caller owns rollback and no-change detection.
 */
export async function updateSettings(
  trx: TransactionClientContract,
  data: AppData,
  companyId: string,
  changes: Record<string, unknown>,
  accessGrant: PlanningAccessGrant,
  written: WrittenRow[] = []
) {
  if (Object.hasOwn(changes, 'capacityOverviewAccess') && !isOwnerOrAdmin(accessGrant.role)) {
    throw new PlanningOperationException(
      403,
      'AUTHORIZATION_DENIED',
      'This setting requires an Owner or Admin.'
    );
  }
  const existing = requireExistingRow(data, 'accounts', companyId);
  const candidate = { ...existing, ...changes };
  try {
    assertFrozenCompanyFields(changes, candidate, existing);
  } catch (error) {
    if (!(error instanceof EntityWriteException) || error.status !== 409) throw error;
    throw new PlanningOperationException(409, null, error.message);
  }
  const now = createServerRevision(existing.updatedAt);
  candidate.updatedAt = now;
  const validated = await validateRow('accounts', candidate);
  validated.name = cleanText(validated.name);
  // Vine drops a null field from its output; the stored column becomes null, so the copy must too.
  fillNullableFields('accounts', validated);
  await trx
    .from('companies')
    .where('id', companyId)
    .update(encodeRow('companies', asRecord(validated)));
  const before = { ...existing };
  Object.assign(existing, validated);
  written.push({ entity: 'accounts', id: companyId, before, after: { ...existing } });
}
