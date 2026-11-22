import { ClientSchema } from '#database/schema';
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { booleanColumn, deletedAtColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import Project from '#models/project';
/** A client row. `isPrivate` hides the name from non-owners; `builtin` marks the internal client. */
export default class Client extends SoftDeletes(ClientSchema) {
  static forCompany = forCompany;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Client>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Client>) {
    requireCompanyScope(query);
  }
  @hasMany(() => Project, { foreignKey: 'clientId' }) declare projects: HasMany<typeof Project>;
  @column(booleanColumn('clients', 'is_private'))
  declare isPrivate: boolean | null;

  @column(booleanColumn('clients', 'builtin'))
  declare builtin: boolean | null;

  @column.dateTime(timestampColumn('clients', 'archived_at')) declare archivedAt: DateTime | null;
  @column.dateTime(timestampColumn('clients', 'created_at')) declare createdAt: DateTime;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column.dateTime(timestampColumn('clients', 'updated_at')) declare updatedAt: DateTime;
}
