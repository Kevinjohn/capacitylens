import { PhaseSchema } from '#database/schema';
import { compose } from '@adonisjs/core/helpers';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm';
import { forCompany, requireCompanyScope, requireRowCompany } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
/** A company-scoped project phase; deletion metadata stays internal to restoration. */
export default class Phase extends compose(PhaseSchema, SoftDeletes) {
  static forCompany = forCompany;
  static selfAssignPrimaryKey = true;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Phase>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Phase>) {
    requireCompanyScope(query);
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Phase) {
    requireRowCompany(row);
  }
  @column.dateTime(timestampColumn('phases', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column.dateTime(timestampColumn('phases', 'updated_at')) declare updatedAt: DateTime;
}
