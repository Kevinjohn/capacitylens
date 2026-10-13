/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'api.batch': {
    methods: ["POST"],
    pattern: '/api/batch',
    tokens: [{"old":"/api/batch","type":0,"val":"api","end":""},{"old":"/api/batch","type":0,"val":"batch","end":""}],
    types: placeholder as Registry['api.batch']['types'],
  },
  'api.lifecycle': {
    methods: ["POST"],
    pattern: '/api/:entity/:id/:action',
    tokens: [{"old":"/api/:entity/:id/:action","type":0,"val":"api","end":""},{"old":"/api/:entity/:id/:action","type":1,"val":"entity","end":""},{"old":"/api/:entity/:id/:action","type":1,"val":"id","end":""},{"old":"/api/:entity/:id/:action","type":1,"val":"action","end":""}],
    types: placeholder as Registry['api.lifecycle']['types'],
  },
  'api.health': {
    methods: ["GET","HEAD"],
    pattern: '/api/health',
    tokens: [{"old":"/api/health","type":0,"val":"api","end":""},{"old":"/api/health","type":0,"val":"health","end":""}],
    types: placeholder as Registry['api.health']['types'],
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
