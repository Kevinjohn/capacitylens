import { ProjectSchema } from '#database/schema'
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm'
import { booleanColumn, timestampColumn } from '#models_support/scalar_column'
import type { DateTime } from 'luxon'
import { CompanyScope, requireRowCompany } from '#models_support/scoped_model'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
/** A company-scoped project; `isPrivate` protects its name in member projections. */
export default class Project extends ProjectSchema {
  static forCompany = CompanyScope.forCompany
  static selfAssignPrimaryKey = true
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Project>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Project>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Project) {
    requireRowCompany(row)
  }
  @column(booleanColumn('projects', 'is_private'))
  declare isPrivate: boolean | null

  @column.dateTime(timestampColumn('projects', 'archived_at')) declare archivedAt: DateTime | null
  @column.dateTime(timestampColumn('projects', 'created_at')) declare createdAt: DateTime
  @column.dateTime(timestampColumn('projects', 'updated_at')) declare updatedAt: DateTime
}
