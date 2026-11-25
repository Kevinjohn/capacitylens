import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import { cleanText } from '@capacitylens/shared/lib/strings';
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields';
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model';
import Company from '#models/company';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import { assertFrozenCompanyFields } from '#services/planning/entity_rules';
import { createServerRevision } from '#services/planning/server_timestamp';
import { requireExistingRow, type WrittenRow } from '#services/planning/writer';
import { validateRow } from '#validators/planning/row';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception';
import PlanningConflictException from '#exceptions/planning_conflict_exception';
import FrozenCompanyFieldException from '#exceptions/frozen_company_field_exception';

/** Planning row writes in the caller's transaction. */
export class PlanningWriterService {
  /**
   * The model row for a product row the company snapshot holds, bound to the caller's transaction.
   * The snapshot was read in this transaction and follows each write, so it is the stored row, and
   * `merge(...).save()` writes the changed columns without reading the row again.
   */
  snapshotRow(model: LucidModel, row: object, trx: TransactionClientContract): LucidRow {
    const stored = new model();
    stored.fill(rowAttributes(model, row));
    // What Lucid does for a fetched row: these attributes are the stored state, not a new row.
    stored.$hydrateOriginals();
    stored.$isPersisted = true;
    stored.$isLocal = false;
    return stored.useTransaction(trx);
  }

  /**
   * Persists one prepared row in the caller's transaction and applies it to the unprojected company
   * snapshot, so later compound entries validate against it. `writeEntity` prepares the row.
   */
  async writeRow<K extends ScopedEntityKey>({
    trx,
    data,
    table,
    row,
    existing,
    written,
  }: {
    trx: TransactionClientContract;
    data: AppData;
    table: K;
    row: AppData[K][number];
    existing: AppData[K][number] | undefined;
    written: WrittenRow[];
  }): Promise<AppData[K][number]> {
    const model: LucidModel = productModels[table];
    if (existing) {
      await this.snapshotRow(model, existing, trx).merge(rowAttributes(model, row)).save();
      const before = { ...existing };
      Object.assign(existing, row);
      written.push({ entity: table, id: existing.id, before, after: { ...existing } });
    } else {
      await model.create(rowAttributes(model, row), { client: trx });
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
  async updateSettings(
    trx: TransactionClientContract,
    data: AppData,
    companyId: string,
    changes: Record<string, unknown>,
    accessGrant: PlanningAccessGrant,
    written: WrittenRow[] = []
  ) {
    if (Object.hasOwn(changes, 'capacityOverviewAccess') && !isOwnerOrAdmin(accessGrant.role)) {
      throw new PlanningAuthorizationException('This setting requires an Owner or Admin.');
    }
    const existing = requireExistingRow(data, 'companies', companyId);
    const candidate = { ...existing, ...changes };
    try {
      assertFrozenCompanyFields(changes, candidate, existing);
    } catch (error) {
      if (!(error instanceof FrozenCompanyFieldException)) throw error;
      throw new PlanningConflictException(error.message);
    }
    const now = createServerRevision(existing.updatedAt);
    candidate.updatedAt = now;
    const validated = await validateRow('companies', candidate);
    validated.name = cleanText(validated.name);
    // Vine drops a null field from its output; the stored column becomes null, so the copy must too.
    fillNullableFields('companies', validated);
    await this.snapshotRow(Company, existing, trx).merge(rowAttributes(Company, validated)).save();
    const before = { ...existing };
    Object.assign(existing, validated);
    written.push({ entity: 'companies', id: companyId, before, after: { ...existing } });
  }
}
