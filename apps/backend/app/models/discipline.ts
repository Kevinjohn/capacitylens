import { DisciplineSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
import { timestampColumn } from '#models_support/scalar_column'
import type { DateTime } from 'luxon'
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm'
import { CompanyScope, requireRowCompany } from '#models_support/scoped_model'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
/** A company-scoped discipline; deletion metadata stays internal to restoration. */
export default class Discipline extends compose(DisciplineSchema, SoftDeletes) {
  static forCompany = CompanyScope.forCompany
  static selfAssignPrimaryKey = true
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Discipline>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Discipline>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Discipline) {
    requireRowCompany(row)
  }
  @column.dateTime(timestampColumn('disciplines', 'created_at')) declare createdAt: DateTime
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null
  @column({ serializeAs: null }) declare deletionGroupId: string | null
  @column.dateTime(timestampColumn('disciplines', 'updated_at')) declare updatedAt: DateTime
}
