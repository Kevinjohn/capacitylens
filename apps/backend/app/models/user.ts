import { randomUUID } from 'node:crypto';
import FirstCompanyPendingException from '#exceptions/first_company_pending_exception';
import { UserSchema } from '#database/schema';
import { beforeCreate, beforeSave, column } from '@adonisjs/lucid/orm';
import app from '@adonisjs/core/services/app';
import { InstallationCompanyService } from '#services/installation_company_service';

export default class User extends UserSchema {
  // Identities use UUIDs; without this Lucid replaces the id with SQLite's row id after insert.
  static selfAssignPrimaryKey = true;

  @column({ serializeAs: null })
  declare password: string | null;

  /**
   * Account Kit creates identities through this model inside its locked transaction. Until the
   * first company exists, only one invited identity may exist: an ordinary sign-up sets
   * `unverifiedEmail`, an invitation acceptance leaves it null.
   */
  @beforeCreate()
  static async admitFirstIdentityOnly(user: User) {
    // The column is declared as always present, but a model created without an id has none yet.
    const draft: { id?: string } = user;
    draft.id ??= randomUUID();
    user.createdAt = new Date().toISOString();
    const trx = user.$trx;
    if (!trx) throw new Error('Identities are created only inside the Account Kit transaction.');
    const installationCompany = await app.container.make(InstallationCompanyService);
    if (!(await installationCompany.hasNoCompany(trx))) return;
    if (user.unverifiedEmail !== null || (await User.query({ client: trx }).select('id').first())) {
      throw new FirstCompanyPendingException();
    }
  }

  @beforeSave()
  static touch(user: User) {
    user.updatedAt = new Date().toISOString();
  }
}
