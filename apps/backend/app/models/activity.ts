import { ActivitySchema } from '#database/schema'
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'
import { CompanyScope, requireRowCompany } from '#models_support/scoped_model'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { timestampColumn } from '#models_support/scalar_column'
/** A company-scoped activity; its kind governs project and phase references. */
export default class Activity extends ActivitySchema {
  static forCompany = CompanyScope.forCompany
  static selfAssignPrimaryKey = true
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Activity>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Activity>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Activity) {
    requireRowCompany(row)
  }
  @column.dateTime(timestampColumn('activities', 'archived_at'))
  declare archivedAt: DateTime | null
  @column.dateTime(timestampColumn('activities', 'created_at')) declare createdAt: DateTime
  @column.dateTime(timestampColumn('activities', 'updated_at')) declare updatedAt: DateTime
}
