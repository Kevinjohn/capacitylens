import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import type {
  AccountUser,
  CredentialChangeContext,
  Trx,
} from '@kevinjohn/adonisjs-account-kit/types';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import type { AdmissionAuthorizeCallbacks } from '@kevinjohn/adonisjs-account-kit/admission';
import type { Role } from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { getActiveCompanyRole } from '#services/auth/authorization';
import { writeAudit } from '#services/audit';
import { getInstallationCompanyId } from '#services/installation_company';

/** Roles an invitation may carry; ownership moves only through company setup or transfer. */
export const INVITABLE_ROLES = ['viewer', 'editor', 'admin'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

// Reuses the Kit callback's transaction when it supplies one, so the read sees its uncommitted state.
async function getCompanyRole(userId: string, trx: Trx | undefined): Promise<Role | null> {
  const companyId = await getInstallationCompanyId(trx ?? db);
  return companyId ? getActiveCompanyRole(userId, companyId, trx) : null;
}

/**
 * The product's admission and invitation rules, and the credential audit, for the Account Kit.
 * The Kit's admission service is resolved when a rule runs, not injected: resolving it builds these
 * callbacks, so constructor injection would make the two wait on each other.
 */
export class AdmissionRuleService {
  isInvitableRole(value: unknown): value is InvitableRole {
    return INVITABLE_ROLES.includes(value as InvitableRole);
  }

  /** Admission is read through the supplied transaction so a callback never opens a second one. */
  async isAdmitted(userId: string, trx?: Trx) {
    const admission = await app.container.make(AccountAdmission);
    return admission.isAdmitted(userId, trx);
  }

  async #canManageInvitations(userId: string, trx: Trx | undefined) {
    const role = await getCompanyRole(userId, trx);
    return Boolean(
      role && access.can(role, 'invitations:manage') && (await this.isAdmitted(userId, trx))
    );
  }

  /** Owners and Admins decide admission, never for someone their role cannot administer. */
  readonly admissionAuthorize: AdmissionAuthorizeCallbacks = {
    decide: async (actor, subject, context) => {
      const trx = context?.trx;
      const actorRole = await getCompanyRole(String(actor.id), trx);
      if (!actorRole || !access.can(actorRole, 'invitations:manage')) return false;
      const subjectRole = await getCompanyRole(String(subject.id), trx);
      const isSelf = String(actor.id) === String(subject.id);
      return (
        !subjectRole || access.canManage({ actorRole, targetRole: subjectRole, isSelf }).allowed
      );
    },
    // The Kit checks the decider's own admission; listing, which discloses addresses, needs the same.
    list: async (actor, context) => this.#canManageInvitations(String(actor.id), context?.trx),
  };

  /** Records a credential change against every company the identity belongs to. */
  async onCredentialsChangedTransaction(
    user: AccountUser,
    context: CredentialChangeContext,
    trx: Trx
  ) {
    for (const membership of await access.memberships.listForUser(String(user.id), trx)) {
      await writeAudit(trx, {
        companyId: String(membership.scopeId),
        actorId: String(user.id),
        action: 'identity.credentials_changed',
        entity: 'user',
        entityId: String(user.id),
        fields: [context.operation],
      });
    }
  }
}
