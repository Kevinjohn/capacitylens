/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

export type { Route, Path } from './schema.d.ts'

const placeholder: any = {}

const routes = {
  'api.planning.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/companies/:companyId/planning',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"planning"]],
    types: placeholder as Registry['api.planning.show']['types'],
  },
  'api.planning.archive': {
    methods: ["GET","HEAD"],
    pattern: '/api/companies/:companyId/planning/archive',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"archive"]],
    types: placeholder as Registry['api.planning.archive']['types'],
  },
  'api.planning.mutate': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/planning/mutations',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"mutations"]],
    types: placeholder as Registry['api.planning.mutate']['types'],
  },
  'api.planning.undo': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/planning/undo',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"undo"]],
    types: placeholder as Registry['api.planning.undo']['types'],
  },
  'api.planning.redo': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/planning/redo',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"redo"]],
    types: placeholder as Registry['api.planning.redo']['types'],
  },
  'api.installation.company': {
    methods: ["POST"],
    pattern: '/api/installation/company',
    tokens: [[0,"api"],[0,"installation"],[0,"company"]],
    types: placeholder as Registry['api.installation.company']['types'],
  },
  'api.companies.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/companies',
    tokens: [[0,"api"],[0,"companies"]],
    types: placeholder as Registry['api.companies.index']['types'],
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
  'api.export': {
    methods: ["GET","HEAD"],
    pattern: '/api/companies/:companyId/export',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"export"]],
    types: placeholder as Registry['api.export']['types'],
  },
  'api.companies.anonymise': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/anonymise',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"anonymise"]],
    types: placeholder as Registry['api.companies.anonymise']['types'],
  },
  'api.resources.anonymise': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/resources/:id/anonymise',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"resources"],[1,"id"],[0,"anonymise"]],
    types: placeholder as Registry['api.resources.anonymise']['types'],
  },
  'api.example-data': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/example-data',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"example-data"]],
    types: placeholder as Registry['api.example-data']['types'],
  },
  'api.getting-started.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/companies/:companyId/getting-started',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"getting-started"]],
    types: placeholder as Registry['api.getting-started.show']['types'],
  },
  'api.getting-started.update': {
    methods: ["PUT"],
    pattern: '/api/companies/:companyId/getting-started',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"getting-started"]],
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
  'api.auth.password-confirmation': {
    methods: ["POST"],
    pattern: '/api/auth/password-confirmation',
    tokens: [[0,"api"],[0,"auth"],[0,"password-confirmation"]],
    types: placeholder as Registry['api.auth.password-confirmation']['types'],
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
    pattern: '/api/companies/:companyId/members',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"members"]],
    types: placeholder as Registry['api.members.index']['types'],
  },
  'api.members.tracking': {
    methods: ["PUT"],
    pattern: '/api/companies/:companyId/member-sign-in-tracking',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"member-sign-in-tracking"]],
    types: placeholder as Registry['api.members.tracking']['types'],
  },
  'api.members.role': {
    methods: ["PATCH"],
    pattern: '/api/companies/:companyId/members/:userId',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"]],
    types: placeholder as Registry['api.members.role']['types'],
  },
  'api.members.status': {
    methods: ["PATCH"],
    pattern: '/api/companies/:companyId/members/:userId/status',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"status"]],
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
    pattern: '/api/companies/:companyId/invites',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"invites"]],
    types: placeholder as Registry['api.invites.index']['types'],
  },
  'api.invites.resend': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/invites/:id/resend',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"invites"],[1,"id"],[0,"resend"]],
    types: placeholder as Registry['api.invites.resend']['types'],
  },
  'api.invites.revoke': {
    methods: ["DELETE"],
    pattern: '/api/companies/:companyId/invites/:id',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"invites"],[1,"id"]],
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
    pattern: '/api/companies/:companyId/members/:userId/resource-link',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member-resources.set']['types'],
  },
  'api.member-resources.clear': {
    methods: ["DELETE"],
    pattern: '/api/companies/:companyId/members/:userId/resource-link',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member-resources.clear']['types'],
  },
  'api.masquerade.start': {
    methods: ["POST"],
    pattern: '/api/companies/:companyId/masquerade',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"masquerade"]],
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
    pattern: '/api/companies/:companyId/ownership-transfer',
    tokens: [[0,"api"],[0,"companies"],[1,"companyId"],[0,"ownership-transfer"]],
    types: placeholder as Registry['api.ownership.transfer']['types'],
  },
  'api.health': {
    methods: ["GET","HEAD"],
    pattern: '/api/health',
    tokens: [[0,"api"],[0,"health"]],
    types: placeholder as Registry['api.health']['types'],
  },
  'health_checks.live': {
    methods: ["GET","HEAD"],
    pattern: '/health/live',
    tokens: [[0,"health"],[0,"live"]],
    types: placeholder as Registry['health_checks.live']['types'],
  },
  'health_checks.ready': {
    methods: ["GET","HEAD"],
    pattern: '/health/ready',
    tokens: [[0,"health"],[0,"ready"]],
    types: placeholder as Registry['health_checks.ready']['types'],
  },
  'api.diagnostics': {
    methods: ["GET","HEAD"],
    pattern: '/api/diagnostics',
    tokens: [[0,"api"],[0,"diagnostics"]],
    types: placeholder as Registry['api.diagnostics']['types'],
  },
  'api.not-found': {
    methods: ["GET","HEAD"],
    pattern: '/api/*',
    tokens: [[0,"api"],[2,"*"]],
    types: placeholder as Registry['api.not-found']['types'],
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
