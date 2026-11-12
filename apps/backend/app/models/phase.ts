import { PhaseSchema } from '#database/schema';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { deletedAtColumn } from '#models/scalar_column';
import type { DateTime } from 'luxon';
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import { forCompany, forWholeInstallation, requireCompanyScope } from '#models/scoped_model';
import { isoTimestampColumn } from '#models/scalar_column';
export default class Phase extends SoftDeletes(PhaseSchema) {
  static forCompany = forCompany;
  static forWholeInstallation = forWholeInstallation;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @column(isoTimestampColumn('phases', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime({ ...deletedAtColumn, serializeAs: null }) declare deletedAt: DateTime | null;
  @column({ serializeAs: null }) declare deletionGroupId: string | null;
  @column(isoTimestampColumn('phases', 'updated_at')) declare updatedAt: ISOTimestamp;
}
