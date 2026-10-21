import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.lookup': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'mutationId': ParamValue} }
    'api.planning.allocation.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.allocation.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.createGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.allocation.delete': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.deleteGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.restoreGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.resource.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.resource.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.timeOff.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.timeOff.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.closure.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.closure.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.client.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.client.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.client.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.client.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.project.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.activity.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.phase.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.phase.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.discipline.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.discipline.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.resource.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.resource.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.duplicate': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.repeat': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.timeOff.repeat': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.settings.update': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
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
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.provider-start': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.members.tracking': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.members.role': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.status': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.enable-access': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.remove': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.reset-password': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.revoke-sessions': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.invites.create': { paramsTuple?: []; params?: {} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.invites.revoke': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.invites.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.invites.sign-up': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.joining.policy': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.update-policy': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.metadata': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.status': { paramsTuple?: []; params?: {} }
    'api.joining.complete-existing': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.request-proof': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.verify-email': { paramsTuple?: []; params?: {} }
    'api.member-resources.set': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
    'api.member-resources.clear': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
    'api.member-resources.clear-exception': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
    'api.member-resources.avatars': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.masquerade.start': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.masquerade.end': { paramsTuple?: []; params?: {} }
    'api.ownership.transfer': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.google.callback': { paramsTuple?: []; params?: {} }
    'api.google.link': { paramsTuple?: []; params?: {} }
    'api.google.identity': { paramsTuple?: []; params?: {} }
    'api.google.join-start': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.google.join-cancel': { paramsTuple?: []; params?: {} }
    'api.google.join-complete': { paramsTuple?: []; params?: {} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.accounts.index': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.lookup': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'mutationId': ParamValue} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.joining.policy': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.metadata': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.status': { paramsTuple?: []; params?: {} }
    'api.member-resources.avatars': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.google.callback': { paramsTuple?: []; params?: {} }
    'api.google.identity': { paramsTuple?: []; params?: {} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.accounts.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.lookup': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'mutationId': ParamValue} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.joining.policy': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.metadata': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.status': { paramsTuple?: []; params?: {} }
    'api.member-resources.avatars': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.google.callback': { paramsTuple?: []; params?: {} }
    'api.google.identity': { paramsTuple?: []; params?: {} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.accounts.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'api.planning.allocation.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.allocation.createGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.allocation.delete': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.deleteGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.restoreGroup': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.resource.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.timeOff.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.closure.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.client.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.client.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.client.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.project.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.activity.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.phase.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.discipline.create': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.planning.resource.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.resource.unarchive': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.duplicate': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.allocation.repeat': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.timeOff.repeat': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.batch': { paramsTuple?: []; params?: {} }
    'api.import': { paramsTuple?: []; params?: {} }
    'api.orgs.store': { paramsTuple?: []; params?: {} }
    'api.accounts.store': { paramsTuple?: []; params?: {} }
    'api.example-data': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.provider-start': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
    'api.members.enable-access': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.reset-password': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.revoke-sessions': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.invites.create': { paramsTuple?: []; params?: {} }
    'api.invites.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.invites.sign-up': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.joining.complete-existing': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.request-proof': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.verify-email': { paramsTuple?: []; params?: {} }
    'api.masquerade.start': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.ownership.transfer': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.google.link': { paramsTuple?: []; params?: {} }
    'api.google.join-start': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.google.join-cancel': { paramsTuple?: []; params?: {} }
    'api.google.join-complete': { paramsTuple?: []; params?: {} }
    'api.lifecycle': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'entity': ParamValue,'id': ParamValue,'action': ParamValue} }
  }
  PATCH: {
    'api.planning.allocation.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.resource.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.timeOff.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.closure.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.client.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.project.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.activity.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.phase.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.discipline.update': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.planning.settings.update': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.accounts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.members.role': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.members.status': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
  }
  DELETE: {
    'api.accounts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.members.remove': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'userId': ParamValue} }
    'api.invites.revoke': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'id': ParamValue} }
    'api.member-resources.clear': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
    'api.member-resources.clear-exception': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
    'api.masquerade.end': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'api.getting-started.update': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.members.tracking': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.joining.update-policy': { paramsTuple: [ParamValue]; params: {'accountId': ParamValue} }
    'api.member-resources.set': { paramsTuple: [ParamValue,ParamValue]; params: {'accountId': ParamValue,'principalId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}