/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

export type { Route, Path } from './schema.d.ts'

const placeholder: any = {}

const routes = {
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
  'api.planning.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/planning',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"planning"]],
    types: placeholder as Registry['api.planning.show']['types'],
  },
  'api.planning_archive.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/planning/archive',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"archive"]],
    types: placeholder as Registry['api.planning_archive.show']['types'],
  },
  'api.planning_mutations.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/planning/mutations',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"mutations"]],
    types: placeholder as Registry['api.planning_mutations.store']['types'],
  },
  'api.planning_undo.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/planning/undo',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"undo"]],
    types: placeholder as Registry['api.planning_undo.store']['types'],
  },
  'api.planning_redo.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/planning/redo',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"planning"],[0,"redo"]],
    types: placeholder as Registry['api.planning_redo.store']['types'],
  },
  'api.first_company_setup.store': {
    methods: ["POST"],
    pattern: '/api/v1/installation/company',
    tokens: [[0,"api"],[0,"v1"],[0,"installation"],[0,"company"]],
    types: placeholder as Registry['api.first_company_setup.store']['types'],
  },
  'api.companies.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"]],
    types: placeholder as Registry['api.companies.index']['types'],
  },
  'api.import_previews.store': {
    methods: ["POST"],
    pattern: '/api/v1/import/preview',
    tokens: [[0,"api"],[0,"v1"],[0,"import"],[0,"preview"]],
    types: placeholder as Registry['api.import_previews.store']['types'],
  },
  'api.imports.store': {
    methods: ["POST"],
    pattern: '/api/v1/import/apply',
    tokens: [[0,"api"],[0,"v1"],[0,"import"],[0,"apply"]],
    types: placeholder as Registry['api.imports.store']['types'],
  },
  'api.company_state.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/state',
    tokens: [[0,"api"],[0,"v1"],[0,"state"]],
    types: placeholder as Registry['api.company_state.show']['types'],
  },
  'api.company_exports.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/export',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"export"]],
    types: placeholder as Registry['api.company_exports.show']['types'],
  },
  'api.company_anonymisations.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/anonymise',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"anonymise"]],
    types: placeholder as Registry['api.company_anonymisations.store']['types'],
  },
  'api.resource_anonymisations.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/resources/:id/anonymise',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"resources"],[1,"id"],[0,"anonymise"]],
    types: placeholder as Registry['api.resource_anonymisations.store']['types'],
  },
  'api.example_data.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/example-data',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"example-data"]],
    types: placeholder as Registry['api.example_data.store']['types'],
  },
  'api.getting_started.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/getting-started',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"getting-started"]],
    types: placeholder as Registry['api.getting_started.show']['types'],
  },
  'api.getting_started.update': {
    methods: ["PUT"],
    pattern: '/api/v1/companies/:companyId/getting-started',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"getting-started"]],
    types: placeholder as Registry['api.getting_started.update']['types'],
  },
  'api.session.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/auth/me',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"me"]],
    types: placeholder as Registry['api.session.show']['types'],
  },
  'api.new_account.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/sign-up',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"sign-up"]],
    types: placeholder as Registry['api.new_account.store']['types'],
  },
  'api.session.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/sign-in',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"sign-in"]],
    types: placeholder as Registry['api.session.store']['types'],
  },
  'api.password_confirmations.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/password-confirmation',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"password-confirmation"]],
    types: placeholder as Registry['api.password_confirmations.store']['types'],
  },
  'api.password_reset_requests.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/request-reset',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"request-reset"]],
    types: placeholder as Registry['api.password_reset_requests.store']['types'],
  },
  'api.password_resets.show': {
    methods: ["POST"],
    pattern: '/api/v1/auth/inspect-reset',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"inspect-reset"]],
    types: placeholder as Registry['api.password_resets.show']['types'],
  },
  'api.password_resets.update': {
    methods: ["POST"],
    pattern: '/api/v1/auth/reset-password',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"reset-password"]],
    types: placeholder as Registry['api.password_resets.update']['types'],
  },
  'api.password.update': {
    methods: ["POST"],
    pattern: '/api/v1/auth/change-password',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"change-password"]],
    types: placeholder as Registry['api.password.update']['types'],
  },
  'api.account.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/auth/delete-account',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"delete-account"]],
    types: placeholder as Registry['api.account.destroy']['types'],
  },
  'api.email_verification_requests.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/verification/send',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"verification"],[0,"send"]],
    types: placeholder as Registry['api.email_verification_requests.store']['types'],
  },
  'api.email_verifications.show': {
    methods: ["POST"],
    pattern: '/api/v1/auth/verification/inspect',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"verification"],[0,"inspect"]],
    types: placeholder as Registry['api.email_verifications.show']['types'],
  },
  'api.email_verifications.update': {
    methods: ["POST"],
    pattern: '/api/v1/auth/verification/complete',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"verification"],[0,"complete"]],
    types: placeholder as Registry['api.email_verifications.update']['types'],
  },
  'api.session.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/auth/sign-out',
    tokens: [[0,"api"],[0,"v1"],[0,"auth"],[0,"sign-out"]],
    types: placeholder as Registry['api.session.destroy']['types'],
  },
  'api.members.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/members',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"members"]],
    types: placeholder as Registry['api.members.index']['types'],
  },
  'api.member_sign_in_tracking.update': {
    methods: ["PUT"],
    pattern: '/api/v1/companies/:companyId/member-sign-in-tracking',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"member-sign-in-tracking"]],
    types: placeholder as Registry['api.member_sign_in_tracking.update']['types'],
  },
  'api.members.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/companies/:companyId/members/:userId',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"]],
    types: placeholder as Registry['api.members.update']['types'],
  },
  'api.member_status.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/companies/:companyId/members/:userId/status',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"status"]],
    types: placeholder as Registry['api.member_status.update']['types'],
  },
  'api.invitations.store': {
    methods: ["POST"],
    pattern: '/api/v1/invitations',
    tokens: [[0,"api"],[0,"v1"],[0,"invitations"]],
    types: placeholder as Registry['api.invitations.store']['types'],
  },
  'api.invitations.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/companies/:companyId/invitations',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"invitations"]],
    types: placeholder as Registry['api.invitations.index']['types'],
  },
  'api.invitation_deliveries.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/invitations/:id/resend',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"invitations"],[1,"id"],[0,"resend"]],
    types: placeholder as Registry['api.invitation_deliveries.store']['types'],
  },
  'api.invitations.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/companies/:companyId/invitations/:id',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"invitations"],[1,"id"]],
    types: placeholder as Registry['api.invitations.destroy']['types'],
  },
  'api.invitation_links.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/invitations/:token/preview',
    tokens: [[0,"api"],[0,"v1"],[0,"invitations"],[1,"token"],[0,"preview"]],
    types: placeholder as Registry['api.invitation_links.show']['types'],
  },
  'api.invitation_acceptances.store': {
    methods: ["POST"],
    pattern: '/api/v1/invitations/:token/sign-up',
    tokens: [[0,"api"],[0,"v1"],[0,"invitations"],[1,"token"],[0,"sign-up"]],
    types: placeholder as Registry['api.invitation_acceptances.store']['types'],
  },
  'api.admission.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/admission',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"]],
    types: placeholder as Registry['api.admission.show']['types'],
  },
  'api.admission_requests.store': {
    methods: ["POST"],
    pattern: '/api/v1/admission/request',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[0,"request"]],
    types: placeholder as Registry['api.admission_requests.store']['types'],
  },
  'api.admission_requests.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/admission/requests',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[0,"requests"]],
    types: placeholder as Registry['api.admission_requests.index']['types'],
  },
  'api.admission_approvals.store': {
    methods: ["POST"],
    pattern: '/api/v1/admission/:userId/approve',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[1,"userId"],[0,"approve"]],
    types: placeholder as Registry['api.admission_approvals.store']['types'],
  },
  'api.admission_rejections.store': {
    methods: ["POST"],
    pattern: '/api/v1/admission/:userId/reject',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[1,"userId"],[0,"reject"]],
    types: placeholder as Registry['api.admission_rejections.store']['types'],
  },
  'api.admission_revocations.store': {
    methods: ["POST"],
    pattern: '/api/v1/admission/:userId/revoke',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[1,"userId"],[0,"revoke"]],
    types: placeholder as Registry['api.admission_revocations.store']['types'],
  },
  'api.memberships.store': {
    methods: ["POST"],
    pattern: '/api/v1/admission/complete',
    tokens: [[0,"api"],[0,"v1"],[0,"admission"],[0,"complete"]],
    types: placeholder as Registry['api.memberships.store']['types'],
  },
  'api.member_resource_links.update': {
    methods: ["PUT"],
    pattern: '/api/v1/companies/:companyId/members/:userId/resource-link',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member_resource_links.update']['types'],
  },
  'api.member_resource_links.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/companies/:companyId/members/:userId/resource-link',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"members"],[1,"userId"],[0,"resource-link"]],
    types: placeholder as Registry['api.member_resource_links.destroy']['types'],
  },
  'api.masquerade.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/masquerade',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.store']['types'],
  },
  'api.masquerade.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/masquerade',
    tokens: [[0,"api"],[0,"v1"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.destroy']['types'],
  },
  'api.masquerade.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/masquerade',
    tokens: [[0,"api"],[0,"v1"],[0,"masquerade"]],
    types: placeholder as Registry['api.masquerade.show']['types'],
  },
  'api.ownership_transfers.store': {
    methods: ["POST"],
    pattern: '/api/v1/companies/:companyId/ownership-transfer',
    tokens: [[0,"api"],[0,"v1"],[0,"companies"],[1,"companyId"],[0,"ownership-transfer"]],
    types: placeholder as Registry['api.ownership_transfers.store']['types'],
  },
  'api.diagnostics.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/diagnostics',
    tokens: [[0,"api"],[0,"v1"],[0,"diagnostics"]],
    types: placeholder as Registry['api.diagnostics.show']['types'],
  },
  'api.not_found': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/*',
    tokens: [[0,"api"],[0,"v1"],[2,"*"]],
    types: placeholder as Registry['api.not_found']['types'],
  },
  'spa_fallback': {
    methods: ["GET","HEAD"],
    pattern: '/*',
    tokens: [[2,"*"]],
    types: placeholder as Registry['spa_fallback']['types'],
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
