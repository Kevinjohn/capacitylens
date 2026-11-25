import { ResourceSchema } from '#database/schema';
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm';
import type { ISODate, Weekday } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { CompanyScope, requireRowCompany } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import { booleanColumn, isWeekday, timestampColumn } from '#models_support/scalar_column';
import { isArrayOf, isoDateColumn, jsonColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';

/** A company-scoped resource; working-day and half-day arrays contain validated weekdays. */
export default class Resource extends ResourceSchema {
  static forCompany = CompanyScope.forCompany;
  static selfAssignPrimaryKey = true;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Resource>) {
    CompanyScope.requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Resource>) {
    CompanyScope.requireCompanyScope(query);
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Resource) {
    requireRowCompany(row);
  }
  @column(jsonColumn('resources', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[];

  @column(jsonColumn('resources', 'half_days', isArrayOf(isWeekday)))
  declare halfDays: Weekday[];

  @column(booleanColumn('resources', 'is_favourite'))
  declare isFavourite: boolean | null;

  @column.dateTime(timestampColumn('resources', 'archived_at')) declare archivedAt: DateTime | null;
  @column.dateTime(timestampColumn('resources', 'created_at')) declare createdAt: DateTime;
  @column(isoDateColumn('resources', 'first_available_date'))
  declare firstAvailableDate: ISODate | null;
  @column(isoDateColumn('resources', 'last_available_date'))
  declare lastAvailableDate: ISODate | null;
  @column.dateTime(timestampColumn('resources', 'updated_at')) declare updatedAt: DateTime;
}
