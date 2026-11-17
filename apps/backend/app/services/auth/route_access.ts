/**
 * What the account gate asks of a request before its handler runs. `public` asks nothing, and the
 * handler decides for itself. `limited` needs a valid sign-in. `admitted` also needs a confirmed
 * address and admission.
 */
export type RouteAccess = 'public' | 'limited' | 'admitted';

/** Every route under `/api/auth` answers a signed-out caller itself, as do the others listed. */
const publicRoutes = new Set([
  'api.auth.me',
  'api.auth.sign-up',
  'api.auth.sign-in',
  'api.auth.sign-out',
  'api.auth.password-confirmation',
  'api.auth.request-reset',
  'api.auth.inspect-reset',
  'api.auth.reset-password',
  'api.auth.change-password',
  'api.auth.delete-account',
  'api.auth.verification.send',
  'api.auth.verification.inspect',
  'api.auth.verification.complete',
  'api.health',
  'api.invites.preview',
  'api.invites.sign-up',
  'api.masquerade.status',
]);

/** Reached by a signed-in person who is not yet admitted. */
const limitedRoutes = new Set([
  'api.admission.show',
  'api.admission.request',
  'api.admission.index',
  'api.admission.approve',
  'api.admission.reject',
  'api.admission.revoke',
  'api.masquerade.start',
  'api.masquerade.end',
  'api.not-found',
]);

/** Product routes: the schedule, the company and its people. */
const admittedRoutes = new Set([
  'api.accounts.anonymise',
  'api.accounts.index',
  'api.admission.complete',
  'api.diagnostics',
  'api.example-data',
  'api.getting-started.show',
  'api.getting-started.update',
  'api.installation.company',
  'api.invites.create',
  'api.invites.index',
  'api.invites.resend',
  'api.invites.revoke',
  'api.member-resources.avatars',
  'api.member-resources.clear',
  'api.member-resources.set',
  'api.members.index',
  'api.members.role',
  'api.members.status',
  'api.members.tracking',
  'api.ownership.transfer',
  'api.resources.anonymise',
  'api.state',
  'api.transfer.apply',
  'api.transfer.preview',
]);

/** The gate's requirement for a route name, or `undefined` when the name is in no set. */
export function classifiedRouteAccess(name: string): RouteAccess | undefined {
  if (publicRoutes.has(name)) return 'public';
  if (limitedRoutes.has(name)) return 'limited';
  if (admittedRoutes.has(name) || name.startsWith('api.planning.')) return 'admitted';
  return undefined;
}

/**
 * The gate's requirement for a route. Only the health probes and the application shell have no
 * name, and they are public; a name in no set gets the strictest requirement.
 */
export function routeAccess(name: string | undefined): RouteAccess {
  if (name === undefined) return 'public';
  return classifiedRouteAccess(name) ?? 'admitted';
}
