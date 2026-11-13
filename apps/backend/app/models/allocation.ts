import { AllocationSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities';
import { forCompany, forWholeInstallation, requireCompanyScope } from '#models/scoped_model';
import {
  isBoolean,
  isoDateColumn,
  isoTimestampColumn,
  jsonColumn,
} from '@kevinjohn/adonisjs-lucid-checked-columns';
export default class Allocation extends SoftDeletes(AllocationSchema) {
  static forCompany = forCompany;
  static forWholeInstallation = forWholeInstallation;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column(jsonColumn('allocations', 'ignore_working_days', isBoolean))
  declare ignoreWorkingDays: boolean | null;

  @column(isoTimestampColumn('allocations', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoDateColumn('allocations', 'end_date')) declare endDate: ISODate;
  @column(isoDateColumn('allocations', 'start_date')) declare startDate: ISODate;
  @column(isoTimestampColumn('allocations', 'updated_at')) declare updatedAt: ISOTimestamp;
}
