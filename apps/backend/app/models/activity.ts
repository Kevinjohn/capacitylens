import { ActivitySchema } from '#database/schema';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import { deletedAtColumn } from '#models/scalar_column';
import { isoTimestampColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped activity; its kind governs project and phase references. */
export default class Activity extends SoftDeletes(ActivitySchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column(isoTimestampColumn('activities', 'archived_at')) declare archivedAt: ISOTimestamp | null;
  @column(isoTimestampColumn('activities', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column(isoTimestampColumn('activities', 'updated_at')) declare updatedAt: ISOTimestamp;
}
