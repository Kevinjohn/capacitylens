import { column } from '@adonisjs/lucid/orm';
import { CAPACITY_OVERVIEW_ACCESS_VALUES } from '@capacitylens/shared/types/entities';
import type { CapacityOverviewAccess, Weekday } from '@capacitylens/shared/types/entities';
import { AccountSchema } from '#database/schema';
import type { DateTime } from 'luxon';
import { isArrayOf, isOneOf, jsonColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
import { booleanColumn, isWeekday, timestampColumn } from '#models/scalar_column';

export default class Company extends AccountSchema {
  static table = 'accounts';

  @column(jsonColumn('accounts', 'week_starts_on', isOneOf([0, 1] as const)))
  declare weekStartsOn: 0 | 1 | null;

  @column(jsonColumn('accounts', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[] | null;

  @column(booleanColumn('accounts', 'disciplines_enabled'))
  declare disciplinesEnabled: boolean | null;

  @column(booleanColumn('accounts', 'placeholders_enabled'))
  declare placeholdersEnabled: boolean | null;

  @column(booleanColumn('accounts', 'external_enabled'))
  declare externalEnabled: boolean | null;

  @column(booleanColumn('accounts', 'inline_activity_create_enabled'))
  declare inlineActivityCreateEnabled: boolean | null;

  @column(booleanColumn('accounts', 'show_task_field_in_schedule'))
  declare showTaskFieldInSchedule: boolean | null;

  @column(
    jsonColumn('accounts', 'capacity_overview_access', isOneOf(CAPACITY_OVERVIEW_ACCESS_VALUES))
  )
  declare capacityOverviewAccess: CapacityOverviewAccess | null;

  @column.dateTime(timestampColumn('accounts', 'created_at'))
  declare createdAt: DateTime;

  @column.dateTime(timestampColumn('accounts', 'updated_at'))
  declare updatedAt: DateTime;
}
