import { AllocationSchema } from '#database/schema';
import { compose } from '@adonisjs/core/helpers';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { booleanColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { beforeDelete, beforeFetch, beforeFind, beforeSave, column } from '@adonisjs/lucid/orm';
import type { ISODate } from '@capacitylens/shared/types/entities';
import { forCompany, requireCompanyScope, requireRowCompany } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import { isoDateColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped allocation; deletion metadata never serializes. */
export default class Allocation extends compose(AllocationSchema, SoftDeletes) {
  static forCompany = forCompany;
  static selfAssignPrimaryKey = true;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Allocation>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Allocation>) {
    requireCompanyScope(query);
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Allocation) {
    requireRowCompany(row);
  }
  @column(booleanColumn('allocations', 'ignore_working_days'))
  declare ignoreWorkingDays: boolean | null;

  @column.dateTime(timestampColumn('allocations', 'created_at')) declare createdAt: DateTime;
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoDateColumn('allocations', 'end_date')) declare endDate: ISODate;
  @column(isoDateColumn('allocations', 'start_date')) declare startDate: ISODate;
  @column.dateTime(timestampColumn('allocations', 'updated_at')) declare updatedAt: DateTime;
}
