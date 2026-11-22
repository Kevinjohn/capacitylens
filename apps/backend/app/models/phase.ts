import { PhaseSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
/** A company-scoped project phase; deletion metadata stays internal to restoration. */
export default class Phase extends SoftDeletes(PhaseSchema) {
  static forCompany = forCompany;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Phase>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Phase>) {
    requireCompanyScope(query);
  }
  @column.dateTime(timestampColumn('phases', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column.dateTime(timestampColumn('phases', 'updated_at')) declare updatedAt: DateTime;
}
