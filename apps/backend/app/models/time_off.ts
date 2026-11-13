import { TimeOffSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities';
import { forCompany, forWholeInstallation, requireCompanyScope } from '#models/scoped_model';
import { isoDateColumn, isoTimestampColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
export default class TimeOff extends SoftDeletes(TimeOffSchema) {
  static forCompany = forCompany;
  static forWholeInstallation = forWholeInstallation;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  static table = 'time_off';
  @column(isoTimestampColumn('time_off', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoDateColumn('time_off', 'end_date')) declare endDate: ISODate;
  @column(isoDateColumn('time_off', 'start_date')) declare startDate: ISODate;
  @column(isoTimestampColumn('time_off', 'updated_at')) declare updatedAt: ISOTimestamp;
}
