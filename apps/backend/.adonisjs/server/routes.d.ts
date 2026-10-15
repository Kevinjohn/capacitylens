import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'api.batch': { paramsTuple?: []; params?: {} }
    'api.import': { paramsTuple?: []; params?: {} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.orgs.store': { paramsTuple?: []; params?: {} }
    'api.accounts.store': { paramsTuple?: []; params?: {} }
    'api.accounts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.accounts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.example-data': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.getting-started.update': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.provider-start': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'api.batch': { paramsTuple?: []; params?: {} }
    'api.import': { paramsTuple?: []; params?: {} }
    'api.orgs.store': { paramsTuple?: []; params?: {} }
    'api.accounts.store': { paramsTuple?: []; params?: {} }
    'api.example-data': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.provider-start': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'api.state': { paramsTuple?: []; params?: {} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'api.state': { paramsTuple?: []; params?: {} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'api.accounts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'api.accounts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'api.getting-started.update': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}