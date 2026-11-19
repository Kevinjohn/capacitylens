/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  api: {
    planning: {
      show: typeof routes['api.planning.show']
      archive: typeof routes['api.planning.archive']
      mutate: typeof routes['api.planning.mutate']
      undo: typeof routes['api.planning.undo']
      redo: typeof routes['api.planning.redo']
    }
    installation: {
      company: typeof routes['api.installation.company']
    }
    companies: {
      index: typeof routes['api.companies.index']
      anonymise: typeof routes['api.companies.anonymise']
    }
    transfer: {
      preview: typeof routes['api.transfer.preview']
      apply: typeof routes['api.transfer.apply']
    }
    state: typeof routes['api.state']
    export: typeof routes['api.export']
    resources: {
      anonymise: typeof routes['api.resources.anonymise']
    }
    exampleData: typeof routes['api.example-data']
    gettingStarted: {
      show: typeof routes['api.getting-started.show']
      update: typeof routes['api.getting-started.update']
    }
    auth: {
      me: typeof routes['api.auth.me']
      signUp: typeof routes['api.auth.sign-up']
      signIn: typeof routes['api.auth.sign-in']
      signOut: typeof routes['api.auth.sign-out']
      passwordConfirmation: typeof routes['api.auth.password-confirmation']
      requestReset: typeof routes['api.auth.request-reset']
      inspectReset: typeof routes['api.auth.inspect-reset']
      resetPassword: typeof routes['api.auth.reset-password']
      changePassword: typeof routes['api.auth.change-password']
      deleteAccount: typeof routes['api.auth.delete-account']
      verification: {
        send: typeof routes['api.auth.verification.send']
        inspect: typeof routes['api.auth.verification.inspect']
        complete: typeof routes['api.auth.verification.complete']
      }
    }
    members: {
      index: typeof routes['api.members.index']
      tracking: typeof routes['api.members.tracking']
      role: typeof routes['api.members.role']
      status: typeof routes['api.members.status']
    }
    invites: {
      create: typeof routes['api.invites.create']
      index: typeof routes['api.invites.index']
      resend: typeof routes['api.invites.resend']
      revoke: typeof routes['api.invites.revoke']
      preview: typeof routes['api.invites.preview']
      signUp: typeof routes['api.invites.sign-up']
    }
    admission: {
      show: typeof routes['api.admission.show']
      request: typeof routes['api.admission.request']
      complete: typeof routes['api.admission.complete']
      index: typeof routes['api.admission.index']
      approve: typeof routes['api.admission.approve']
      reject: typeof routes['api.admission.reject']
      revoke: typeof routes['api.admission.revoke']
    }
    memberResources: {
      set: typeof routes['api.member-resources.set']
      clear: typeof routes['api.member-resources.clear']
    }
    masquerade: {
      start: typeof routes['api.masquerade.start']
      status: typeof routes['api.masquerade.status']
      end: typeof routes['api.masquerade.end']
    }
    ownership: {
      transfer: typeof routes['api.ownership.transfer']
    }
    health: typeof routes['api.health']
    diagnostics: typeof routes['api.diagnostics']
    notFound: typeof routes['api.not-found']
  }
}
