import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { RefusalError } from '#exceptions/refusal_error';
import type { PermissionKey, Role } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { activeCompanyRole } from './authorization.js';
import { actorIn, type CurrentActor } from './current_actor.js';

export const PASSWORD_CONFIRMATION_KINDS = ['transfer-ownership', 'import', 'anonymise'] as const;
export type PasswordConfirmationKind = (typeof PASSWORD_CONFIRMATION_KINDS)[number];

/** The permission each password-confirmed action needs. */
export const PASSWORD_CONFIRMATION_PERMISSIONS = {
  'transfer-ownership': 'ownership:transfer',
  'import': 'company:import',
  'anonymise': 'company:anonymise',
} as const satisfies Record<PasswordConfirmationKind, PermissionKey>;

/**
 * Reports whether a company role may request or spend password proof for `action`. An action with
 * no permission key is refused.
 */
export function mayConfirmPassword(role: Role | null, action: string): boolean {
  if (role === null || !Object.hasOwn(PASSWORD_CONFIRMATION_PERMISSIONS, action)) return false;
  return access.can(role, PASSWORD_CONFIRMATION_PERMISSIONS[action as PasswordConfirmationKind]);
}

export class PasswordConfirmationError extends RefusalError {
  constructor(message = 'Confirm this action again.') {
    super(message, 403, 'PASSWORD_CONFIRMATION_REQUIRED');
  }
}

/** Resolves live authority for a password confirmation request or spend inside `withActor`. */
export async function passwordConfirmationActor(
  accountId: string,
  trx: TransactionClientContract,
  kind: PasswordConfirmationKind
): Promise<CurrentActor> {
  const actor = actorIn(trx);
  if (actor.masqueradeContext?.isMasquerading) throw new PasswordConfirmationError();
  // The company id arrives in a request body with no length bound, and the membership lookup
  // rejects an overlong id as a fault. This probe turns any unknown id into the proof refusal.
  if (!(await trx.from('accounts').where('id', accountId).select('id').first())) {
    throw new PasswordConfirmationError();
  }
  if (!mayConfirmPassword(await activeCompanyRole(actor.userId, accountId, trx), kind)) {
    throw new PasswordConfirmationError();
  }
  return actor;
}
