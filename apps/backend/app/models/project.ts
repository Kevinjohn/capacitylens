import { ProjectSchema } from '#database/schema';
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { booleanColumn, deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import Activity from '#models/activity';
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

  @column.dateTime(timestampColumn('projects', 'archived_at')) declare archivedAt: DateTime | null;
  @column.dateTime(timestampColumn('projects', 'created_at')) declare createdAt: DateTime;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column.dateTime(timestampColumn('projects', 'updated_at')) declare updatedAt: DateTime;
}
