// `@kevinjohn/adonisjs-confirm-action-with-password` 0.2.0, used with exactly Account Kit 0.4.0,
// owns issuance, credential/session/request binding, expiry and transactional consumption. Product
// code owns live company authority and the response contract; its pre-flight and transactional
// policy require a confirmed email, admission, a live Owner and no view-as mode. Credential writes
// remain Account Kit-owned.

import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { RefusalError } from '#exceptions/refusal_error';
import type { PermissionKey, Role } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { getActiveCompanyRole } from './authorization.js';
import { requireActor, type CurrentActor } from './current_actor.js';

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
export function canConfirmPassword(role: Role | null, action: string): boolean {
  if (role === null || !Object.hasOwn(PASSWORD_CONFIRMATION_PERMISSIONS, action)) return false;
  return access.can(role, PASSWORD_CONFIRMATION_PERMISSIONS[action as PasswordConfirmationKind]);
}

export class PasswordConfirmationError extends RefusalError {
  constructor(message = 'Confirm this action again.') {
    super(message, 403, 'PASSWORD_CONFIRMATION_REQUIRED');
  }
}

/**
 * Refuses password-confirmed work while a view-as mode is active. Every issuance and spend calls
 * this; the confirmation package's `authorize` hook runs in its own transaction and cannot see the
 * request's mode.
 */
export function refuseWhileViewing(actor: CurrentActor) {
  if (actor.masqueradeContext?.isMasquerading) throw new PasswordConfirmationError();
}

/** Resolves live authority for a password confirmation request or spend inside `withActor`. */
export async function requirePasswordConfirmationActor(
  companyId: string,
  trx: TransactionClientContract,
  kind: PasswordConfirmationKind
): Promise<CurrentActor> {
  const actor = requireActor(trx);
  refuseWhileViewing(actor);
  // The company id arrives in a request body with no length bound, and the membership lookup
  // rejects an overlong id as a fault. This probe turns any unknown id into the proof refusal.
  if (!(await trx.from('accounts').where('id', companyId).select('id').first())) {
    throw new PasswordConfirmationError();
  }
  if (!canConfirmPassword(await getActiveCompanyRole(actor.userId, companyId, trx), kind)) {
    throw new PasswordConfirmationError();
  }
  return actor;
}
