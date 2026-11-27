import { column } from '@adonisjs/lucid/orm'
import { CAPACITY_OVERVIEW_ACCESS_VALUES } from '@capacitylens/shared/types/entities'
import type { CapacityOverviewAccess, Weekday } from '@capacitylens/shared/types/entities'
import { CompanySchema } from '#database/schema'
import type { DateTime } from 'luxon'
import { isArrayOf, isOneOf, jsonColumn } from '@kevinjohn/adonisjs-lucid-checked-columns'
import { booleanColumn, isWeekday, timestampColumn } from '#models_support/scalar_column'

export default class Company extends CompanySchema {
  // Product ids are UUIDs; without this Lucid replaces the id with SQLite's row id after insert.
  static selfAssignPrimaryKey = true

  @column(jsonColumn('companies', 'week_starts_on', isOneOf([0, 1] as const)))
  declare weekStartsOn: 0 | 1 | null

  @column(jsonColumn('companies', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[] | null

  @column(booleanColumn('companies', 'disciplines_enabled'))
  declare disciplinesEnabled: boolean | null

  @column(booleanColumn('companies', 'placeholders_enabled'))
  declare placeholdersEnabled: boolean | null

  @column(booleanColumn('companies', 'external_enabled'))
  declare externalEnabled: boolean | null

  @column(booleanColumn('companies', 'inline_activity_create_enabled'))
  declare inlineActivityCreateEnabled: boolean | null

  @column(booleanColumn('companies', 'show_task_field_in_schedule'))
  declare showTaskFieldInSchedule: boolean | null

  @column(
    jsonColumn('companies', 'capacity_overview_access', isOneOf(CAPACITY_OVERVIEW_ACCESS_VALUES))
  )
  declare capacityOverviewAccess: CapacityOverviewAccess | null

  @column.dateTime(timestampColumn('companies', 'created_at'))
  declare createdAt: DateTime

  @column.dateTime(timestampColumn('companies', 'updated_at'))
  declare updatedAt: DateTime
}
