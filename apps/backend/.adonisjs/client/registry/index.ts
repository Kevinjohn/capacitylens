/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

export type { Route, Path } from './schema.d.ts'

const placeholder: any = {}

const routes = {
  'api.planning.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/planning',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"planning"]],
    types: placeholder as Registry['api.planning.show']['types'],
  },
  'api.planning.archive': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/planning/archive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"planning"],[0,"archive"]],
    types: placeholder as Registry['api.planning.archive']['types'],
  },
  'api.planning.lookup': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/planning/mutations/:mutationId',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"planning"],[0,"mutations"],[1,"mutationId"]],
    types: placeholder as Registry['api.planning.lookup']['types'],
  },
  'api.planning.allocation.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"]],
    types: placeholder as Registry['api.planning.allocation.create']['types'],
  },
  'api.planning.allocation.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/allocations/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[1,"id"]],
    types: placeholder as Registry['api.planning.allocation.update']['types'],
  },
  'api.planning.allocation.createGroup': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations/create-group',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[0,"create-group"]],
    types: placeholder as Registry['api.planning.allocation.createGroup']['types'],
  },
  'api.planning.allocation.delete': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations/:id/delete',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[1,"id"],[0,"delete"]],
    types: placeholder as Registry['api.planning.allocation.delete']['types'],
  },
  'api.planning.allocation.deleteGroup': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations/delete-group',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[0,"delete-group"]],
    types: placeholder as Registry['api.planning.allocation.deleteGroup']['types'],
  },
  'api.planning.restoreGroup': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/planning/restore-group',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"planning"],[0,"restore-group"]],
    types: placeholder as Registry['api.planning.restoreGroup']['types'],
  },
  'api.planning.resource.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/resources',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resources"]],
    types: placeholder as Registry['api.planning.resource.create']['types'],
  },
  'api.planning.resource.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/resources/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resources"],[1,"id"]],
    types: placeholder as Registry['api.planning.resource.update']['types'],
  },
  'api.planning.timeOff.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/time-off',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"time-off"]],
    types: placeholder as Registry['api.planning.timeOff.create']['types'],
  },
  'api.planning.timeOff.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/time-off/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"time-off"],[1,"id"]],
    types: placeholder as Registry['api.planning.timeOff.update']['types'],
  },
  'api.planning.timeOff.delete': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/time-off/:id/delete',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"time-off"],[1,"id"],[0,"delete"]],
    types: placeholder as Registry['api.planning.timeOff.delete']['types'],
  },
  'api.planning.timeOff.deleteGroup': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/time-off/delete-group',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"time-off"],[0,"delete-group"]],
    types: placeholder as Registry['api.planning.timeOff.deleteGroup']['types'],
  },
  'api.planning.closure.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/closures',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"closures"]],
    types: placeholder as Registry['api.planning.closure.create']['types'],
  },
  'api.planning.closure.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/closures/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"closures"],[1,"id"]],
    types: placeholder as Registry['api.planning.closure.update']['types'],
  },
  'api.planning.closure.delete': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/closures/:id/delete',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"closures"],[1,"id"],[0,"delete"]],
    types: placeholder as Registry['api.planning.closure.delete']['types'],
  },
  'api.planning.client.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/clients',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"clients"]],
    types: placeholder as Registry['api.planning.client.create']['types'],
  },
  'api.planning.client.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/clients/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"clients"],[1,"id"]],
    types: placeholder as Registry['api.planning.client.update']['types'],
  },
  'api.planning.client.archive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/clients/:id/archive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"clients"],[1,"id"],[0,"archive"]],
    types: placeholder as Registry['api.planning.client.archive']['types'],
  },
  'api.planning.client.unarchive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/clients/:id/unarchive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"clients"],[1,"id"],[0,"unarchive"]],
    types: placeholder as Registry['api.planning.client.unarchive']['types'],
  },
  'api.planning.project.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/projects',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"projects"]],
    types: placeholder as Registry['api.planning.project.create']['types'],
  },
  'api.planning.project.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/projects/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"projects"],[1,"id"]],
    types: placeholder as Registry['api.planning.project.update']['types'],
  },
  'api.planning.project.archive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/projects/:id/archive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"projects"],[1,"id"],[0,"archive"]],
    types: placeholder as Registry['api.planning.project.archive']['types'],
  },
  'api.planning.project.unarchive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/projects/:id/unarchive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"projects"],[1,"id"],[0,"unarchive"]],
    types: placeholder as Registry['api.planning.project.unarchive']['types'],
  },
  'api.planning.activity.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/activities',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"activities"]],
    types: placeholder as Registry['api.planning.activity.create']['types'],
  },
  'api.planning.activity.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/activities/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"activities"],[1,"id"]],
    types: placeholder as Registry['api.planning.activity.update']['types'],
  },
  'api.planning.activity.archive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/activities/:id/archive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"activities"],[1,"id"],[0,"archive"]],
    types: placeholder as Registry['api.planning.activity.archive']['types'],
  },
  'api.planning.activity.unarchive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/activities/:id/unarchive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"activities"],[1,"id"],[0,"unarchive"]],
    types: placeholder as Registry['api.planning.activity.unarchive']['types'],
  },
  'api.planning.phase.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/phases',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"phases"]],
    types: placeholder as Registry['api.planning.phase.create']['types'],
  },
  'api.planning.phase.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/phases/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"phases"],[1,"id"]],
    types: placeholder as Registry['api.planning.phase.update']['types'],
  },
  'api.planning.phase.delete': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/phases/:id/delete',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"phases"],[1,"id"],[0,"delete"]],
    types: placeholder as Registry['api.planning.phase.delete']['types'],
  },
  'api.planning.discipline.create': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/disciplines',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"disciplines"]],
    types: placeholder as Registry['api.planning.discipline.create']['types'],
  },
  'api.planning.discipline.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/disciplines/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"disciplines"],[1,"id"]],
    types: placeholder as Registry['api.planning.discipline.update']['types'],
  },
  'api.planning.discipline.delete': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/disciplines/:id/delete',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"disciplines"],[1,"id"],[0,"delete"]],
    types: placeholder as Registry['api.planning.discipline.delete']['types'],
  },
  'api.planning.resource.archive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/resources/:id/archive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resources"],[1,"id"],[0,"archive"]],
    types: placeholder as Registry['api.planning.resource.archive']['types'],
  },
  'api.planning.resource.unarchive': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/resources/:id/unarchive',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resources"],[1,"id"],[0,"unarchive"]],
    types: placeholder as Registry['api.planning.resource.unarchive']['types'],
  },
  'api.planning.allocation.duplicate': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations/:id/duplicate',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[1,"id"],[0,"duplicate"]],
    types: placeholder as Registry['api.planning.allocation.duplicate']['types'],
  },
  'api.planning.allocation.repeat': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/allocations/:id/repeat',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"allocations"],[1,"id"],[0,"repeat"]],
    types: placeholder as Registry['api.planning.allocation.repeat']['types'],
  },
  'api.planning.timeOff.repeat': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/time-off/repeat',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"time-off"],[0,"repeat"]],
    types: placeholder as Registry['api.planning.timeOff.repeat']['types'],
  },
  'api.planning.settings.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/settings',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"settings"]],
    types: placeholder as Registry['api.planning.settings.update']['types'],
  },
  'api.installation.company': {
    methods: ["POST"],
    pattern: '/api/installation/company',
    tokens: [[0,"api"],[0,"installation"],[0,"company"]],
    types: placeholder as Registry['api.installation.company']['types'],
  },
  'api.accounts.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts',
    tokens: [[0,"api"],[0,"accounts"]],
    types: placeholder as Registry['api.accounts.index']['types'],
  },
  'api.transfer.preview': {
    methods: ["POST"],
    pattern: '/api/transfer/preview',
    tokens: [[0,"api"],[0,"transfer"],[0,"preview"]],
    types: placeholder as Registry['api.transfer.preview']['types'],
  },
  'api.transfer.apply': {
    methods: ["POST"],
    pattern: '/api/transfer/apply',
    tokens: [[0,"api"],[0,"transfer"],[0,"apply"]],
    types: placeholder as Registry['api.transfer.apply']['types'],
  },
  'api.state': {
    methods: ["GET","HEAD"],
    pattern: '/api/state',
    tokens: [[0,"api"],[0,"state"]],
    types: placeholder as Registry['api.state']['types'],
  },
  'api.accounts.anonymise': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/anonymise',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"anonymise"]],
    types: placeholder as Registry['api.accounts.anonymise']['types'],
  },
  'api.resources.anonymise': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/resources/:id/anonymise',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resources"],[1,"id"],[0,"anonymise"]],
    types: placeholder as Registry['api.resources.anonymise']['types'],
  },
  'api.example-data': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/example-data',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"example-data"]],
    types: placeholder as Registry['api.example-data']['types'],
  },
  'api.getting-started.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/getting-started',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"getting-started"]],
    types: placeholder as Registry['api.getting-started.show']['types'],
  },
  'api.getting-started.update': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/getting-started',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"getting-started"]],
    types: placeholder as Registry['api.getting-started.update']['types'],
  },
  'api.auth.me': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/me',
    tokens: [[0,"api"],[0,"auth"],[0,"me"]],
    types: placeholder as Registry['api.auth.me']['types'],
  },
  'api.auth.sign-up': {
    methods: ["POST"],
    pattern: '/api/auth/sign-up',
    tokens: [[0,"api"],[0,"auth"],[0,"sign-up"]],
    types: placeholder as Registry['api.auth.sign-up']['types'],
  },
  'api.auth.sign-in': {
    methods: ["POST"],
    pattern: '/api/auth/sign-in',
    tokens: [[0,"api"],[0,"auth"],[0,"sign-in"]],
    types: placeholder as Registry['api.auth.sign-in']['types'],
  },
  'api.auth.sign-out': {
    methods: ["POST"],
    pattern: '/api/auth/sign-out',
    tokens: [[0,"api"],[0,"auth"],[0,"sign-out"]],
    types: placeholder as Registry['api.auth.sign-out']['types'],
  },
  'api.auth.action-proof.password': {
    methods: ["POST"],
    pattern: '/api/auth/action-proof/password',
    tokens: [[0,"api"],[0,"auth"],[0,"action-proof"],[0,"password"]],
    types: placeholder as Registry['api.auth.action-proof.password']['types'],
  },
  'api.auth.request-reset': {
    methods: ["POST"],
    pattern: '/api/auth/request-reset',
    tokens: [[0,"api"],[0,"auth"],[0,"request-reset"]],
    types: placeholder as Registry['api.auth.request-reset']['types'],
  },
  'api.auth.inspect-reset': {
    methods: ["POST"],
    pattern: '/api/auth/inspect-reset',
    tokens: [[0,"api"],[0,"auth"],[0,"inspect-reset"]],
    types: placeholder as Registry['api.auth.inspect-reset']['types'],
  },
  'api.auth.reset-password': {
    methods: ["POST"],
    pattern: '/api/auth/reset-password',
    tokens: [[0,"api"],[0,"auth"],[0,"reset-password"]],
    types: placeholder as Registry['api.auth.reset-password']['types'],
  },
  'api.auth.change-password': {
    methods: ["POST"],
    pattern: '/api/auth/change-password',
    tokens: [[0,"api"],[0,"auth"],[0,"change-password"]],
    types: placeholder as Registry['api.auth.change-password']['types'],
  },
  'api.auth.delete-account': {
    methods: ["POST"],
    pattern: '/api/auth/delete-account',
    tokens: [[0,"api"],[0,"auth"],[0,"delete-account"]],
    types: placeholder as Registry['api.auth.delete-account']['types'],
  },
  'api.auth.verification.send': {
    methods: ["POST"],
    pattern: '/api/auth/verification/send',
    tokens: [[0,"api"],[0,"auth"],[0,"verification"],[0,"send"]],
    types: placeholder as Registry['api.auth.verification.send']['types'],
  },
  'api.auth.verification.inspect': {
    methods: ["POST"],
    pattern: '/api/auth/verification/inspect',
    tokens: [[0,"api"],[0,"auth"],[0,"verification"],[0,"inspect"]],
    types: placeholder as Registry['api.auth.verification.inspect']['types'],
  },
  'api.auth.verification.complete': {
    methods: ["POST"],
    pattern: '/api/auth/verification/complete',
    tokens: [[0,"api"],[0,"auth"],[0,"verification"],[0,"complete"]],
    types: placeholder as Registry['api.auth.verification.complete']['types'],
  },
  'api.members.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/members',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"members"]],
    types: placeholder as Registry['api.members.index']['types'],
  },
  'api.members.tracking': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/member-sign-in-tracking',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"member-sign-in-tracking"]],
    types: placeholder as Registry['api.members.tracking']['types'],
  },
  'api.members.role': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/members/:userId',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"members"],[1,"userId"]],
    types: placeholder as Registry['api.members.role']['types'],
  },
  'api.members.status': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/members/:userId/status',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"members"],[1,"userId"],[0,"status"]],
    types: placeholder as Registry['api.members.status']['types'],
  },
  'api.invites.create': {
    methods: ["POST"],
    pattern: '/api/invites',
    tokens: [[0,"api"],[0,"invites"]],
    types: placeholder as Registry['api.invites.create']['types'],
  },
  'api.invites.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/invites',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"invites"]],
    types: placeholder as Registry['api.invites.index']['types'],
  },
  'api.invites.resend': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/invites/:id/resend',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"invites"],[1,"id"],[0,"resend"]],
    types: placeholder as Registry['api.invites.resend']['types'],
  },
  'api.invites.revoke': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/invites/:id',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"invites"],[1,"id"]],
    types: placeholder as Registry['api.invites.revoke']['types'],
  },
  'api.invites.preview': {
    methods: ["GET","HEAD"],
    pattern: '/api/invites/:token/preview',
    tokens: [[0,"api"],[0,"invites"],[1,"token"],[0,"preview"]],
    types: placeholder as Registry['api.invites.preview']['types'],
  },
  'api.invites.sign-up': {
    methods: ["POST"],
    pattern: '/api/invites/:token/signup',
    tokens: [[0,"api"],[0,"invites"],[1,"token"],[0,"signup"]],
    types: placeholder as Registry['api.invites.sign-up']['types'],
  },
  'api.admission.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/admission',
    tokens: [[0,"api"],[0,"admission"]],
    types: placeholder as Registry['api.admission.show']['types'],
  },
  'api.admission.request': {
    methods: ["POST"],
    pattern: '/api/admission/request',
    tokens: [[0,"api"],[0,"admission"],[0,"request"]],
    types: placeholder as Registry['api.admission.request']['types'],
  },
  'api.admission.complete': {
    methods: ["POST"],
    pattern: '/api/admission/complete',
    tokens: [[0,"api"],[0,"admission"],[0,"complete"]],
    types: placeholder as Registry['api.admission.complete']['types'],
  },
  'api.admission.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/admission/requests',
    tokens: [[0,"api"],[0,"admission"],[0,"requests"]],
    types: placeholder as Registry['api.admission.index']['types'],
  },
  'api.admission.approve': {
    methods: ["POST"],
    pattern: '/api/admission/:userId/approve',
    tokens: [[0,"api"],[0,"admission"],[1,"userId"],[0,"approve"]],
    types: placeholder as Registry['api.admission.approve']['types'],
  },
  'api.admission.reject': {
    methods: ["POST"],
    pattern: '/api/admission/:userId/reject',
    tokens: [[0,"api"],[0,"admission"],[1,"userId"],[0,"reject"]],
    types: placeholder as Registry['api.admission.reject']['types'],
  },
  'api.admission.revoke': {
    methods: ["POST"],
    pattern: '/api/admission/:userId/revoke',
    tokens: [[0,"api"],[0,"admission"],[1,"userId"],[0,"revoke"]],
    types: placeholder as Registry['api.admission.revoke']['types'],
  },
  'api.member-resources.set': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"members"],[1,"principalId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member-resources.set']['types'],
  },
  'api.member-resources.clear': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"members"],[1,"principalId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member-resources.clear']['types'],
  },
  'api.member-resources.avatars': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/resource-avatars',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"resource-avatars"]],
    types: placeholder as Registry['api.member-resources.avatars']['types'],
  },
  'api.masquerade.start': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/masquerade',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.start']['types'],
  },
  'api.masquerade.status': {
    methods: ["GET","HEAD"],
    pattern: '/api/masquerade',
    tokens: [[0,"api"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.status']['types'],
  },
  'api.masquerade.end': {
    methods: ["DELETE"],
    pattern: '/api/masquerade',
    tokens: [[0,"api"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.end']['types'],
  },
  'api.ownership.transfer': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/ownership-transfer',
    tokens: [[0,"api"],[0,"accounts"],[1,"accountId"],[0,"ownership-transfer"]],
    types: placeholder as Registry['api.ownership.transfer']['types'],
  },
  'api.health': {
    methods: ["GET","HEAD"],
    pattern: '/api/health',
    tokens: [[0,"api"],[0,"health"]],
    types: placeholder as Registry['api.health']['types'],
  },
  'api.diagnostics': {
    methods: ["GET","HEAD"],
    pattern: '/api/diagnostics',
    tokens: [[0,"api"],[0,"diagnostics"]],
    types: placeholder as Registry['api.diagnostics']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
