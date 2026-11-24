// The development bootstrap identity is the one account the product creates itself, already
// confirmed and with a known password. The kit creates an account only unconfirmed, with a mailed
// proof.

import { inject } from '@adonisjs/core';
import capacitylens from '#config/capacitylens';
import db from '@adonisjs/lucid/services/db';
import hash from '@adonisjs/core/services/hash';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import User from '#models/user';
import { DateTime } from 'luxon';
import { getPasswordLengthFailure } from '@capacitylens/shared/domain/password';

/** The development bootstrap identity. */
@inject()
export class DevelopmentBootstrapService {
  #admission: AccountAdmission;

  constructor(admission: AccountAdmission) {
    this.#admission = admission;
  }

  /** Keeps interrupted-bootstrap recovery explicit rather than adopting an identity by address. */
  buildBootstrapRecoveryMessage() {
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
  async recordBootstrapAdmission(email: string) {
    try {
      await this.#admission.operator.grantInvitation({ email, role: 'admin' });
      await this.#admission.operator.approve({ email });
    } catch (cause) {
      throw new Error(this.buildBootstrapRecoveryMessage(), { cause });
    }
  }

  async bootstrapDevelopmentCredential() {
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
      if (await this.#admission.isAdmitted(user.id)) return;
      throw new Error(this.buildBootstrapRecoveryMessage());
    }
    const passwordHash = await hash.make(password);
    await db.transaction(async (trx) => {
      if (await trx.from('users').select('id').first()) return;
      // The model's hooks set the id and both timestamps; the verification instant is stored the
      // way Account Kit stores it for every other identity.
      await User.create(
        {
          email,
          displayName: 'admin',
          password: passwordHash,
          emailVerifiedAt: DateTime.local(),
          unverifiedEmail: null,
        },
        { client: trx }
      );
    });
    await this.recordBootstrapAdmission(email);
  }
}
