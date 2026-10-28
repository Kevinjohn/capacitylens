import { randomUUID } from 'node:crypto';
import { UserSchema } from '#database/schema';
import { beforeCreate, beforeSave, column } from '@adonisjs/lucid/orm';

export class FirstCompanyPendingError extends Error {
  readonly code = 'FIRST_COMPANY_PENDING';
  readonly status = 409;
  constructor() {
    super('Only the invited first Owner may join before the company exists.');
  }
}

export default class User extends UserSchema {
  // Identities use UUIDs; without this Lucid replaces the id with SQLite's row id after insert.
  static selfAssignPrimaryKey = true;

  @column({ serializeAs: null })
  declare password: string | null;

  /**
   * Account Kit creates identities through this model inside its locked transaction. Until the
   * first company exists, only one invited identity may exist: an ordinary registration sets
   * `unverifiedEmail`, an invitation acceptance leaves it null.
   */
  @beforeCreate()
  static async admitFirstIdentityOnly(user: User) {
    user.id ??= randomUUID();
    user.createdAt = new Date().toISOString();
    const trx = user.$trx;
    if (!trx) throw new Error('Identities are created only inside the Account Kit transaction.');
    if (await trx.from('accounts').select('id').first()) return;
    if (user.unverifiedEmail !== null || (await trx.from('users').select('id').first()))
      throw new FirstCompanyPendingError();
  }

  @beforeSave()
  static touch(user: User) {
    user.updatedAt = new Date().toISOString();
  }
}
