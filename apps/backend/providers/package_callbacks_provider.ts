import type { ApplicationService } from '@adonisjs/core/types';

/**
 * Supplies the product callbacks that Account Kit, admission, Masquerade and Password
 * Confirmations call, so their config files hold plain options only. Runs in `boot()`, before
 * the Masquerade provider builds its runtime.
 */
export default class PackageCallbacksProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    const container = this.app.container;
    const accountKitCallbacks = await container.make('account_kit.callbacks');
    const admissionCallbacks = await container.make('account_admission.callbacks');
    const masqueradeCallbacks = await container.make('masquerade.callbacks');
    const passwordConfirmationCallbacks = await container.make('password_confirmations.callbacks');

    accountKitCallbacks.register(async () => {
      const { accessControlKitCallbacks } =
        await import('@kevinjohn/adonisjs-access-control/account-kit');
      const { withAdmissionCleanup, withInvitationEvidence } =
        await import('@kevinjohn/adonisjs-account-kit/admission');
      const { recordInvitationAccepted, withDeletionRecords } =
        await import('#services/account_kit/membership_effects');
      const { onCredentialsChangedTransaction } =
        await import('#services/account_kit/admission_rules');
      const { requireRegistrationDisplayName, users } = await import('#services/account_kit/users');
      // Access Control decides who may invite, creates the invited membership and removes memberships
      // when an account is deleted; the product adds its audit and planning-revision records.
      const memberships = accessControlKitCallbacks({
        onInvitationAccepted: recordInvitationAccepted,
      });
      return {
        users,
        authorize: memberships.authorize,
        mapRegistrationFields: (data) => ({ name: requireRegistrationDisplayName(data) }),
        onInvitationAccepted: withInvitationEvidence(memberships.onInvitationAccepted),
        onAccountDeletingTransaction: withAdmissionCleanup(
          withDeletionRecords(memberships.onAccountDeletingTransaction)
        ),
        onCredentialsChangedTransaction,
      };
    });
    admissionCallbacks.register(async () => {
      const { admissionAuthorize } = await import('#services/account_kit/admission_rules');
      return { approvalAuthorize: admissionAuthorize };
    });
    masqueradeCallbacks.register(async () => {
      const { nativeAdapter, masqueradePolicy } =
        await import('#services/auth/masquerade_authority');
      return { native: nativeAdapter, policy: masqueradePolicy };
    });
    passwordConfirmationCallbacks.register(async () => {
      const { authorizePasswordConfirmation } =
        await import('#services/auth/password_confirmation');
      return { authorize: authorizePasswordConfirmation };
    });
  }
}
