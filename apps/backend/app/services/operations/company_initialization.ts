import { parseUserName } from '@capacitylens/shared/lib/strings';
import { createInitialCompany } from '#services/initial_company_defaults';
import { isAdmitted } from '#services/account_kit/policy';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import { withTransaction } from '#services/with_transaction';
import { operatorDatabasePath, withOperatorDatabase } from './operator_database.js';

/** Establish the first company role for an existing native identity without changing admission. */
export async function initializeCompany(input: {
  email: string;
  companyName: string;
  confirmServerStopped: boolean;
}) {
  operatorDatabasePath(input.confirmServerStopped);
  const email = normalizeAccountEmail(input.email);
  const name = parseUserName(input.companyName);
  if (!isAccountEmail(email) || name === null) {
    throw new Error('Refusing invalid email or company name');
  }
  return withOperatorDatabase(async () => {
    await assertSchemaIntegrity();
    return withTransaction(async (trx) => {
      if ((await trx.from('accounts').first()) || (await trx.from('memberships').first())) {
        throw new Error('Refusing company initialization: installation already has company access');
      }
      const principal = await trx
        .from('users')
        .where('email', email)
        .select('id', 'email', 'password', 'unverified_email')
        .first();
      if (!principal) {
        throw new Error('Refusing company initialization: an existing identity is required');
      }
      if (typeof principal.password !== 'string' || !principal.password) {
        throw new Error('Refusing company initialization: identity has no enabled sign-in method');
      }
      // Account Kit treats an address as confirmed unless it is still awaiting its own proof.
      if (principal.unverified_email === principal.email) {
        throw new Error('Refusing company initialization: identity has not confirmed its email');
      }
      if (!(await isAdmitted(String(principal.id), trx))) {
        throw new Error('Refusing company initialization: identity is not admitted');
      }
      return createInitialCompany(trx, { name, ownerId: String(principal.id), actorId: null });
    });
  });
}
