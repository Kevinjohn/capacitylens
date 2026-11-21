import { ClientSchema } from '#database/schema';
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm';
import type { HasMany } from '@adonisjs/lucid/types/relations';
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete';
import { booleanColumn, deletedAtColumn } from '#models/scalar_column';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import type { DateTime } from 'luxon';
import { forCompany, requireCompanyScope } from '#models/scoped_model';
import Project from '#models/project';
import { isoTimestampColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
/** A client row. `isPrivate` hides the name from non-owners; `builtin` marks the internal client. */
export default class Client extends SoftDeletes(ClientSchema) {
  static forCompany = forCompany;
  @beforeFind() static requireFindScope = requireCompanyScope;
  @beforeFetch() static requireFetchScope = requireCompanyScope;
  @hasMany(() => Project, { foreignKey: 'clientId' }) declare projects: HasMany<typeof Project>;
  @column(booleanColumn('clients', 'is_private'))
  declare isPrivate: boolean | null;

  @column(booleanColumn('clients', 'builtin'))
  declare builtin: boolean | null;

  @column(isoTimestampColumn('clients', 'archived_at')) declare archivedAt: ISOTimestamp | null;
  @column(isoTimestampColumn('clients', 'created_at')) declare createdAt: ISOTimestamp;
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null;
  @column(isoTimestampColumn('clients', 'updated_at')) declare updatedAt: ISOTimestamp;
}
