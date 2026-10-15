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
  'api.auth.me': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/me',
    tokens: [{"old":"/api/auth/me","type":0,"val":"api","end":""},{"old":"/api/auth/me","type":0,"val":"auth","end":""},{"old":"/api/auth/me","type":0,"val":"me","end":""}],
    types: placeholder as Registry['api.auth.me']['types'],
  },
  'api.auth.sign-up': {
    methods: ["POST"],
    pattern: '/api/auth/sign-up',
    tokens: [{"old":"/api/auth/sign-up","type":0,"val":"api","end":""},{"old":"/api/auth/sign-up","type":0,"val":"auth","end":""},{"old":"/api/auth/sign-up","type":0,"val":"sign-up","end":""}],
    types: placeholder as Registry['api.auth.sign-up']['types'],
  },
  'api.auth.sign-in': {
    methods: ["POST"],
    pattern: '/api/auth/sign-in',
    tokens: [{"old":"/api/auth/sign-in","type":0,"val":"api","end":""},{"old":"/api/auth/sign-in","type":0,"val":"auth","end":""},{"old":"/api/auth/sign-in","type":0,"val":"sign-in","end":""}],
    types: placeholder as Registry['api.auth.sign-in']['types'],
  },
  'api.auth.sign-out': {
    methods: ["POST"],
    pattern: '/api/auth/sign-out',
    tokens: [{"old":"/api/auth/sign-out","type":0,"val":"api","end":""},{"old":"/api/auth/sign-out","type":0,"val":"auth","end":""},{"old":"/api/auth/sign-out","type":0,"val":"sign-out","end":""}],
    types: placeholder as Registry['api.auth.sign-out']['types'],
  },
  'api.auth.provider-start': {
    methods: ["POST"],
    pattern: '/api/auth/provider-start',
    tokens: [{"old":"/api/auth/provider-start","type":0,"val":"api","end":""},{"old":"/api/auth/provider-start","type":0,"val":"auth","end":""},{"old":"/api/auth/provider-start","type":0,"val":"provider-start","end":""}],
    types: placeholder as Registry['api.auth.provider-start']['types'],
  },
  'api.auth.request-reset': {
    methods: ["POST"],
    pattern: '/api/auth/request-reset',
    tokens: [{"old":"/api/auth/request-reset","type":0,"val":"api","end":""},{"old":"/api/auth/request-reset","type":0,"val":"auth","end":""},{"old":"/api/auth/request-reset","type":0,"val":"request-reset","end":""}],
    types: placeholder as Registry['api.auth.request-reset']['types'],
  },
  'api.auth.reset-password': {
    methods: ["POST"],
    pattern: '/api/auth/reset-password',
    tokens: [{"old":"/api/auth/reset-password","type":0,"val":"api","end":""},{"old":"/api/auth/reset-password","type":0,"val":"auth","end":""},{"old":"/api/auth/reset-password","type":0,"val":"reset-password","end":""}],
    types: placeholder as Registry['api.auth.reset-password']['types'],
  },
  'api.auth.change-password': {
    methods: ["POST"],
    pattern: '/api/auth/change-password',
    tokens: [{"old":"/api/auth/change-password","type":0,"val":"api","end":""},{"old":"/api/auth/change-password","type":0,"val":"auth","end":""},{"old":"/api/auth/change-password","type":0,"val":"change-password","end":""}],
    types: placeholder as Registry['api.auth.change-password']['types'],
  },
  'api.members.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/members',
    tokens: [{"old":"/api/accounts/:accountId/members","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members","type":0,"val":"members","end":""}],
    types: placeholder as Registry['api.members.index']['types'],
  },
  'api.members.tracking': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/member-sign-in-tracking',
    tokens: [{"old":"/api/accounts/:accountId/member-sign-in-tracking","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/member-sign-in-tracking","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/member-sign-in-tracking","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/member-sign-in-tracking","type":0,"val":"member-sign-in-tracking","end":""}],
    types: placeholder as Registry['api.members.tracking']['types'],
  },
  'api.members.role': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/members/:userId',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":1,"val":"userId","end":""}],
    types: placeholder as Registry['api.members.role']['types'],
  },
  'api.members.status': {
    methods: ["PATCH"],
    pattern: '/api/accounts/:accountId/members/:userId/status',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId/status","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId/status","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId/status","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId/status","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId/status","type":1,"val":"userId","end":""},{"old":"/api/accounts/:accountId/members/:userId/status","type":0,"val":"status","end":""}],
    types: placeholder as Registry['api.members.status']['types'],
  },
  'api.members.enable-access': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/members/:userId/enable-access',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":1,"val":"userId","end":""},{"old":"/api/accounts/:accountId/members/:userId/enable-access","type":0,"val":"enable-access","end":""}],
    types: placeholder as Registry['api.members.enable-access']['types'],
  },
  'api.members.remove': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/members/:userId',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId","type":1,"val":"userId","end":""}],
    types: placeholder as Registry['api.members.remove']['types'],
  },
  'api.members.reset-password': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/members/:userId/reset-password',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":1,"val":"userId","end":""},{"old":"/api/accounts/:accountId/members/:userId/reset-password","type":0,"val":"reset-password","end":""}],
    types: placeholder as Registry['api.members.reset-password']['types'],
  },
  'api.members.revoke-sessions': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/members/:userId/revoke-sessions',
    tokens: [{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":1,"val":"userId","end":""},{"old":"/api/accounts/:accountId/members/:userId/revoke-sessions","type":0,"val":"revoke-sessions","end":""}],
    types: placeholder as Registry['api.members.revoke-sessions']['types'],
  },
  'api.invites.create': {
    methods: ["POST"],
    pattern: '/api/invites',
    tokens: [{"old":"/api/invites","type":0,"val":"api","end":""},{"old":"/api/invites","type":0,"val":"invites","end":""}],
    types: placeholder as Registry['api.invites.create']['types'],
  },
  'api.invites.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/invites',
    tokens: [{"old":"/api/accounts/:accountId/invites","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/invites","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/invites","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/invites","type":0,"val":"invites","end":""}],
    types: placeholder as Registry['api.invites.index']['types'],
  },
  'api.invites.revoke': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/invites/:id',
    tokens: [{"old":"/api/accounts/:accountId/invites/:id","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/invites/:id","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/invites/:id","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/invites/:id","type":0,"val":"invites","end":""},{"old":"/api/accounts/:accountId/invites/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['api.invites.revoke']['types'],
  },
  'api.invites.preview': {
    methods: ["GET","HEAD"],
    pattern: '/api/invites/:token/preview',
    tokens: [{"old":"/api/invites/:token/preview","type":0,"val":"api","end":""},{"old":"/api/invites/:token/preview","type":0,"val":"invites","end":""},{"old":"/api/invites/:token/preview","type":1,"val":"token","end":""},{"old":"/api/invites/:token/preview","type":0,"val":"preview","end":""}],
    types: placeholder as Registry['api.invites.preview']['types'],
  },
  'api.invites.accept': {
    methods: ["POST"],
    pattern: '/api/invites/:token/accept',
    tokens: [{"old":"/api/invites/:token/accept","type":0,"val":"api","end":""},{"old":"/api/invites/:token/accept","type":0,"val":"invites","end":""},{"old":"/api/invites/:token/accept","type":1,"val":"token","end":""},{"old":"/api/invites/:token/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['api.invites.accept']['types'],
  },
  'api.invites.sign-up': {
    methods: ["POST"],
    pattern: '/api/invites/:token/signup',
    tokens: [{"old":"/api/invites/:token/signup","type":0,"val":"api","end":""},{"old":"/api/invites/:token/signup","type":0,"val":"invites","end":""},{"old":"/api/invites/:token/signup","type":1,"val":"token","end":""},{"old":"/api/invites/:token/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['api.invites.sign-up']['types'],
  },
  'api.joining.policy': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/joining-policy',
    tokens: [{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"joining-policy","end":""}],
    types: placeholder as Registry['api.joining.policy']['types'],
  },
  'api.joining.update-policy': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/joining-policy',
    tokens: [{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/joining-policy","type":0,"val":"joining-policy","end":""}],
    types: placeholder as Registry['api.joining.update-policy']['types'],
  },
  'api.joining.metadata': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/join/metadata',
    tokens: [{"old":"/api/accounts/:accountId/join/metadata","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/join/metadata","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/join/metadata","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/join/metadata","type":0,"val":"join","end":""},{"old":"/api/accounts/:accountId/join/metadata","type":0,"val":"metadata","end":""}],
    types: placeholder as Registry['api.joining.metadata']['types'],
  },
  'api.joining.status': {
    methods: ["GET","HEAD"],
    pattern: '/api/company-join/status',
    tokens: [{"old":"/api/company-join/status","type":0,"val":"api","end":""},{"old":"/api/company-join/status","type":0,"val":"company-join","end":""},{"old":"/api/company-join/status","type":0,"val":"status","end":""}],
    types: placeholder as Registry['api.joining.status']['types'],
  },
  'api.joining.complete-existing': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/join/complete-existing',
    tokens: [{"old":"/api/accounts/:accountId/join/complete-existing","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/join/complete-existing","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/join/complete-existing","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/join/complete-existing","type":0,"val":"join","end":""},{"old":"/api/accounts/:accountId/join/complete-existing","type":0,"val":"complete-existing","end":""}],
    types: placeholder as Registry['api.joining.complete-existing']['types'],
  },
  'api.joining.request-proof': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/join/verify-email',
    tokens: [{"old":"/api/accounts/:accountId/join/verify-email","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/join/verify-email","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/join/verify-email","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/join/verify-email","type":0,"val":"join","end":""},{"old":"/api/accounts/:accountId/join/verify-email","type":0,"val":"verify-email","end":""}],
    types: placeholder as Registry['api.joining.request-proof']['types'],
  },
  'api.joining.verify-email': {
    methods: ["POST"],
    pattern: '/api/company-join/verify-email',
    tokens: [{"old":"/api/company-join/verify-email","type":0,"val":"api","end":""},{"old":"/api/company-join/verify-email","type":0,"val":"company-join","end":""},{"old":"/api/company-join/verify-email","type":0,"val":"verify-email","end":""}],
    types: placeholder as Registry['api.joining.verify-email']['types'],
  },
  'api.member-resources.set': {
    methods: ["PUT"],
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link',
    tokens: [{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":1,"val":"principalId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"resource-link","end":""}],
    types: placeholder as Registry['api.member-resources.set']['types'],
  },
  'api.member-resources.clear': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link',
    tokens: [{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":1,"val":"principalId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link","type":0,"val":"resource-link","end":""}],
    types: placeholder as Registry['api.member-resources.clear']['types'],
  },
  'api.member-resources.clear-exception': {
    methods: ["DELETE"],
    pattern: '/api/accounts/:accountId/members/:principalId/resource-link-exception',
    tokens: [{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":0,"val":"members","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":1,"val":"principalId","end":""},{"old":"/api/accounts/:accountId/members/:principalId/resource-link-exception","type":0,"val":"resource-link-exception","end":""}],
    types: placeholder as Registry['api.member-resources.clear-exception']['types'],
  },
  'api.member-resources.avatars': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts/:accountId/resource-avatars',
    tokens: [{"old":"/api/accounts/:accountId/resource-avatars","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/resource-avatars","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/resource-avatars","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/resource-avatars","type":0,"val":"resource-avatars","end":""}],
    types: placeholder as Registry['api.member-resources.avatars']['types'],
  },
  'api.masquerade.start': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/masquerade',
    tokens: [{"old":"/api/accounts/:accountId/masquerade","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/masquerade","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/masquerade","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/masquerade","type":0,"val":"masquerade","end":""}],
    types: placeholder as Registry['api.masquerade.start']['types'],
  },
  'api.masquerade.status': {
    methods: ["GET","HEAD"],
    pattern: '/api/masquerade',
    tokens: [{"old":"/api/masquerade","type":0,"val":"api","end":""},{"old":"/api/masquerade","type":0,"val":"masquerade","end":""}],
    types: placeholder as Registry['api.masquerade.status']['types'],
  },
  'api.masquerade.end': {
    methods: ["DELETE"],
    pattern: '/api/masquerade',
    tokens: [{"old":"/api/masquerade","type":0,"val":"api","end":""},{"old":"/api/masquerade","type":0,"val":"masquerade","end":""}],
    types: placeholder as Registry['api.masquerade.end']['types'],
  },
  'api.ownership.transfer': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/ownership-transfer',
    tokens: [{"old":"/api/accounts/:accountId/ownership-transfer","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/ownership-transfer","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/ownership-transfer","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/ownership-transfer","type":0,"val":"ownership-transfer","end":""}],
    types: placeholder as Registry['api.ownership.transfer']['types'],
  },
  'api.google.callback': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/callback/google',
    tokens: [{"old":"/api/auth/callback/google","type":0,"val":"api","end":""},{"old":"/api/auth/callback/google","type":0,"val":"auth","end":""},{"old":"/api/auth/callback/google","type":0,"val":"callback","end":""},{"old":"/api/auth/callback/google","type":0,"val":"google","end":""}],
    types: placeholder as Registry['api.google.callback']['types'],
  },
  'api.google.link': {
    methods: ["POST"],
    pattern: '/api/identity/link-provider',
    tokens: [{"old":"/api/identity/link-provider","type":0,"val":"api","end":""},{"old":"/api/identity/link-provider","type":0,"val":"identity","end":""},{"old":"/api/identity/link-provider","type":0,"val":"link-provider","end":""}],
    types: placeholder as Registry['api.google.link']['types'],
  },
  'api.google.identity': {
    methods: ["GET","HEAD"],
    pattern: '/api/identity/provider',
    tokens: [{"old":"/api/identity/provider","type":0,"val":"api","end":""},{"old":"/api/identity/provider","type":0,"val":"identity","end":""},{"old":"/api/identity/provider","type":0,"val":"provider","end":""}],
    types: placeholder as Registry['api.google.identity']['types'],
  },
  'api.google.join-start': {
    methods: ["POST"],
    pattern: '/api/accounts/:accountId/join/provider/start',
    tokens: [{"old":"/api/accounts/:accountId/join/provider/start","type":0,"val":"api","end":""},{"old":"/api/accounts/:accountId/join/provider/start","type":0,"val":"accounts","end":""},{"old":"/api/accounts/:accountId/join/provider/start","type":1,"val":"accountId","end":""},{"old":"/api/accounts/:accountId/join/provider/start","type":0,"val":"join","end":""},{"old":"/api/accounts/:accountId/join/provider/start","type":0,"val":"provider","end":""},{"old":"/api/accounts/:accountId/join/provider/start","type":0,"val":"start","end":""}],
    types: placeholder as Registry['api.google.join-start']['types'],
  },
  'api.google.join-cancel': {
    methods: ["POST"],
    pattern: '/api/company-join/cancel',
    tokens: [{"old":"/api/company-join/cancel","type":0,"val":"api","end":""},{"old":"/api/company-join/cancel","type":0,"val":"company-join","end":""},{"old":"/api/company-join/cancel","type":0,"val":"cancel","end":""}],
    types: placeholder as Registry['api.google.join-cancel']['types'],
  },
  'api.google.join-complete': {
    methods: ["POST"],
    pattern: '/api/company-join/complete-provider',
    tokens: [{"old":"/api/company-join/complete-provider","type":0,"val":"api","end":""},{"old":"/api/company-join/complete-provider","type":0,"val":"company-join","end":""},{"old":"/api/company-join/complete-provider","type":0,"val":"complete-provider","end":""}],
    types: placeholder as Registry['api.google.join-complete']['types'],
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
  'api.accounts.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/accounts',
    tokens: [{"old":"/api/accounts","type":0,"val":"api","end":""},{"old":"/api/accounts","type":0,"val":"accounts","end":""}],
    types: placeholder as Registry['api.accounts.index']['types'],
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
