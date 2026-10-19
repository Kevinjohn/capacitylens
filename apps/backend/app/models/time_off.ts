import { TimeOffSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import { isoDateColumn, isoTimestampColumn } from '#models/scalar_column'
export default class TimeOff extends TimeOffSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  static table = 'time_off'
  @column(isoTimestampColumn('time_off', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoDateColumn('time_off', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('time_off', 'start_date')) declare startDate: ISODate
  @column(isoTimestampColumn('time_off', 'updated_at')) declare updatedAt: ISOTimestamp
}
