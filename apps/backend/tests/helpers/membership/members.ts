import db from '@adonisjs/lucid/services/db';

/** The password every membership spec signs its people up with. */
export const password = 'batman-secret-2026';

/** The id of the identity with `email`; fails the test when it is missing. */
export async function userIdByEmail(email: string) {
  const user = await db.from('users').where('email', email).select('id').first();
  if (!user) throw new Error(`Missing test user: ${email}`);
  return String(user.id);
}

/** The sign-in observation a company holds for one member, if tracking recorded one. */
export async function signInObservation(companyId: string, targetUserId: string) {
  return db
    .from('company_settings')
    .where({ company_id: companyId, key: `member-sign-in:${targetUserId}` })
    .first();
}
