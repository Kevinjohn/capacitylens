/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  api: {
    planning: {
      show: typeof routes['api.planning.show']
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
    batch: typeof routes['api.batch']
    import: typeof routes['api.import']
    state: typeof routes['api.state']
    orgs: {
      store: typeof routes['api.orgs.store']
    }
    accounts: {
      store: typeof routes['api.accounts.store']
      update: typeof routes['api.accounts.update']
      destroy: typeof routes['api.accounts.destroy']
      index: typeof routes['api.accounts.index']
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
      providerStart: typeof routes['api.auth.provider-start']
      requestReset: typeof routes['api.auth.request-reset']
      resetPassword: typeof routes['api.auth.reset-password']
      changePassword: typeof routes['api.auth.change-password']
    }
    members: {
      index: typeof routes['api.members.index']
      tracking: typeof routes['api.members.tracking']
      role: typeof routes['api.members.role']
      status: typeof routes['api.members.status']
      enableAccess: typeof routes['api.members.enable-access']
      remove: typeof routes['api.members.remove']
      resetPassword: typeof routes['api.members.reset-password']
      revokeSessions: typeof routes['api.members.revoke-sessions']
    }
    invites: {
      create: typeof routes['api.invites.create']
      index: typeof routes['api.invites.index']
      revoke: typeof routes['api.invites.revoke']
      preview: typeof routes['api.invites.preview']
      accept: typeof routes['api.invites.accept']
      signUp: typeof routes['api.invites.sign-up']
    }
    joining: {
      policy: typeof routes['api.joining.policy']
      updatePolicy: typeof routes['api.joining.update-policy']
      metadata: typeof routes['api.joining.metadata']
      status: typeof routes['api.joining.status']
      completeExisting: typeof routes['api.joining.complete-existing']
      requestProof: typeof routes['api.joining.request-proof']
      verifyEmail: typeof routes['api.joining.verify-email']
    }
    memberResources: {
      set: typeof routes['api.member-resources.set']
      clear: typeof routes['api.member-resources.clear']
      clearException: typeof routes['api.member-resources.clear-exception']
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
    google: {
      callback: typeof routes['api.google.callback']
      link: typeof routes['api.google.link']
      identity: typeof routes['api.google.identity']
      joinStart: typeof routes['api.google.join-start']
      joinCancel: typeof routes['api.google.join-cancel']
      joinComplete: typeof routes['api.google.join-complete']
    }
    lifecycle: typeof routes['api.lifecycle']
    health: typeof routes['api.health']
  }
}
