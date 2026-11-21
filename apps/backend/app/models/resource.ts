import { ResourceSchema } from '#database/schema';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import type { ISODate, ISOTimestamp, Weekday } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import { booleanColumn, deletedAtColumn, isWeekday } from '#models/scalar_column';
import {
  isArrayOf,
  isoDateColumn,
  isoTimestampColumn,
  jsonColumn,
} from '@kevinjohn/adonisjs-lucid-checked-columns';

/** A company-scoped resource; working-day and half-day arrays contain validated weekdays. */
export default class Resource extends SoftDeletes(ResourceSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column(jsonColumn('resources', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[];

  @column(jsonColumn('resources', 'half_days', isArrayOf(isWeekday)))
  declare halfDays: Weekday[];

  @column(booleanColumn('resources', 'is_favourite'))
  declare isFavourite: boolean | null;

  @column(isoTimestampColumn('resources', 'archived_at')) declare archivedAt: ISOTimestamp | null;
  @column(isoTimestampColumn('resources', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column(isoDateColumn('resources', 'first_available_date'))
  declare firstAvailableDate: ISODate | null;
  @column(isoDateColumn('resources', 'last_available_date'))
  declare lastAvailableDate: ISODate | null;
  @column(isoTimestampColumn('resources', 'updated_at')) declare updatedAt: ISOTimestamp;
}
