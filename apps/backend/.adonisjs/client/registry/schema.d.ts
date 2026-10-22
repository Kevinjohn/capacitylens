/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'api.planning.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/planning'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['show']>>>
    }
  }
  'api.planning.lookup': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/planning/mutations/:mutationId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; mutationId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['lookup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['lookup']>>>
    }
  }
  'api.planning.allocation.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationCreate']>>>
    }
  }
  'api.planning.allocation.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/allocations/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationUpdate']>>>
    }
  }
  'api.planning.allocation.createGroup': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations/create-group'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationCreateGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationCreateGroup']>>>
    }
  }
  'api.planning.allocation.delete': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations/:id/delete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDelete']>>>
    }
  }
  'api.planning.allocation.deleteGroup': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations/delete-group'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDeleteGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDeleteGroup']>>>
    }
  }
  'api.planning.restoreGroup': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/planning/restore-group'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').planningMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['restoreGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['restoreGroup']>>>
    }
  }
  'api.planning.resource.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/resources'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceCreate']>>>
    }
  }
  'api.planning.resource.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/resources/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceUpdate']>>>
    }
  }
  'api.planning.timeOff.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/time-off'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffCreate']>>>
    }
  }
  'api.planning.timeOff.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/time-off/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffUpdate']>>>
    }
  }
  'api.planning.timeOff.delete': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/time-off/:id/delete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffDelete']>>>
    }
  }
  'api.planning.timeOff.deleteGroup': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/time-off/delete-group'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffDeleteGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffDeleteGroup']>>>
    }
  }
  'api.planning.closure.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/closures'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureCreate']>>>
    }
  }
  'api.planning.closure.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/closures/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureUpdate']>>>
    }
  }
  'api.planning.closure.delete': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/closures/:id/delete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').closureMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['closureDelete']>>>
    }
  }
  'api.planning.client.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/clients'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientCreate']>>>
    }
  }
  'api.planning.client.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/clients/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientUpdate']>>>
    }
  }
  'api.planning.client.archive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/clients/:id/archive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientArchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientArchive']>>>
    }
  }
  'api.planning.client.unarchive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/clients/:id/unarchive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientUnarchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['clientUnarchive']>>>
    }
  }
  'api.planning.project.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/projects'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectCreate']>>>
    }
  }
  'api.planning.project.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/projects/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectUpdate']>>>
    }
  }
  'api.planning.project.archive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/projects/:id/archive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectArchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectArchive']>>>
    }
  }
  'api.planning.project.unarchive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/projects/:id/unarchive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectUnarchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['projectUnarchive']>>>
    }
  }
  'api.planning.activity.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/activities'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityCreate']>>>
    }
  }
  'api.planning.activity.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/activities/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityUpdate']>>>
    }
  }
  'api.planning.activity.archive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/activities/:id/archive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityArchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityArchive']>>>
    }
  }
  'api.planning.activity.unarchive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/activities/:id/unarchive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityUnarchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['activityUnarchive']>>>
    }
  }
  'api.planning.phase.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/phases'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseCreate']>>>
    }
  }
  'api.planning.phase.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/phases/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseUpdate']>>>
    }
  }
  'api.planning.phase.delete': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/phases/:id/delete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['phaseDelete']>>>
    }
  }
  'api.planning.discipline.create': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/disciplines'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineCreate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineCreate']>>>
    }
  }
  'api.planning.discipline.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/disciplines/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineUpdate']>>>
    }
  }
  'api.planning.discipline.delete': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/disciplines/:id/delete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').catalogueMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineDelete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['disciplineDelete']>>>
    }
  }
  'api.planning.resource.archive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/resources/:id/archive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceArchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceArchive']>>>
    }
  }
  'api.planning.resource.unarchive': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/resources/:id/unarchive'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').resourceMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceUnarchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['resourceUnarchive']>>>
    }
  }
  'api.planning.allocation.duplicate': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations/:id/duplicate'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDuplicate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationDuplicate']>>>
    }
  }
  'api.planning.allocation.repeat': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/allocations/:id/repeat'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').allocationMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationRepeat']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['allocationRepeat']>>>
    }
  }
  'api.planning.timeOff.repeat': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/time-off/repeat'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').timeOffMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffRepeat']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['timeOffRepeat']>>>
    }
  }
  'api.planning.settings.update': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/settings'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/planning_operations').settingsMutationValidator)>>
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/planning_operations').settingsMutationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['settingsUpdate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/planning_controller').default['settingsUpdate']>>>
    }
  }
  'api.batch': {
    methods: ["POST"]
    pattern: '/api/batch'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/batch').batchValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/batch').batchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/batch_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/batch_controller').default['store']>>>
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
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['providerStart']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['providerStart']>>>
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
  'api.members.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/members'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
    }
  }
  'api.members.tracking': {
    methods: ["PUT"]
    pattern: '/api/accounts/:accountId/member-sign-in-tracking'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['tracking']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['tracking']>>>
    }
  }
  'api.members.role': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/members/:userId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeRole']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeRole']>>>
    }
  }
  'api.members.status': {
    methods: ["PATCH"]
    pattern: '/api/accounts/:accountId/members/:userId/status'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeStatus']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['changeStatus']>>>
    }
  }
  'api.members.enable-access': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/members/:userId/enable-access'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['enableAccess']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['enableAccess']>>>
    }
  }
  'api.members.remove': {
    methods: ["DELETE"]
    pattern: '/api/accounts/:accountId/members/:userId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['remove']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['remove']>>>
    }
  }
  'api.members.reset-password': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/members/:userId/reset-password'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['resetPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['resetPassword']>>>
    }
  }
  'api.members.revoke-sessions': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/members/:userId/revoke-sessions'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; userId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['revokeSessions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['revokeSessions']>>>
    }
  }
  'api.invites.create': {
    methods: ["POST"]
    pattern: '/api/invites'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['create']>>>
    }
  }
  'api.invites.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/invites'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['index']>>>
    }
  }
  'api.invites.revoke': {
    methods: ["DELETE"]
    pattern: '/api/accounts/:accountId/invites/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['revoke']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['revoke']>>>
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
    }
  }
  'api.invites.accept': {
    methods: ["POST"]
    pattern: '/api/invites/:token/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>>
    }
  }
  'api.invites.sign-up': {
    methods: ["POST"]
    pattern: '/api/invites/:token/signup'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['signUp']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['signUp']>>>
    }
  }
  'api.joining.policy': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/joining-policy'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['policy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['policy']>>>
    }
  }
  'api.joining.update-policy': {
    methods: ["PUT"]
    pattern: '/api/accounts/:accountId/joining-policy'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['updatePolicy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['updatePolicy']>>>
    }
  }
  'api.joining.metadata': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/join/metadata'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['metadata']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['metadata']>>>
    }
  }
  'api.joining.status': {
    methods: ["GET","HEAD"]
    pattern: '/api/company-join/status'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinStatus']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinStatus']>>>
    }
  }
  'api.joining.complete-existing': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/join/complete-existing'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['completeExisting']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['completeExisting']>>>
    }
  }
  'api.joining.request-proof': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/join/verify-email'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['requestProof']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['requestProof']>>>
    }
  }
  'api.joining.verify-email': {
    methods: ["POST"]
    pattern: '/api/company-join/verify-email'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['verifyEmail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/joining_controller').default['verifyEmail']>>>
    }
  }
  'api.member-resources.set': {
    methods: ["PUT"]
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; principalId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['setLink']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['setLink']>>>
    }
  }
  'api.member-resources.clear': {
    methods: ["DELETE"]
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; principalId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearLink']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearLink']>>>
    }
  }
  'api.member-resources.clear-exception': {
    methods: ["DELETE"]
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link-exception'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { accountId: ParamValue; principalId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearException']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['clearException']>>>
    }
  }
  'api.member-resources.avatars': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts/:accountId/resource-avatars'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['avatars']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/member_resources_controller').default['avatars']>>>
    }
  }
  'api.masquerade.start': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/masquerade'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['start']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['start']>>>
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
    }
  }
  'api.masquerade.end': {
    methods: ["DELETE"]
    pattern: '/api/masquerade'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['end']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/masquerade_controller').default['end']>>>
    }
  }
  'api.ownership.transfer': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/ownership-transfer'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/ownership_controller').default['transfer']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/ownership_controller').default['transfer']>>>
    }
  }
  'api.google.callback': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/callback/google'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['callback']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['callback']>>>
    }
  }
  'api.google.link': {
    methods: ["POST"]
    pattern: '/api/identity/link-provider'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['linkStart']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['linkStart']>>>
    }
  }
  'api.google.identity': {
    methods: ["GET","HEAD"]
    pattern: '/api/identity/provider'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['providerInfo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['providerInfo']>>>
    }
  }
  'api.google.join-start': {
    methods: ["POST"]
    pattern: '/api/accounts/:accountId/join/provider/start'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { accountId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinStart']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinStart']>>>
    }
  }
  'api.google.join-cancel': {
    methods: ["POST"]
    pattern: '/api/company-join/cancel'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinCancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinCancel']>>>
    }
  }
  'api.google.join-complete': {
    methods: ["POST"]
    pattern: '/api/company-join/complete-provider'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinComplete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_controller').default['joinComplete']>>>
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
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/lifecycle_controller').default['mutate']>>>
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
  'api.accounts.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/accounts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/companies_controller').default['index']>>>
    }
  }
}
