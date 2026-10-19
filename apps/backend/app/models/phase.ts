import { PhaseSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import { isoTimestampColumn } from '#models/scalar_column'
export default class Phase extends PhaseSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(isoTimestampColumn('phases', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoTimestampColumn('phases', 'updated_at')) declare updatedAt: ISOTimestamp
}
