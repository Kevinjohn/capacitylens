import { ClosureSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
import { timestampColumn } from '#models_support/scalar_column'
import type { DateTime } from 'luxon'
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm'
import type { ISODate } from '@capacitylens/shared/types/entities'
import { CompanyScope, requireRowCompany } from '#models_support/scoped_model'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns'
/** A company-scoped closure; deletion metadata stays internal to restoration. */
export default class Closure extends compose(ClosureSchema, SoftDeletes) {
  static forCompany = CompanyScope.forCompany
  static selfAssignPrimaryKey = true
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Closure>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Closure>) {
    CompanyScope.requireCompanyScope(query)
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Closure) {
    requireRowCompany(row)
  }
  @column.dateTime(timestampColumn('closures', 'created_at')) declare createdAt: DateTime
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null
  @column({ serializeAs: null }) declare deletionGroupId: string | null
  @column(isoDateColumn('closures', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('closures', 'start_date')) declare startDate: ISODate
  @column.dateTime(timestampColumn('closures', 'updated_at')) declare updatedAt: DateTime
}
