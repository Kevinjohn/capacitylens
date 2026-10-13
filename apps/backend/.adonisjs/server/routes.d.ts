import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'api.batch': { paramsTuple?: []; params?: {} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'api.batch': { paramsTuple?: []; params?: {} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
  }
  GET: {
    'api.health': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'api.health': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}