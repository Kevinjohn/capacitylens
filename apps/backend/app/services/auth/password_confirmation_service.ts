import { inject } from '@adonisjs/core';
// `@kevinjohn/adonisjs-confirm-action-with-password`, used with the Account Kit release it pins,
// owns issuance, credential/session/request binding, expiry and transactional consumption. Product
// code owns live company access and the response contract; its pre-flight and transactional
// rules require a confirmed email, admission, a live Owner and no view-as mode. Credential writes
// remain Account Kit-owned.

import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { PasswordConfirmationException } from '#exceptions/password_confirmation_exception';
import type { PermissionKey, Role } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { AuthorizationService } from '#services/auth/authorization_service';
import { CurrentActorService, type CurrentActor } from '#services/auth/current_actor_service';
import type {
  ConfirmationRequest,
  KitContext,
} from '@kevinjohn/adonisjs-confirm-action-with-password/types';

export const PASSWORD_CONFIRMATION_KINDS = ['transfer-ownership', 'import', 'anonymise'] as const;
export type PasswordConfirmationKind = (typeof PASSWORD_CONFIRMATION_KINDS)[number];

/** The permission each password-confirmed action needs. */
export const PASSWORD_CONFIRMATION_PERMISSIONS = {
  'transfer-ownership': 'ownership:transfer',
  'import': 'company:import',
  'anonymise': 'company:anonymise',
} as const satisfies Record<PasswordConfirmationKind, PermissionKey>;

/** Product rules for password-confirmed actions: who may confirm, and when. */
@inject()
export class PasswordConfirmationService {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;

  constructor(currentActor: CurrentActorService, authorization: AuthorizationService) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
  }

  /**
   * Reports whether a company role may request or spend password proof for `action`. An action with
   * no permission key is refused.
   */
  canConfirmPassword(role: Role | null, action: string): boolean {
    if (role === null || !Object.hasOwn(PASSWORD_CONFIRMATION_PERMISSIONS, action)) return false;
    return access.can(role, PASSWORD_CONFIRMATION_PERMISSIONS[action as PasswordConfirmationKind]);
  }

  /** The confirmation package's `authorize` callback, run under the Account Kit lock. */
  async authorizePasswordConfirmation(
    { account, trx }: KitContext,
    { action, scope }: ConfirmationRequest
  ) {
    // Deleting one's own account needs no company permission, as the deletion route needs none.
    if (action === 'delete-account') return scope === String(account.id);
    await this.#currentActor.requireConfirmedAdmission(account, trx);
    return this.canConfirmPassword(
      await this.#authorization.getActiveCompanyRole(String(account.id), scope, trx),
      action
    );
  }

  /**
   * Refuses password-confirmed work while a view-as mode is active. Every issuance and spend calls
   * this; the confirmation package's `authorize` hook runs in its own transaction and cannot see the
   * request's mode.
   */
  refuseWhileViewing(actor: CurrentActor) {
    if (actor.masqueradeContext?.isMasquerading) throw new PasswordConfirmationException();
  }

  /** Resolves live access for a password confirmation request or spend inside `withActor`. */
  async requirePasswordConfirmationActor(
    companyId: string,
    trx: TransactionClientContract,
    kind: PasswordConfirmationKind
  ): Promise<CurrentActor> {
    const actor = this.#currentActor.requireActor(trx);
    this.refuseWhileViewing(actor);
    // The company id arrives in a request body with no length bound, and the membership lookup
    // rejects an overlong id as a fault. This probe turns any unknown id into the proof refusal.
    if (!(await trx.from('companies').where('id', companyId).select('id').first())) {
      throw new PasswordConfirmationException();
    }
    if (
      !this.canConfirmPassword(
        await this.#authorization.getActiveCompanyRole(actor.userId, companyId, trx),
        kind
      )
    ) {
      throw new PasswordConfirmationException();
    }
    return actor;
  }
}
