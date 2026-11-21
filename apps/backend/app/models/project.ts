import { ProjectSchema } from '#database/schema';
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { booleanColumn, deletedAtColumn } from '#models/scalar_column';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import Activity from '#models/activity';
import { isoTimestampColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A company-scoped project; `isPrivate` protects its name in member projections. */
export default class Project extends SoftDeletes(ProjectSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @hasMany(() => Activity, { foreignKey: 'projectId' }) declare activities: HasMany<
    typeof Activity
  >;
  @column(booleanColumn('projects', 'is_private'))
  declare isPrivate: boolean | null;

  @column(isoTimestampColumn('projects', 'archived_at')) declare archivedAt: ISOTimestamp | null;
  @column(isoTimestampColumn('projects', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column(isoTimestampColumn('projects', 'updated_at')) declare updatedAt: ISOTimestamp;
}
