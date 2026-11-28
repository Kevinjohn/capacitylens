import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  AccountAdmission,
  E_ACCOUNT_KIT_ADMISSION_REQUIRED,
} from '@kevinjohn/adonisjs-account-kit/admission'
import {
  E_ACCOUNT_KIT_INVALID_SESSION,
  E_ACCOUNT_KIT_UNVERIFIED_EMAIL,
} from '@kevinjohn/adonisjs-account-kit/errors'
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types'
import { users } from '#services/account_kit/account_user_service'
import User from '#models/user'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import type { ResolvedContext } from '@kevinjohn/adonisjs-masquerade'
import type { KitContext } from '@kevinjohn/adonisjs-confirm-action-with-password'

const handleKey = 'accountKitSession'

/** The request's authenticator, which `withActor` reads the signed-in session from. */
export type RequestAuth = HttpContext['auth']

/** The signed-in user, as the Account Kit verified it in the current transaction. */
export interface CurrentActor {
  userId: string
  /** The caller's Account Kit sign-in row; session-bound product rows cascade from it. */
  sessionId: number
  email: string
  displayName: string | null
  /** False until the address is confirmed; only limited routes see such an actor. */
  emailVerified: boolean
  /** The Masquerade package's admission for a member route, captured before the transaction. */
  masqueradeContext?: ResolvedContext
}

const actors = new WeakMap<Trx, CurrentActor>()
const kitContexts = new WeakMap<Trx, KitContext>()

/** The signed-in actor, verified in the Account Kit's transaction. */
@inject()
export class CurrentActorService {
  #admission: AccountAdmission

  constructor(admission: AccountAdmission) {
    this.#admission = admission
  }

  /** The Kit's admission decision for an account, read under the lock `trx` already holds. */
  async requireAdmissionDecision(userId: string | number, trx: Trx) {
    const user = await users.findById(userId, trx)
    if (!user) throw new E_ACCOUNT_KIT_INVALID_SESSION()
    return this.#admission.decide(user, trx)
  }

  /** Requires the confirmed address and admission shared by product and password confirmation transactions. */
  async requireConfirmedAdmission(account: KitContext['account'], trx: Trx) {
    if (!account.active) throw new E_ACCOUNT_KIT_UNVERIFIED_EMAIL()
    const decision = await this.requireAdmissionDecision(account.id, trx)
    if (!decision.admitted) throw new E_ACCOUNT_KIT_ADMISSION_REQUIRED(decision)
  }

  /**
   * Runs `run` in the Account Kit's transaction after it has verified the session, its credential
   * revision and its registry row under the account lock; a concurrent revocation or credential
   * change waits for the commit or is observed first. Product access additionally requires a
   * confirmed address and admission, read in the same transaction. `run` must stay database-only:
   * SQLite may retry it.
   */
  async withActor<T>(
    auth: HttpContext['auth'],
    run: (actor: CurrentActor, trx: Trx) => Promise<T>,
    options: { limited?: boolean } = {}
  ): Promise<T> {
    const input = await auth.use('web').current()
    // The view-as context the Masquerade package admitted for this request, or `undefined` on a route
    // that does not use the effective guard. The package admits once per request, and this reads it
    // before the product transaction opens.
    const effective = auth.use('web_effective')
    if (!effective.authenticationAttempted) await effective.authenticate()
    const masqueradeContext = effective.context
    return accountKit.authentication.withCurrent(input, async (context) => {
      const { account, signInId, trx } = context
      if (signInId === undefined) throw new E_ACCOUNT_KIT_INVALID_SESSION()
      if (!options.limited) {
        await this.requireConfirmedAdmission(account, trx)
      }
      const row = await User.query({ client: trx })
        .where('id', String(account.id))
        .select('display_name')
        .first()
      const actor: CurrentActor = {
        userId: String(account.id),
        sessionId: signInId,
        email: account.email,
        displayName: row?.displayName ?? null,
        emailVerified: account.active,
        masqueradeContext,
      }
      if (masqueradeContext && masqueradeContext.actorId !== actor.userId) {
        throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
      }
      actors.set(trx, actor)
      kitContexts.set(trx, context)
      try {
        return await run(actor, trx)
      } finally {
        actors.delete(trx)
        kitContexts.delete(trx)
      }
    })
  }

  /** The actor `withActor` verified for this transaction; anything else is a programming error. */
  requireActor(trx: Trx): CurrentActor {
    const actor = actors.get(trx)
    if (!actor) throw new Error('This operation must run inside withActor.')
    return actor
  }

  /** The Kit context verified by `withActor`; valid only during its callback. */
  requireKitContext(trx: Trx): KitContext {
    const context = kitContexts.get(trx)
    if (!context) throw new Error('This operation must run inside withActor.')
    return context
  }

  /**
   * The caller's verified sign-in for request-wide checks, or null when the request carries none or
   * it is no longer valid. Route handlers still authorize through `withActor`.
   */
  async getSignedInSession(auth: HttpContext['auth'], session: HttpContext['session']) {
    if (!session.get(handleKey)) return null
    try {
      return await this.withActor(auth, async (actor) => actor, { limited: true })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_INVALID_SESSION) return null
      throw error
    }
  }
}
