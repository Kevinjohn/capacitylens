import { AllocationSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import { jsonColumn } from '#models/json_column'
import { isBoolean } from '#models/json_column'
import { isoDateColumn, isoTimestampColumn } from '#models/scalar_column'
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
export default class Allocation extends AllocationSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(jsonColumn('allocations', 'ignore_weekends', isBoolean))
  declare ignoreWeekends: boolean | null

  @column(isoTimestampColumn('allocations', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoDateColumn('allocations', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('allocations', 'start_date')) declare startDate: ISODate
  @column(isoTimestampColumn('allocations', 'updated_at')) declare updatedAt: ISOTimestamp
}
