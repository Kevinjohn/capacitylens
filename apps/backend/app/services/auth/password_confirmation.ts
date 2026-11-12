import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { RefusalError } from '#exceptions/refusal_error';
import { activeCompanyRole } from './authorization.js';
import { actorIn, type CurrentActor } from './current_actor.js';

export const PASSWORD_CONFIRMATION_KINDS = ['transfer-ownership', 'import', 'anonymise'] as const;
export type PasswordConfirmationKind = (typeof PASSWORD_CONFIRMATION_KINDS)[number];

export class PasswordConfirmationError extends RefusalError {
  constructor(message = 'Confirm this action again.') {
    super(message, 403, 'PASSWORD_CONFIRMATION_REQUIRED');
  }
}

/** Resolves live Owner authority for a password confirmation request or spend inside `withActor`. */
export async function passwordConfirmationActor(
  accountId: string,
  trx: TransactionClientContract
): Promise<CurrentActor> {
  const actor = actorIn(trx);
  if (actor.masqueradeContext?.isMasquerading) throw new PasswordConfirmationError();
  // The company id arrives in a request body with no length bound, and the membership lookup
  // rejects an overlong id as a fault. This probe turns any unknown id into the proof refusal.
  if (!(await trx.from('accounts').where('id', accountId).select('id').first())) {
    throw new PasswordConfirmationError();
  }
  if ((await activeCompanyRole(actor.userId, accountId, trx)) !== 'owner') {
    throw new PasswordConfirmationError();
  }
  return actor;
}
