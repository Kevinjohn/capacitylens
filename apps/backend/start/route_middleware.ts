// Masquerade rules are declared where each route is registered and enforced by the Masquerade
// package's context middleware after route matching. Member routes use the package's effective
// guard and are refused for writes while a mode is active; `asMemberOnly()` marks reads that are
// refused outright; the view-as controls run on the raw guard; routes about the signed-in person's
// own account carry Account Kit's account blocker. A request carrying a stale
// `X-Masquerade-Context` is refused, reads included.
// `tests/functional/auth/masquerade_routes.spec.ts` pins every route's classification from `node
// ace masquerade:routes`. Because these rules run after routing and body parsing, a write to a path
// with no route answers 404 and a malformed body answers 400, not `E_MASQUERADE_READ_ONLY`.

import type { MiddlewareFn, ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'

type RouteMiddleware = (MiddlewareFn | ParsedNamedMiddleware)[]

/**
 * A company or product route. It runs as the viewed-as member while a view-as mode is active, and
 * the Masquerade package refuses every write then.
 */
export const asMember = (): RouteMiddleware => [middleware.auth({ guards: ['web_effective'] })]

/** A member route that is refused outright, reads included, while a view-as mode is active. */
export const asMemberOnly = (): RouteMiddleware => [...asMember(), sensitive()]

/** A company route: a member route whose user must hold an active membership in `:companyId`. */
export const asCompanyMember = (): RouteMiddleware => [...asMember(), middleware.companyScope()]

/** A company read refused outright while a view-as mode is active. */
export const asCompanyMemberOnly = (): RouteMiddleware => [
  ...asMemberOnly(),
  middleware.companyScope(),
]

/** A planning route: a company route whose refusal is the planning `E_ACCOUNT_MEMBERSHIP_LOST`. */
export const asPlanningMember = (): RouteMiddleware => [
  ...asMember(),
  middleware.companyScope({ planning: true }),
]

/** A view-as control. It always runs as the signed-in person. */
export const asSignedInPerson = (): RouteMiddleware => [middleware.auth({ guards: ['web'] })]

/** A company view-as control: the signed-in person must hold an active membership in `:companyId`. */
export const asCompanySignedInPerson = (): RouteMiddleware => [
  ...asSignedInPerson(),
  middleware.companyScope(),
]

/**
 * A route about the signed-in person's own account. It answers a signed-out caller itself and is
 * refused while a view-as mode is active.
 */
export const asOwnAccount = (): RouteMiddleware => [middleware.accountKitAccountBlocker()]
