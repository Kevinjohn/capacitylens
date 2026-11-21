import db from '@adonisjs/lucid/services/db';
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction';
import { parseUserName } from '@capacitylens/shared/lib/strings';
import { createInitialCompany } from '#services/initial_company_defaults';
import { isAdmitted } from '#services/account_kit/admission_rules';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import access from '#config/access_control';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import { operatorDatabasePath, withOperatorDatabase } from '@kevinjohn/adonisjs-sqlite-backup';
import { hasNoCompany } from '#models/installation_company';

/** Establish the first company role for an existing native identity without changing admission. */
export async function initializeCompany(input: {
  email: string;
  companyName: string;
  confirmServerStopped: boolean;
}) {
  operatorDatabasePath(db, input.confirmServerStopped);
  const email = normalizeAccountEmail(input.email);
  const name = parseUserName(input.companyName);
  if (!isAccountEmail(email) || name === null) {
    throw new Error('Refusing invalid email or company name');
  }
  return withOperatorDatabase(db, async () => {
    await assertSchemaIntegrity();
    // The Kit runner holds the writer lock its package writes rely on.
    return transaction(db, async (trx) => {
      if (!(await hasNoCompany(trx)) || (await trx.from(access.config.membershipsTable).first())) {
        throw new Error('Refusing company initialization: installation already has company access');
      }
      const user = await trx
        .from('users')
        .where('email', email)
        .select('id', 'email', 'password', 'unverified_email')
        .first();
      if (!user) {
        throw new Error('Refusing company initialization: an existing identity is required');
      }
      if (typeof user.password !== 'string' || !user.password) {
        throw new Error('Refusing company initialization: identity has no enabled sign-in method');
      }
      // Account Kit treats an address as confirmed unless it is still awaiting its own proof.
      if (user.unverified_email === user.email) {
        throw new Error('Refusing company initialization: identity has not confirmed its email');
      }
      if (!(await isAdmitted(String(user.id), trx))) {
        throw new Error('Refusing company initialization: identity is not admitted');
      }
      return createInitialCompany(trx, { name, ownerId: String(user.id), actorId: null });
    });
  });
}
