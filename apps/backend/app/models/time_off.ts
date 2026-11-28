import { TimeOffSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
import { timestampColumn } from '#services/models/scalar_column'
import type { DateTime } from 'luxon'
import { column } from '@adonisjs/lucid/orm'
import type { ISODate } from '@capacitylens/shared/types/entities'
import { withCompanyScope } from '#services/models/scoped_model'
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns'
/** A company-scoped time-off row; deletion metadata stays internal to restoration. */
export default class TimeOff extends compose(TimeOffSchema, SoftDeletes, withCompanyScope) {
  static table = 'time_off'
  @column.dateTime(timestampColumn('time_off', 'created_at')) declare createdAt: DateTime
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null
  @column({ serializeAs: null }) declare deletedBatchId: string | null
  @column(isoDateColumn('time_off', 'end_date')) declare endDate: ISODate
  @column(isoDateColumn('time_off', 'start_date')) declare startDate: ISODate
  @column.dateTime(timestampColumn('time_off', 'updated_at')) declare updatedAt: DateTime
}
