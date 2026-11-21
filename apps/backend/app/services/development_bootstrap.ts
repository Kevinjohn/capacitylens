// The development bootstrap identity is the one account written straight into `users`, already
// confirmed and with a known password. The kit creates an account only unconfirmed, with a mailed
// proof.

import type { ApplicationService } from '@adonisjs/core/types';
import capacitylens from '#config/capacitylens';
import db from '@adonisjs/lucid/services/db';
import hash from '@adonisjs/core/services/hash';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import User from '#models/user';
import { getPasswordLengthFailure } from '@capacitylens/shared/domain/password';

/** Keeps interrupted-bootstrap recovery explicit rather than adopting an identity by address. */
export function buildBootstrapRecoveryMessage() {
  return [
    'The development bootstrap identity exists but is not admitted.',
    'Set CAPACITYLENS_CREATE_ADMIN_ADMIN=false, start the server, sign in, and inspect GET /api/admission.',
    'Verify this is the identity created by the interrupted local bootstrap, then stop the server.',
    'Run only the command for each unmet requirement before restarting normally:',
    'node ace.js account-kit:admission:grant-invitation admin@admin.admin --role admin',
    'node ace.js account-kit:admission:approve admin@admin.admin',
    'Do not run operator commands while the server is running.',
    'The bootstrap never changes an existing password.',
  ].join(' ');
}

/** Preserves the committed identity when admission setup needs operator recovery. */
export async function recordBootstrapAdmission(
  admission: Pick<AccountAdmission, 'operator'>,
  email: string
) {
  try {
    await admission.operator.grantInvitation({ email, role: 'admin' });
    await admission.operator.approve({ email });
  } catch (cause) {
    throw new Error(buildBootstrapRecoveryMessage(), { cause });
  }
}

export async function bootstrapDevelopmentCredential(app: ApplicationService) {
  if (!capacitylens.createAdmin) return;
  const password = capacitylens.bootstrapAdminPassword;
  if (!password || getPasswordLengthFailure(password)) {
    throw new Error(
      'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD must satisfy the password length policy'
    );
  }
  const email = 'admin@admin.admin';
  const existing = await db.from('users').select('id').first();
  if (existing) {
    const user = await User.findBy('email', email);
    if (!user) return;
    const admission = await app.container.make(AccountAdmission);
    if (await admission.isAdmitted(user.id)) return;
    throw new Error(buildBootstrapRecoveryMessage());
  }
  const passwordHash = await hash.make(password);
  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    if (await trx.from('users').select('id').first()) return;
    await trx.table('users').insert({
      id: crypto.randomUUID(),
      email,
      display_name: 'admin',
      password: passwordHash,
      email_verified_at: now,
      unverified_email: null,
      created_at: now,
      updated_at: now,
    });
  });
  const admission = await app.container.make(AccountAdmission);
  await recordBootstrapAdmission(admission, email);
}
