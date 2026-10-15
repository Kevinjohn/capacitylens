import { ActivitySchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import { isoTimestampColumn } from '#models/scalar_column'
export default class Activity extends ActivitySchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(isoTimestampColumn('activities', 'archived_at')) declare archivedAt: ISOTimestamp | null
  @column(isoTimestampColumn('activities', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoTimestampColumn('activities', 'deleted_at')) declare deletedAt: ISOTimestamp | null
  @column(isoTimestampColumn('activities', 'updated_at')) declare updatedAt: ISOTimestamp
}
