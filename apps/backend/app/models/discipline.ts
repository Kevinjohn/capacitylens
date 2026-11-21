import { DisciplineSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn, timestampColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
/** A company-scoped discipline; deletion metadata stays internal to restoration. */
export default class Discipline extends SoftDeletes(DisciplineSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column.dateTime(timestampColumn('disciplines', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column.dateTime(timestampColumn('disciplines', 'updated_at')) declare updatedAt: DateTime;
}
