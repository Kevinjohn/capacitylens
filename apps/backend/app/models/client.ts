import { ClientSchema } from '#database/schema';
import {
  beforeDelete,
  beforeFetch,
  beforeFind,
  beforeSave,
  column,
  hasMany,
} from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { booleanColumn, timestampColumn } from '#models_support/scalar_column';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope, requireRowCompany } from '#models_support/scoped_model';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import Project from '#models/project';
/** A client row. `isPrivate` hides the name from non-owners; `builtin` marks the internal client. */
export default class Client extends ClientSchema {
  static forCompany = forCompany;
  static selfAssignPrimaryKey = true;
  @beforeFind()
  static requireFindScope(query: ModelQueryBuilderContract<typeof Client>) {
    requireCompanyScope(query);
  }
  @beforeFetch()
  static requireFetchScope(query: ModelQueryBuilderContract<typeof Client>) {
    requireCompanyScope(query);
  }
  @beforeSave()
  @beforeDelete()
  static requireWriteScope(row: Client) {
    requireRowCompany(row);
  }
  @hasMany(() => Project, { foreignKey: 'clientId' }) declare projects: HasMany<typeof Project>;
  @column(booleanColumn('clients', 'is_private'))
  declare isPrivate: boolean | null;

  @column(booleanColumn('clients', 'builtin'))
  declare builtin: boolean | null;

  @column.dateTime(timestampColumn('clients', 'archived_at')) declare archivedAt: DateTime | null;
  @column.dateTime(timestampColumn('clients', 'created_at')) declare createdAt: DateTime;
  @column.dateTime(timestampColumn('clients', 'updated_at')) declare updatedAt: DateTime;
}
