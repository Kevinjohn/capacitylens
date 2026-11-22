import { TimeOffSchema } from '#database/schema';
import { compose } from '@adonisjs/core/helpers';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISODate } from '@capacitylens/shared/types/entities';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped time-off row; deletion metadata stays internal to restoration. */
export default class TimeOff extends compose(TimeOffSchema, SoftDeletes) {
  static forCompany = forCompany;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof TimeOff>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof TimeOff>) {
    requireCompanyScope(query);
  }
  static table = 'time_off';
  @column.dateTime(timestampColumn('time_off', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoDateColumn('time_off', 'end_date')) declare endDate: ISODate;
  @column(isoDateColumn('time_off', 'start_date')) declare startDate: ISODate;
  @column.dateTime(timestampColumn('time_off', 'updated_at')) declare updatedAt: DateTime;
}
