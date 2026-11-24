import type { ApplicationService } from '@adonisjs/core/types';

/**
 * Supplies the product callbacks that Account Kit, admission, Masquerade and Password
 * Confirmations call, so their config files hold plain options only. Runs in `boot()`, before
 * the Masquerade provider builds its runtime.
 *
 * The Kit runs the Account Kit and admission factories while it is still building `AccountKit` and
 * `AccountAdmission`. A service that takes either one through its constructor is therefore
 * resolved when its callback runs, never in a factory body: built there, the two would wait on
 * each other and the container would never settle.
 */
export default class PackageCallbacksProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    const container = this.app.container;
    const accountKitCallbacks = await container.make('account_kit.callbacks');
    const admissionCallbacks = await container.make('account_admission.callbacks');
    const masqueradeCallbacks = await container.make('masquerade.callbacks');
    const passwordConfirmationCallbacks = await container.make('password_confirmations.callbacks');
    const admissionRules = async () => {
      const { AdmissionRuleService } = await import('#services/account_kit/admission_rule_service');
      return container.make(AdmissionRuleService);
    };

    accountKitCallbacks.register(async () => {
      const { accessControlKitCallbacks } =
        await import('@kevinjohn/adonisjs-access-control/account-kit');
      const { withAdmissionCleanup, withInvitationEvidence } =
        await import('@kevinjohn/adonisjs-account-kit/admission');
      const { MembershipEffectService } =
        await import('#services/account_kit/membership_effect_service');
      const { AccountUserService, users } =
        await import('#services/account_kit/account_user_service');
      const membershipEffects = await container.make(MembershipEffectService);
      const accountUsers = await container.make(AccountUserService);
      // Access Control decides who may invite, creates the invited membership and removes memberships
      // when an account is deleted; the product adds its audit and planning-revision records.
      const memberships = accessControlKitCallbacks({
        onInvitationAccepted: (user, invitation, trx) =>
          membershipEffects.recordInvitationAccepted(user, invitation, trx),
      });
      return {
        users,
        authorize: memberships.authorize,
        mapRegistrationFields: (data) => ({
          name: accountUsers.requireRegistrationDisplayName(data),
        }),
        onInvitationAccepted: withInvitationEvidence(memberships.onInvitationAccepted),
        onAccountDeletingTransaction: withAdmissionCleanup(
          membershipEffects.withDeletionRecords(memberships.onAccountDeletingTransaction)
        ),
        onCredentialsChangedTransaction: async (user, context, trx) => {
          const rules = await admissionRules();
          return rules.onCredentialsChangedTransaction(user, context, trx);
        },
      };
    });
    admissionCallbacks.register(() => ({
      approvalAuthorize: {
        decide: async (actor, subject, context) => {
          const rules = await admissionRules();
          return rules.admissionAuthorize.decide(actor, subject, context);
        },
        list: async (actor, context) => {
          const rules = await admissionRules();
          return rules.admissionAuthorize.list(actor, context);
        },
      },
    }));
    masqueradeCallbacks.register(async () => {
      const { MasqueradeAuthorityService, nativeAdapter } =
        await import('#services/auth/masquerade_authority_service');
      const masqueradeAuthority = await container.make(MasqueradeAuthorityService);
      return { native: nativeAdapter, policy: masqueradeAuthority.masqueradePolicy };
    });
    passwordConfirmationCallbacks.register(async () => {
      const { PasswordConfirmationService } =
        await import('#services/auth/password_confirmation_service');
      const passwordConfirmations = await container.make(PasswordConfirmationService);
      return {
        authorize: (context, request) =>
          passwordConfirmations.authorizePasswordConfirmation(context, request),
      };
    });
  }
}
