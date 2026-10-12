import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'api.health': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'api.health': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'api.health': { paramsTuple?: []; params?: {} }
  }
  POST: {
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}