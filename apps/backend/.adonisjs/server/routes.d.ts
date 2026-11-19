import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.archive': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.mutate': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.undo': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.redo': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.installation.company': { paramsTuple?: []; params?: {} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.transfer.preview': { paramsTuple?: []; params?: {} }
    'api.transfer.apply': { paramsTuple?: []; params?: {} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.export': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.companies.anonymise': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.resources.anonymise': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.example-data': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting-started.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.password-confirmation': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.inspect-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
    'api.auth.delete-account': { paramsTuple?: []; params?: {} }
    'api.auth.verification.send': { paramsTuple?: []; params?: {} }
    'api.auth.verification.inspect': { paramsTuple?: []; params?: {} }
    'api.auth.verification.complete': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.members.tracking': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.members.role': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.members.status': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.invites.create': { paramsTuple?: []; params?: {} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invites.resend': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invites.revoke': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.invites.sign-up': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission.request': { paramsTuple?: []; params?: {} }
    'api.admission.complete': { paramsTuple?: []; params?: {} }
    'api.admission.index': { paramsTuple?: []; params?: {} }
    'api.admission.approve': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission.reject': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission.revoke': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.member-resources.set': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.member-resources.clear': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.masquerade.start': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.masquerade.end': { paramsTuple?: []; params?: {} }
    'api.ownership.transfer': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.diagnostics': { paramsTuple?: []; params?: {} }
    'api.not-found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  GET: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.archive': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.export': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission.index': { paramsTuple?: []; params?: {} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.diagnostics': { paramsTuple?: []; params?: {} }
    'api.not-found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  HEAD: {
    'api.planning.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.archive': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.companies.index': { paramsTuple?: []; params?: {} }
    'api.state': { paramsTuple?: []; params?: {} }
    'api.export': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.getting-started.show': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.auth.me': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invites.index': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.invites.preview': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.show': { paramsTuple?: []; params?: {} }
    'api.admission.index': { paramsTuple?: []; params?: {} }
    'api.masquerade.status': { paramsTuple?: []; params?: {} }
    'api.health': { paramsTuple?: []; params?: {} }
    'api.diagnostics': { paramsTuple?: []; params?: {} }
    'api.not-found': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  POST: {
    'api.planning.mutate': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.undo': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.planning.redo': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.installation.company': { paramsTuple?: []; params?: {} }
    'api.transfer.preview': { paramsTuple?: []; params?: {} }
    'api.transfer.apply': { paramsTuple?: []; params?: {} }
    'api.companies.anonymise': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.resources.anonymise': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.example-data': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.auth.sign-up': { paramsTuple?: []; params?: {} }
    'api.auth.sign-in': { paramsTuple?: []; params?: {} }
    'api.auth.sign-out': { paramsTuple?: []; params?: {} }
    'api.auth.password-confirmation': { paramsTuple?: []; params?: {} }
    'api.auth.request-reset': { paramsTuple?: []; params?: {} }
    'api.auth.inspect-reset': { paramsTuple?: []; params?: {} }
    'api.auth.reset-password': { paramsTuple?: []; params?: {} }
    'api.auth.change-password': { paramsTuple?: []; params?: {} }
    'api.auth.delete-account': { paramsTuple?: []; params?: {} }
    'api.auth.verification.send': { paramsTuple?: []; params?: {} }
    'api.auth.verification.inspect': { paramsTuple?: []; params?: {} }
    'api.auth.verification.complete': { paramsTuple?: []; params?: {} }
    'api.invites.create': { paramsTuple?: []; params?: {} }
    'api.invites.resend': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.invites.sign-up': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'api.admission.request': { paramsTuple?: []; params?: {} }
    'api.admission.complete': { paramsTuple?: []; params?: {} }
    'api.admission.approve': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission.reject': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.admission.revoke': { paramsTuple: [ParamValue]; params: {'userId': ParamValue} }
    'api.masquerade.start': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.ownership.transfer': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
  }
  PUT: {
    'api.getting-started.update': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.members.tracking': { paramsTuple: [ParamValue]; params: {'companyId': ParamValue} }
    'api.member-resources.set': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
  }
  PATCH: {
    'api.members.role': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.members.status': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
  }
  DELETE: {
    'api.invites.revoke': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'id': ParamValue} }
    'api.member-resources.clear': { paramsTuple: [ParamValue,ParamValue]; params: {'companyId': ParamValue,'userId': ParamValue} }
    'api.masquerade.end': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}