/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractRawResponse, ExtractResponse, Method, PathWithRegistry, PatternsByMethod, RouteWithRegistry } from '@tuyau/core/types'
import type { InferInput } from '@vinejs/vine/types'
import type { routes } from './index.ts'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'api.liveness': {
    methods: ["GET","HEAD"]
    pattern: '/api/health'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
    }
  }
  'api.planning.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/planning'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/planning/read').planningReadValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['show']>>>
    }
  }
  'api.planning_archive.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/planning/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/planning/read').planningArchiveValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_archive_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_archive_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_archive_controller').default['show']>>>
    }
  }
  'api.planning_mutations.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/mutations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_mutations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_mutations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_mutations_controller').default['store']>>>
    }
  }
  'api.planning_undo.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/undo'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_undo_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_undo_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_undo_controller').default['store']>>>
    }
  }
  'api.planning_redo.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/redo'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_redo_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_redo_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_redo_controller').default['store']>>>
    }
  }
  'api.first_company_setup.store': {
    methods: ["POST"]
    pattern: '/api/installation/company'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/first_company_setup').createFirstCompanyValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/first_company_setup').createFirstCompanyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/first_company_setup_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/first_company_setup_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/first_company_setup_controller').default['store']>>>
    }
  }
  'api.companies.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['index']>>>
    }
  }
  'api.import_previews.store': {
    methods: ["POST"]
    pattern: '/api/import/preview'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/import').previewImportValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/import').previewImportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/import_previews_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/import_previews_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/import_previews_controller').default['store']>>>
    }
  }
  'api.imports.store': {
    methods: ["POST"]
    pattern: '/api/import/apply'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/import').applyImportValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/import').applyImportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
    }
  }
  'api.company_state.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/state'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/export_query').exportQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_state_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_state_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_state_controller').default['show']>>>
    }
  }
  'api.company_exports.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/export'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/export_query').showCompanyExportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_exports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_exports_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_exports_controller').default['show']>>>
    }
  }
  'api.company_anonymisations.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/anonymise'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/anonymise').anonymiseCompanyValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/anonymise').anonymiseCompanyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_anonymisations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_anonymisations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_anonymisations_controller').default['store']>>>
    }
  }
  'api.resource_anonymisations.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/resources/:id/anonymise'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/anonymise').anonymiseResourceValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/anonymise').anonymiseResourceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resource_anonymisations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resource_anonymisations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/resource_anonymisations_controller').default['store']>>>
    }
  }
  'api.example_data.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/example-data'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/example_data').createExampleDataValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/example_data').createExampleDataValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
    }
  }
  'api.getting_started.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/getting-started'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/getting_started').showGettingStartedValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
    }
  }
  'api.getting_started.update': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/getting-started'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/getting_started').updateGettingStartedValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/getting_started').updateGettingStartedValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
    }
  }
  'api.session.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/me'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['show']>>>
    }
  }
  'api.new_account.store': {
    methods: ["POST"]
    pattern: '/api/auth/sign-up'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth_requests').signUpValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth_requests').signUpValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
    }
  }
  'api.session.store': {
    methods: ["POST"]
    pattern: '/api/auth/sign-in'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth_requests').signInValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth_requests').signInValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
    }
  }
  'api.session.destroy': {
    methods: ["POST"]
    pattern: '/api/auth/sign-out'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'api.password_confirmations.store': {
    methods: ["POST"]
    pattern: '/api/auth/password-confirmation'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/password_confirmations').confirmPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/password_confirmations').confirmPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['store']>>>
    }
  }
  'api.password_reset_requests.store': {
    methods: ["POST"]
    pattern: '/api/auth/request-reset'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').requestResetValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').requestResetValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_requests_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_requests_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_reset_requests_controller').default['store']>>>
    }
  }
  'api.password_resets.show': {
    methods: ["POST"]
    pattern: '/api/auth/inspect-reset'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').inspectResetValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').inspectResetValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['show']>>>
    }
  }
  'api.password_resets.update': {
    methods: ["POST"]
    pattern: '/api/auth/reset-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').resetPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').resetPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['update']>>>
    }
  }
  'api.password.update': {
    methods: ["POST"]
    pattern: '/api/auth/change-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').changePasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').changePasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_controller').default['update']>>>
    }
  }
  'api.account.destroy': {
    methods: ["POST"]
    pattern: '/api/auth/delete-account'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').deleteAccountValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').deleteAccountValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/account_controller').default['destroy']>>>
    }
  }
  'api.email_verification_requests.store': {
    methods: ["POST"]
    pattern: '/api/auth/verification/send'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_requests_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_requests_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/email_verification_requests_controller').default['store']>>>
    }
  }
  'api.email_verifications.show': {
    methods: ["POST"]
    pattern: '/api/auth/verification/inspect'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/verification').inspectVerificationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/verification').inspectVerificationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['show']>>>
    }
  }
  'api.email_verifications.update': {
    methods: ["POST"]
    pattern: '/api/auth/verification/complete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/verification').completeVerificationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/verification').completeVerificationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/email_verifications_controller').default['update']>>>
    }
  }
  'api.members.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/members'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/members').listMembersValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
    }
  }
  'api.member_sign_in_tracking.update': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/member-sign-in-tracking'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').updateMemberTrackingValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').updateMemberTrackingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_sign_in_tracking_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_sign_in_tracking_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_sign_in_tracking_controller').default['update']>>>
    }
  }
  'api.members.update': {
    methods: ["PATCH"]
    pattern: '/api/companies/:companyId/members/:userId'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').changeRoleValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').changeRoleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['update']>>>
    }
  }
  'api.member_status.update': {
    methods: ["PATCH"]
    pattern: '/api/companies/:companyId/members/:userId/status'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').changeStatusValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').changeStatusValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_status_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_status_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_status_controller').default['update']>>>
    }
  }
  'api.invitations.store': {
    methods: ["POST"]
    pattern: '/api/invitations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').createInvitationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').createInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['store']>>>
    }
  }
  'api.invitations.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/invitations'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/invitations').listInvitationsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
    }
  }
  'api.invitation_deliveries.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/invitations/:id/resend'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').resendInvitationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').resendInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitation_deliveries_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitation_deliveries_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitation_deliveries_controller').default['store']>>>
    }
  }
  'api.invitations.destroy': {
    methods: ["DELETE"]
    pattern: '/api/companies/:companyId/invitations/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').revokeInvitationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').revokeInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['destroy']>>>
    }
  }
  'api.invitation_links.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/invitations/:token/preview'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/invitations').showInvitationLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitation_links_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitation_links_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitation_links_controller').default['show']>>>
    }
  }
  'api.invitation_acceptances.store': {
    methods: ["POST"]
    pattern: '/api/invitations/:token/sign-up'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').acceptInvitationSignUpValidator)>>
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').acceptInvitationSignUpValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitation_acceptances_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitation_acceptances_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitation_acceptances_controller').default['store']>>>
    }
  }
  'api.admission.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/admission'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['show']>>>
    }
  }
  'api.admission_requests.store': {
    methods: ["POST"]
    pattern: '/api/admission/request'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['store']>>>
    }
  }
  'api.memberships.store': {
    methods: ["POST"]
    pattern: '/api/admission/complete'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/memberships_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/memberships_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/memberships_controller').default['store']>>>
    }
  }
  'api.admission_requests.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/admission/requests'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/admission_query').admissionQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_requests_controller').default['index']>>>
    }
  }
  'api.admission_approvals.store': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/approve'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_approvals_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_approvals_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_approvals_controller').default['store']>>>
    }
  }
  'api.admission_rejections.store': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/reject'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_rejections_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_rejections_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_rejections_controller').default['store']>>>
    }
  }
  'api.admission_revocations.store': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/revoke'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/admission_query').decideAdmissionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_revocations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_revocations_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_revocations_controller').default['store']>>>
    }
  }
  'api.member_resource_links.update': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/members/:userId/resource-link'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/member_resources').setLinkValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/member_resources').setLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['update']>>>
    }
  }
  'api.member_resource_links.destroy': {
    methods: ["DELETE"]
    pattern: '/api/companies/:companyId/members/:userId/resource-link'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/member_resources').clearLinkValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/member_resources').clearLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_resource_links_controller').default['destroy']>>>
    }
  }
  'api.masquerade.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/masquerade'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/masquerade').startMasqueradeValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/masquerade').startMasqueradeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['store']>>>
    }
  }
  'api.masquerade.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/masquerade'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['show']>>>
    }
  }
  'api.masquerade.destroy': {
    methods: ["DELETE"]
    pattern: '/api/masquerade'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/masquerade').endMasqueradeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/masquerade').endMasqueradeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['destroy']>>>
    }
  }
  'api.ownership_transfers.store': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/ownership-transfer'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/ownership').transferOwnershipValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/ownership').transferOwnershipValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/ownership_transfers_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/ownership_transfers_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/ownership_transfers_controller').default['store']>>>
    }
  }
  'api.diagnostics.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/diagnostics'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/diagnostics_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/diagnostics_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/diagnostics_controller').default['show']>>>
    }
  }
  'api.not_found': {
    methods: ["GET","HEAD"]
    pattern: '/api/*'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { '*': ParamValue[] }
      query: {}
      response: unknown
      errorResponse: unknown
      rawResponse: ExtractRawResponse<unknown>
    }
  }
  'liveness': {
    methods: ["GET","HEAD"]
    pattern: '/health/live'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/liveness_controller').default['handle']>>>
    }
  }
  'health_checks': {
    methods: ["GET","HEAD"]
    pattern: '/health/ready'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/health_checks_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/health_checks_controller').default['handle']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/health_checks_controller').default['handle']>>>
    }
  }
}

export namespace Route {
  export type Request<Name extends keyof typeof routes> = RouteWithRegistry.Request<typeof routes, Name>
  export type Response<Name extends keyof typeof routes> = RouteWithRegistry.Response<typeof routes, Name>
  export type Params<Name extends keyof typeof routes> = RouteWithRegistry.Params<typeof routes, Name>
  export type Body<Name extends keyof typeof routes> = RouteWithRegistry.Body<typeof routes, Name>
  export type Query<Name extends keyof typeof routes> = RouteWithRegistry.Query<typeof routes, Name>
  export type Error<Name extends keyof typeof routes> = RouteWithRegistry.Error<typeof routes, Name>
}

export namespace Path {
  export type Request<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Request<typeof routes, M, P>
  export type Response<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Response<typeof routes, M, P>
  export type Params<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Params<typeof routes, M, P>
  export type Body<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Body<typeof routes, M, P>
  export type Query<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Query<typeof routes, M, P>
  export type Error<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Error<typeof routes, M, P>
}
