/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'api.batch': {
    methods: ["POST"]
    pattern: '/api/batch'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/batch').batchValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/batch').batchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/batch_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/batch_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.import': {
    methods: ["POST"]
    pattern: '/api/import'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
    }
  }
  'api.state': {
    methods: ["GET","HEAD"]
    pattern: '/api/state'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/exports_controller').default['show']>>>
    }
  }
  'api.orgs.store': {
    methods: ["POST"]
    pattern: '/api/orgs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['storeOrg']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['storeOrg']>>>
    }
  }
  'api.accounts.store': {
    methods: ["POST"]
    pattern: '/api/accounts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['store']>>>
    }
  }
  'api.accounts.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['update']>>>
    }
  }
  'api.accounts.destroy': {
    methods: ["DELETE"]
    pattern: '/api/accounts/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['destroy']>>>
    }
  }
  'api.example-data': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/example-data'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/example_data_controller').default['store']>>>
    }
  }
  'api.getting-started.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/getting-started'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['show']>>>
    }
  }
  'api.getting-started.update': {
    methods: ["PUT"]
    pattern: '/api/accounts/:accountId/getting-started'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/getting_started_controller').default['update']>>>
    }
  }
  'api.lifecycle': {
    methods: ["POST"]
    pattern: '/api/:entity/:id/:action'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/lifecycle').lifecycleValidator)>>
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { entity: ParamValue; id: ParamValue; action: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/lifecycle').lifecycleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/lifecycle_controller').default['mutate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/lifecycle_controller').default['mutate']>>> | { status: 422; response: { errors: SimpleError[] } }
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
    }
  }
  'api.auth.sign-up': {
    methods: ["POST"]
    pattern: '/api/auth/sign-up'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signUp']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signUp']>>>
    }
  }
  'api.auth.sign-in': {
    methods: ["POST"]
    pattern: '/api/auth/sign-in'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signIn']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['signIn']>>>
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
    }
  }
  'api.auth.provider-start': {
    methods: ["POST"]
    pattern: '/api/auth/provider-start'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['providerStart']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_controller').default['providerStart']>>>
    }
  }
  'api.auth.request-reset': {
    methods: ["POST"]
    pattern: '/api/auth/request-reset'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['requestReset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['requestReset']>>>
    }
  }
  'api.auth.reset-password': {
    methods: ["POST"]
    pattern: '/api/auth/reset-password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['resetPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['resetPassword']>>>
    }
  }
  'api.auth.change-password': {
    methods: ["POST"]
    pattern: '/api/auth/change-password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['changePassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/credential_controller').default['changePassword']>>>
    }
  }
}
