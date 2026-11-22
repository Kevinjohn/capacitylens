import { DisciplineSchema } from '#database/schema';
import { compose } from '@adonisjs/core/helpers';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
/** A company-scoped discipline; deletion metadata stays internal to restoration. */
export default class Discipline extends compose(DisciplineSchema, SoftDeletes) {
  static forCompany = forCompany;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Discipline>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Discipline>) {
    requireCompanyScope(query);
  }
  @column.dateTime(timestampColumn('disciplines', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column.dateTime(timestampColumn('disciplines', 'updated_at')) declare updatedAt: DateTime;
}
