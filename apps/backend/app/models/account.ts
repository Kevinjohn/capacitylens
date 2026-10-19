import { column } from '@adonisjs/lucid/orm'
import type {
  CapacityOverviewAccess,
  ISOTimestamp,
  Weekday,
} from '@capacitylens/shared/types/entities'
import { AccountSchema } from '#database/schema'
import { isArrayOf, isBoolean, isOneOf, jsonColumn } from '#models/json_column'
import { isoTimestampColumn } from '#models/scalar_column'

const isWeekday = isOneOf([0, 1, 2, 3, 4, 5, 6] as const)

export default class Account extends AccountSchema {
  @column(jsonColumn('accounts', 'week_starts_on', isOneOf([0, 1] as const)))
  declare weekStartsOn: 0 | 1 | null

  @column(jsonColumn('accounts', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[] | null

  @column(jsonColumn('accounts', 'disciplines_enabled', isBoolean))
  declare disciplinesEnabled: boolean | null

  @column(jsonColumn('accounts', 'placeholders_enabled', isBoolean))
  declare placeholdersEnabled: boolean | null

  @column(jsonColumn('accounts', 'external_enabled', isBoolean))
  declare externalEnabled: boolean | null

  @column(jsonColumn('accounts', 'inline_activity_create_enabled', isBoolean))
  declare inlineActivityCreateEnabled: boolean | null

  @column(jsonColumn('accounts', 'show_task_field_in_schedule', isBoolean))
  declare showTaskFieldInSchedule: boolean | null

  @column(
    jsonColumn(
      'accounts',
      'capacity_overview_access',
      isOneOf(['owner_admin', 'owner_admin_editor', 'everyone'] as const)
    )
  )
  declare capacityOverviewAccess: CapacityOverviewAccess | null

  @column(isoTimestampColumn('accounts', 'created_at'))
  declare createdAt: ISOTimestamp

  @column(isoTimestampColumn('accounts', 'updated_at'))
  declare updatedAt: ISOTimestamp
}
