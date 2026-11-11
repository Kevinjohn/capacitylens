import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { activeCompanyRole } from './authorization.js';
import { actorIn, type CurrentActor } from './current_actor.js';

export const PASSWORD_CONFIRMATION_KINDS = [
  'transfer-ownership',
  'import',
  'anonymise',
  'delete-account',
] as const;
export type PasswordConfirmationKind = (typeof PASSWORD_CONFIRMATION_KINDS)[number];

export class PasswordConfirmationError extends Error {
  readonly status = 403;
  readonly code = 'PASSWORD_CONFIRMATION_REQUIRED';
  constructor(message = 'Confirm this action again.') {
    super(message);
  }
}

/** Resolves live Owner authority for a password confirmation request or spend inside `withActor`. */
export async function passwordConfirmationActor(
  accountId: string,
  trx: TransactionClientContract
): Promise<CurrentActor> {
  const actor = actorIn(trx);
  if (actor.masqueradeContext?.isMasquerading) throw new PasswordConfirmationError();
  if (!(await trx.from('accounts').where('id', accountId).select('id').first())) {
    throw new PasswordConfirmationError();
  }
  if ((await activeCompanyRole(actor.userId, accountId, trx)) !== 'owner') {
    throw new PasswordConfirmationError();
  }
  return actor;
}
