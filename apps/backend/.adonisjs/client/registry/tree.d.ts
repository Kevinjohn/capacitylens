/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  api: {
    planning: {
      show: typeof routes['api.planning.show']
      archive: typeof routes['api.planning.archive']
      lookup: typeof routes['api.planning.lookup']
      allocation: {
        create: typeof routes['api.planning.allocation.create']
        update: typeof routes['api.planning.allocation.update']
        createGroup: typeof routes['api.planning.allocation.createGroup']
        delete: typeof routes['api.planning.allocation.delete']
        deleteGroup: typeof routes['api.planning.allocation.deleteGroup']
        duplicate: typeof routes['api.planning.allocation.duplicate']
        repeat: typeof routes['api.planning.allocation.repeat']
      }
      restoreGroup: typeof routes['api.planning.restoreGroup']
      resource: {
        create: typeof routes['api.planning.resource.create']
        update: typeof routes['api.planning.resource.update']
        archive: typeof routes['api.planning.resource.archive']
        unarchive: typeof routes['api.planning.resource.unarchive']
      }
      timeOff: {
        create: typeof routes['api.planning.timeOff.create']
        update: typeof routes['api.planning.timeOff.update']
        delete: typeof routes['api.planning.timeOff.delete']
        deleteGroup: typeof routes['api.planning.timeOff.deleteGroup']
        repeat: typeof routes['api.planning.timeOff.repeat']
      }
      closure: {
        create: typeof routes['api.planning.closure.create']
        update: typeof routes['api.planning.closure.update']
        delete: typeof routes['api.planning.closure.delete']
      }
      client: {
        create: typeof routes['api.planning.client.create']
        update: typeof routes['api.planning.client.update']
        archive: typeof routes['api.planning.client.archive']
        unarchive: typeof routes['api.planning.client.unarchive']
      }
      project: {
        create: typeof routes['api.planning.project.create']
        update: typeof routes['api.planning.project.update']
        archive: typeof routes['api.planning.project.archive']
        unarchive: typeof routes['api.planning.project.unarchive']
      }
      activity: {
        create: typeof routes['api.planning.activity.create']
        update: typeof routes['api.planning.activity.update']
        archive: typeof routes['api.planning.activity.archive']
        unarchive: typeof routes['api.planning.activity.unarchive']
      }
      phase: {
        create: typeof routes['api.planning.phase.create']
        update: typeof routes['api.planning.phase.update']
        delete: typeof routes['api.planning.phase.delete']
      }
      discipline: {
        create: typeof routes['api.planning.discipline.create']
        update: typeof routes['api.planning.discipline.update']
        delete: typeof routes['api.planning.discipline.delete']
      }
      settings: {
        update: typeof routes['api.planning.settings.update']
      }
    }
    installation: {
      company: typeof routes['api.installation.company']
    }
    accounts: {
      index: typeof routes['api.accounts.index']
      anonymise: typeof routes['api.accounts.anonymise']
    }
    transfer: {
      preview: typeof routes['api.transfer.preview']
      apply: typeof routes['api.transfer.apply']
    }
    state: typeof routes['api.state']
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
      actionProof: {
        password: typeof routes['api.auth.action-proof.password']
      }
      requestReset: typeof routes['api.auth.request-reset']
      inspectReset: typeof routes['api.auth.inspect-reset']
      resetPassword: typeof routes['api.auth.reset-password']
      changePassword: typeof routes['api.auth.change-password']
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
      enableAccess: typeof routes['api.members.enable-access']
      remove: typeof routes['api.members.remove']
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
      avatars: typeof routes['api.member-resources.avatars']
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
  }
}
