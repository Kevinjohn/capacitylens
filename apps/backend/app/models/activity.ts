import { ActivitySchema } from '#database/schema';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import { deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
/** A company-scoped activity; its kind governs project and phase references. */
export default class Activity extends SoftDeletes(ActivitySchema) {
  static forCompany = forCompany;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Activity>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Activity>) {
    requireCompanyScope(query);
  }
  @column.dateTime(timestampColumn('activities', 'archived_at'))
  declare archivedAt: DateTime | null;
  @column.dateTime(timestampColumn('activities', 'created_at')) declare createdAt: DateTime;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column.dateTime(timestampColumn('activities', 'updated_at')) declare updatedAt: DateTime;
}
