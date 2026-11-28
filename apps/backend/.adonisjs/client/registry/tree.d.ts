/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  healthChecks: {
    live: typeof routes['health_checks.live']
    ready: typeof routes['health_checks.ready']
  }
  api: {
    planning: {
      show: typeof routes['api.planning.show']
    }
    planningArchive: {
      show: typeof routes['api.planning_archive.show']
    }
    planningMutations: {
      store: typeof routes['api.planning_mutations.store']
    }
    planningUndo: {
      store: typeof routes['api.planning_undo.store']
    }
    planningRedo: {
      store: typeof routes['api.planning_redo.store']
    }
    firstCompanySetup: {
      store: typeof routes['api.first_company_setup.store']
    }
    companies: {
      index: typeof routes['api.companies.index']
    }
    importPreviews: {
      store: typeof routes['api.import_previews.store']
    }
    imports: {
      store: typeof routes['api.imports.store']
    }
    companyState: {
      show: typeof routes['api.company_state.show']
    }
    companyExport: {
      show: typeof routes['api.company_export.show']
    }
    companyAnonymisations: {
      store: typeof routes['api.company_anonymisations.store']
    }
    resourceAnonymisations: {
      store: typeof routes['api.resource_anonymisations.store']
    }
    exampleData: {
      store: typeof routes['api.example_data.store']
    }
    gettingStarted: {
      show: typeof routes['api.getting_started.show']
      update: typeof routes['api.getting_started.update']
    }
    session: {
      show: typeof routes['api.session.show']
      store: typeof routes['api.session.store']
      destroy: typeof routes['api.session.destroy']
    }
    newAccount: {
      store: typeof routes['api.new_account.store']
    }
    passwordResetRequests: {
      store: typeof routes['api.password_reset_requests.store']
    }
    passwordResets: {
      show: typeof routes['api.password_resets.show']
      update: typeof routes['api.password_resets.update']
    }
    emailVerifications: {
      show: typeof routes['api.email_verifications.show']
      update: typeof routes['api.email_verifications.update']
    }
    passwordConfirmations: {
      store: typeof routes['api.password_confirmations.store']
    }
    password: {
      update: typeof routes['api.password.update']
    }
    account: {
      destroy: typeof routes['api.account.destroy']
    }
    emailVerificationRequests: {
      store: typeof routes['api.email_verification_requests.store']
    }
    members: {
      index: typeof routes['api.members.index']
      update: typeof routes['api.members.update']
    }
    memberSignInTracking: {
      update: typeof routes['api.member_sign_in_tracking.update']
    }
    memberStatus: {
      update: typeof routes['api.member_status.update']
    }
    invitations: {
      store: typeof routes['api.invitations.store']
      index: typeof routes['api.invitations.index']
      destroy: typeof routes['api.invitations.destroy']
    }
    invitationDeliveries: {
      store: typeof routes['api.invitation_deliveries.store']
    }
    invitationLinks: {
      show: typeof routes['api.invitation_links.show']
    }
    invitationAcceptances: {
      store: typeof routes['api.invitation_acceptances.store']
    }
    admission: {
      show: typeof routes['api.admission.show']
    }
    admissionRequests: {
      store: typeof routes['api.admission_requests.store']
      index: typeof routes['api.admission_requests.index']
    }
    admissionApprovals: {
      store: typeof routes['api.admission_approvals.store']
    }
    admissionRejections: {
      store: typeof routes['api.admission_rejections.store']
    }
    admissionRevocations: {
      store: typeof routes['api.admission_revocations.store']
    }
    memberships: {
      store: typeof routes['api.memberships.store']
    }
    memberResourceLink: {
      update: typeof routes['api.member_resource_link.update']
      destroy: typeof routes['api.member_resource_link.destroy']
    }
    masquerade: {
      store: typeof routes['api.masquerade.store']
      destroy: typeof routes['api.masquerade.destroy']
      show: typeof routes['api.masquerade.show']
    }
    ownershipTransfers: {
      store: typeof routes['api.ownership_transfers.store']
    }
    diagnostics: {
      show: typeof routes['api.diagnostics.show']
    }
    notFound: typeof routes['api.not_found']
  }
  spaFallback: typeof routes['spa_fallback']
}
