import { ProjectSchema } from '#database/schema';
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { SoftDeletes } from '@kevinjohn/lucid-soft-deletes';
import { isBoolean, jsonColumn } from '#models/json_column';
import { deletedAtColumn, isoTimestampColumn } from '#models/scalar_column';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model';
import Activity from '#models/activity';
export default class Project extends SoftDeletes(ProjectSchema) {
  static forCompany = forCompany;
  static forTrustedLocal = forTrustedLocal;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @hasMany(() => Activity, { foreignKey: 'projectId' }) declare activities: HasMany<
    typeof Activity
  >;
  @column(jsonColumn('projects', 'is_private', isBoolean))
  declare isPrivate: boolean | null;

  @column(isoTimestampColumn('projects', 'archived_at')) declare archivedAt: ISOTimestamp | null;
  @column(isoTimestampColumn('projects', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column(isoTimestampColumn('projects', 'updated_at')) declare updatedAt: ISOTimestamp;
}
