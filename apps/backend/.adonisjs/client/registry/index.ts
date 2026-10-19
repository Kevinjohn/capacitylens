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
  'api.import': {
    methods: ["POST"],
    pattern: '/api/import',
    tokens: [{"old":"/api/import","type":0,"val":"api","end":""},{"old":"/api/import","type":0,"val":"import","end":""}],
    types: placeholder as Registry['api.import']['types'],
  },
  'api.state': {
    methods: ["GET","HEAD"],
    pattern: '/api/state',
    tokens: [{"old":"/api/state","type":0,"val":"api","end":""},{"old":"/api/state","type":0,"val":"state","end":""}],
    types: placeholder as Registry['api.state']['types'],
  },
  'api.orgs.store': {
    methods: ["POST"],
    pattern: '/api/orgs',
    tokens: [{"old":"/api/orgs","type":0,"val":"api","end":""},{"old":"/api/orgs","type":0,"val":"orgs","end":""}],
    types: placeholder as Registry['api.orgs.store']['types'],
  },
  'api.accounts.store': {
    methods: ["POST"],
    pattern: '/api/accounts',
    tokens: [{"old":"/api/accounts","type":0,"val":"api","end":""},{"old":"/api/accounts","type":0,"val":"accounts","end":""}],
    types: placeholder as Registry['api.accounts.store']['types'],
  },
  'api.accounts.update': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:id',
    tokens: [{"old":"/api/accounts/:id","type":0,"val":"api","end":""},{"old":"/api/accounts/:id","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['api.accounts.update']['types'],
  },
  'api.accounts.destroy': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:id',
    tokens: [{"old":"/api/accounts/:id","type":0,"val":"api","end":""},{"old":"/api/accounts/:id","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['api.accounts.destroy']['types'],
  },
  'api.example-data': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/example-data',
    tokens: [{"old":"/api/accounts/:accountId/example-data","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/example-data","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/example-data","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/example-data","type":0,"val":"example-data","end":""}],
    types: placeholder as Registry['api.example-data']['types'],
  },
  'api.getting-started.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/getting-started',
    tokens: [{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/getting-started","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"getting-started","end":""}],
    types: placeholder as Registry['api.getting-started.show']['types'],
  },
  'api.getting-started.update': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/getting-started',
    tokens: [{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/getting-started","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/getting-started","type":0,"val":"getting-started","end":""}],
    types: placeholder as Registry['api.getting-started.update']['types'],
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
