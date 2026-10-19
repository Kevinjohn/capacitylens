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
}
