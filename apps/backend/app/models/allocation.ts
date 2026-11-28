import { AllocationSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
import { booleanColumn, timestampColumn } from '#services/models/scalar_column'
import type { DateTime } from 'luxon'
import { column } from '@adonisjs/lucid/orm'
import type { ISODate } from '@capacitylens/shared/types/entities'
import { withCompanyScope } from '#services/models/scoped_model'
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns'
/** A company-scoped allocation; deletion metadata never serializes. */
export default class Allocation extends compose(AllocationSchema, SoftDeletes, withCompanyScope) {
  @column(booleanColumn('allocations', 'ignore_working_days'))
  declare ignoreWorkingDays: boolean | null

  @column.dateTime(timestampColumn('allocations', 'created_at')) declare createdAt: DateTime
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null
  @column({ serializeAs: null }) declare deletionGroupId: string | null
  @column(isoDateColumn('allocations', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('allocations', 'start_date')) declare startDate: ISODate
  @column.dateTime(timestampColumn('allocations', 'updated_at')) declare updatedAt: DateTime
}
