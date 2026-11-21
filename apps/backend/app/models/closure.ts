import { ClosureSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn, timestampColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISODate } from '@capacitylens/shared/types/entities';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped closure; deletion metadata stays internal to restoration. */
export default class Closure extends SoftDeletes(ClosureSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column.dateTime(timestampColumn('closures', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoDateColumn('closures', 'end_date')) declare endDate: ISODate;
  @column(isoDateColumn('closures', 'start_date')) declare startDate: ISODate;
  @column.dateTime(timestampColumn('closures', 'updated_at')) declare updatedAt: DateTime;
}
