import { ClosureSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import { isoDateColumn, isoTimestampColumn } from '#models/scalar_column'
export default class Closure extends ClosureSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(isoTimestampColumn('closures', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoDateColumn('closures', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('closures', 'start_date')) declare startDate: ISODate
  @column(isoTimestampColumn('closures', 'updated_at')) declare updatedAt: ISOTimestamp
}
