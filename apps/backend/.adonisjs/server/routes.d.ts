import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'health_checks.live': { paramsTuple?: []; params?: {} }
    'health_checks.ready': { paramsTuple?: []; params?: {} }
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_archive.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_mutations.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_undo.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_redo.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.first_company_setup.store': { paramsTuple?: []; params?: {} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.import_previews.store': { paramsTuple?: []; params?: {} }
    'api.imports.store': { paramsTuple?: []; params?: {} }
    'api.company_state.show': { paramsTuple?: []; params?: {} }
    'api.company_exports.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.company_anonymisations.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.resource_anonymisations.store': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.example_data.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting_started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting_started.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.session.show': { paramsTuple?: []; params?: {} }
    'api.new_account.store': { paramsTuple?: []; params?: {} }
    'api.session.store': { paramsTuple?: []; params?: {} }
    'api.password_confirmations.store': { paramsTuple?: []; params?: {} }
    'api.password_reset_requests.store': { paramsTuple?: []; params?: {} }
    'api.password_resets.show': { paramsTuple?: []; params?: {} }
    'api.password_resets.update': { paramsTuple?: []; params?: {} }
    'api.password.update': { paramsTuple?: []; params?: {} }
    'api.account.destroy': { paramsTuple?: []; params?: {} }
    'api.email_verification_requests.store': { paramsTuple?: []; params?: {} }
    'api.email_verifications.show': { paramsTuple?: []; params?: {} }
    'api.email_verifications.update': { paramsTuple?: []; params?: {} }
    'api.session.destroy': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.member_sign_in_tracking.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.members.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.member_status.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.invitations.store': { paramsTuple?: []; params?: {} }
    'api.invitations.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invitation_deliveries.store': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invitations.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invitation_links.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.invitation_acceptances.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission_requests.store': { paramsTuple?: []; params?: {} }
    'api.admission_requests.index': { paramsTuple?: []; params?: {} }
    'api.admission_approvals.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission_rejections.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission_revocations.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.memberships.store': { paramsTuple?: []; params?: {} }
    'api.member_resource_links.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.member_resource_links.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.masquerade.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.masquerade.destroy': { paramsTuple?: []; params?: {} }
    'api.masquerade.show': { paramsTuple?: []; params?: {} }
    'api.ownership_transfers.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.diagnostics.show': { paramsTuple?: []; params?: {} }
    'api.not_found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'spa_fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  GET: {
    'health_checks.live': { paramsTuple?: []; params?: {} }
    'health_checks.ready': { paramsTuple?: []; params?: {} }
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_archive.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.company_state.show': { paramsTuple?: []; params?: {} }
    'api.company_exports.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting_started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.session.show': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invitations.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invitation_links.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission_requests.index': { paramsTuple?: []; params?: {} }
    'api.masquerade.show': { paramsTuple?: []; params?: {} }
    'api.diagnostics.show': { paramsTuple?: []; params?: {} }
    'api.not_found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'spa_fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  HEAD: {
    'health_checks.live': { paramsTuple?: []; params?: {} }
    'health_checks.ready': { paramsTuple?: []; params?: {} }
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_archive.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.company_state.show': { paramsTuple?: []; params?: {} }
    'api.company_exports.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting_started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.session.show': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invitations.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invitation_links.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission_requests.index': { paramsTuple?: []; params?: {} }
    'api.masquerade.show': { paramsTuple?: []; params?: {} }
    'api.diagnostics.show': { paramsTuple?: []; params?: {} }
    'api.not_found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'spa_fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  POST: {
    'api.planning_mutations.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_undo.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning_redo.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.first_company_setup.store': { paramsTuple?: []; params?: {} }
    'api.import_previews.store': { paramsTuple?: []; params?: {} }
    'api.imports.store': { paramsTuple?: []; params?: {} }
    'api.company_anonymisations.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.resource_anonymisations.store': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.example_data.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.new_account.store': { paramsTuple?: []; params?: {} }
    'api.session.store': { paramsTuple?: []; params?: {} }
    'api.password_confirmations.store': { paramsTuple?: []; params?: {} }
    'api.password_reset_requests.store': { paramsTuple?: []; params?: {} }
    'api.password_resets.show': { paramsTuple?: []; params?: {} }
    'api.password_resets.update': { paramsTuple?: []; params?: {} }
    'api.password.update': { paramsTuple?: []; params?: {} }
    'api.account.destroy': { paramsTuple?: []; params?: {} }
    'api.email_verification_requests.store': { paramsTuple?: []; params?: {} }
    'api.email_verifications.show': { paramsTuple?: []; params?: {} }
    'api.email_verifications.update': { paramsTuple?: []; params?: {} }
    'api.session.destroy': { paramsTuple?: []; params?: {} }
    'api.invitations.store': { paramsTuple?: []; params?: {} }
    'api.invitation_deliveries.store': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invitation_acceptances.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission_requests.store': { paramsTuple?: []; params?: {} }
    'api.admission_approvals.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission_rejections.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission_revocations.store': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.memberships.store': { paramsTuple?: []; params?: {} }
    'api.masquerade.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.ownership_transfers.store': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
  }
  PUT: {
    'api.getting_started.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.member_sign_in_tracking.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.member_resource_links.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
  }
  PATCH: {
    'api.members.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.member_status.update': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
  }
  DELETE: {
    'api.invitations.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.member_resource_links.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.masquerade.destroy': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}