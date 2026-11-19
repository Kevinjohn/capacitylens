/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractRawResponse, ExtractResponse, Method, PathWithRegistry, PatternsByMethod, RouteWithRegistry } from '@tuyau/core/types'
import type { InferInput } from '@vinejs/vine/types'
import type { routes } from './index.ts'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
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
  'api.planning.archive': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/planning/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['archive']>>>
    }
  }
  'api.planning.mutate': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/mutations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['mutate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['mutate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['mutate']>>>
    }
  }
  'api.planning.undo': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/undo'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['undo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['undo']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['undo']>>>
    }
  }
  'api.planning.redo': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/planning/redo'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningHistoryStepValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['redo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['redo']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['redo']>>>
    }
  }
  'api.installation.company': {
    methods: ["POST"]
    pattern: '/api/installation/company'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/first_company_setup').storeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/first_company_setup').storeValidator)>>
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
  'api.transfer.preview': {
    methods: ["POST"]
    pattern: '/api/transfer/preview'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/transfer').previewValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/transfer').previewValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['preview']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['preview']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['preview']>>>
    }
  }
  'api.transfer.apply': {
    methods: ["POST"]
    pattern: '/api/transfer/apply'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/transfer').applyValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/transfer').applyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['apply']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['apply']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/transfer_controller').default['apply']>>>
    }
  }
  'api.state': {
    methods: ["GET","HEAD"]
    pattern: '/api/state'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/export_query').exportQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['show']>>>
    }
  }
  'api.export': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/export'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['download']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['download']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['download']>>>
    }
  }
  'api.companies.anonymise': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/anonymise'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/anonymise').companyValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/anonymise').companyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['company']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['company']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['company']>>>
    }
  }
  'api.resources.anonymise': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/resources/:id/anonymise'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/anonymise').resourceValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/anonymise').resourceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['resource']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['resource']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/anonymise_controller').default['resource']>>>
    }
  }
  'api.example-data': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/example-data'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
    }
  }
  'api.getting-started.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/getting-started'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
    }
  }
  'api.getting-started.update': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/getting-started'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/getting_started').updateValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/getting_started').updateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
    }
  }
  'api.auth.me': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/me'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['me']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['me']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['me']>>>
    }
  }
  'api.auth.sign-up': {
    methods: ["POST"]
    pattern: '/api/auth/sign-up'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth_requests').signUpValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth_requests').signUpValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signUp']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signUp']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signUp']>>>
    }
  }
  'api.auth.sign-in': {
    methods: ["POST"]
    pattern: '/api/auth/sign-in'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/auth_requests').signInValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/auth_requests').signInValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signIn']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signIn']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signIn']>>>
    }
  }
  'api.auth.sign-out': {
    methods: ["POST"]
    pattern: '/api/auth/sign-out'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signOut']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signOut']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signOut']>>>
    }
  }
  'api.auth.password-confirmation': {
    methods: ["POST"]
    pattern: '/api/auth/password-confirmation'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/password_confirmations').passwordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/password_confirmations').passwordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['password']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['password']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/password_confirmations_controller').default['password']>>>
    }
  }
  'api.auth.request-reset': {
    methods: ["POST"]
    pattern: '/api/auth/request-reset'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').requestResetValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').requestResetValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['requestReset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['requestReset']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['requestReset']>>>
    }
  }
  'api.auth.inspect-reset': {
    methods: ["POST"]
    pattern: '/api/auth/inspect-reset'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').inspectResetValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').inspectResetValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['inspectReset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['inspectReset']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['inspectReset']>>>
    }
  }
  'api.auth.reset-password': {
    methods: ["POST"]
    pattern: '/api/auth/reset-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').resetPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').resetPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['resetPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['resetPassword']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['resetPassword']>>>
    }
  }
  'api.auth.change-password': {
    methods: ["POST"]
    pattern: '/api/auth/change-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').changePasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').changePasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['changePassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['changePassword']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['changePassword']>>>
    }
  }
  'api.auth.delete-account': {
    methods: ["POST"]
    pattern: '/api/auth/delete-account'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/credentials').deleteAccountValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/credentials').deleteAccountValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['deleteAccount']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['deleteAccount']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['deleteAccount']>>>
    }
  }
  'api.auth.verification.send': {
    methods: ["POST"]
    pattern: '/api/auth/verification/send'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['send']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['send']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['send']>>>
    }
  }
  'api.auth.verification.inspect': {
    methods: ["POST"]
    pattern: '/api/auth/verification/inspect'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/verification').inspectValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/verification').inspectValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['inspect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['inspect']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['inspect']>>>
    }
  }
  'api.auth.verification.complete': {
    methods: ["POST"]
    pattern: '/api/auth/verification/complete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/verification').completeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/verification').completeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['complete']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/verification_controller').default['complete']>>>
    }
  }
  'api.members.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/members'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
    }
  }
  'api.members.tracking': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/member-sign-in-tracking'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').trackingValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').trackingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['tracking']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['tracking']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['tracking']>>>
    }
  }
  'api.members.role': {
    methods: ["PATCH"]
    pattern: '/api/companies/:companyId/members/:userId'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').changeRoleValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').changeRoleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeRole']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeRole']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeRole']>>>
    }
  }
  'api.members.status': {
    methods: ["PATCH"]
    pattern: '/api/companies/:companyId/members/:userId/status'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/members').changeStatusValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/members').changeStatusValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeStatus']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeStatus']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeStatus']>>>
    }
  }
  'api.invites.create': {
    methods: ["POST"]
    pattern: '/api/invites'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').createValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').createValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['create']>>>
    }
  }
  'api.invites.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/companies/:companyId/invites'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
    }
  }
  'api.invites.resend': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/invites/:id/resend'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['resend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['resend']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['resend']>>>
    }
  }
  'api.invites.revoke': {
    methods: ["DELETE"]
    pattern: '/api/companies/:companyId/invites/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['revoke']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['revoke']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['revoke']>>>
    }
  }
  'api.invites.preview': {
    methods: ["GET","HEAD"]
    pattern: '/api/invites/:token/preview'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['preview']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['preview']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['preview']>>>
    }
  }
  'api.invites.sign-up': {
    methods: ["POST"]
    pattern: '/api/invites/:token/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invitations').signUpValidator)>>
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invitations').signUpValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['signUp']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['signUp']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['signUp']>>>
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
  'api.admission.request': {
    methods: ["POST"]
    pattern: '/api/admission/request'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['request']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['request']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['request']>>>
    }
  }
  'api.admission.complete': {
    methods: ["POST"]
    pattern: '/api/admission/complete'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['complete']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['complete']>>>
    }
  }
  'api.admission.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/admission/requests'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/admission_query').admissionQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['index']>>>
    }
  }
  'api.admission.approve': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['approve']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['approve']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['approve']>>>
    }
  }
  'api.admission.reject': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['reject']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['reject']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['reject']>>>
    }
  }
  'api.admission.revoke': {
    methods: ["POST"]
    pattern: '/api/admission/:userId/revoke'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['revoke']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['revoke']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admission_controller').default['revoke']>>>
    }
  }
  'api.member-resources.set': {
    methods: ["PUT"]
    pattern: '/api/companies/:companyId/members/:userId/resource-link'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/member_resources').setLinkValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/member_resources').setLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['setLink']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['setLink']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['setLink']>>>
    }
  }
  'api.member-resources.clear': {
    methods: ["DELETE"]
    pattern: '/api/companies/:companyId/members/:userId/resource-link'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/member_resources').clearLinkValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { companyId: ParamValue; userId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/member_resources').clearLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearLink']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearLink']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearLink']>>>
    }
  }
  'api.masquerade.start': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/masquerade'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/masquerade').startValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/masquerade').startValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['start']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['start']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['start']>>>
    }
  }
  'api.masquerade.status': {
    methods: ["GET","HEAD"]
    pattern: '/api/masquerade'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['status']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['status']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['status']>>>
    }
  }
  'api.masquerade.end': {
    methods: ["DELETE"]
    pattern: '/api/masquerade'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/masquerade').endValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/masquerade').endValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['end']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['end']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['end']>>>
    }
  }
  'api.ownership.transfer': {
    methods: ["POST"]
    pattern: '/api/companies/:companyId/ownership-transfer'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/ownership').transferValidator)>>
      paramsTuple: [ParamValue]
      params: { companyId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/ownership').transferValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/ownership_controller').default['transfer']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/ownership_controller').default['transfer']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/ownership_controller').default['transfer']>>>
    }
  }
  'api.health': {
    methods: ["GET","HEAD"]
    pattern: '/api/health'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
      rawResponse: ExtractRawResponse<unknown>
    }
  }
  'api.diagnostics': {
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
  'api.not-found': {
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
