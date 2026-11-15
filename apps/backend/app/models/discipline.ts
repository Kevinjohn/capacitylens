import { DisciplineSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import { isoTimestampColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped discipline; deletion metadata stays internal to restoration. */
export default class Discipline extends SoftDeletes(DisciplineSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column(isoTimestampColumn('disciplines', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoTimestampColumn('disciplines', 'updated_at')) declare updatedAt: ISOTimestamp;
}
