import { ResourceSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ISODate, ISOTimestamp, Weekday } from '@capacitylens/shared/types/entities'
import { isArrayOf, isBoolean, isOneOf, jsonColumn } from '#models/json_column'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import { isoDateColumn, isoTimestampColumn } from '#models/scalar_column'

const isWeekday = isOneOf([0, 1, 2, 3, 4, 5, 6] as const)
export default class Resource extends ResourceSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(jsonColumn('resources', 'working_days', isArrayOf(isWeekday)))
  declare workingDays: Weekday[]

  @column(jsonColumn('resources', 'half_days', isArrayOf(isWeekday)))
  declare halfDays: Weekday[]

  @column(jsonColumn('resources', 'is_favourite', isBoolean))
  declare isFavourite: boolean | null

  @column(isoTimestampColumn('resources', 'archived_at')) declare archivedAt: ISOTimestamp | null
  @column(isoTimestampColumn('resources', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoTimestampColumn('resources', 'deleted_at')) declare deletedAt: ISOTimestamp | null
  @column(isoDateColumn('resources', 'first_available_date'))
  declare firstAvailableDate: ISODate | null
  @column(isoDateColumn('resources', 'last_available_date'))
  declare lastAvailableDate: ISODate | null
  @column(isoTimestampColumn('resources', 'updated_at')) declare updatedAt: ISOTimestamp
}
