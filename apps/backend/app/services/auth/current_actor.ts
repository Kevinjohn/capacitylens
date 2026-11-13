import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  AccountAdmission,
  AdmissionRequiredError,
} from '@kevinjohn/adonisjs-account-kit/admission';
import { InvalidSessionError, UnverifiedEmailError } from '@kevinjohn/adonisjs-account-kit/errors';
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import { users } from '#services/account_kit/users';
import { managedGuard } from '#services/auth/managed_guard';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import type { ResolvedContext } from '@kevinjohn/adonisjs-masquerade';
import type { KitContext } from '@kevinjohn/adonisjs-confirm-action-with-password';

const handleKey = 'accountKitSession';

/** The signed-in principal, as the Account Kit verified it in the current transaction. */
export interface CurrentActor {
  userId: string;
  /** The caller's Account Kit sign-in row; session-bound product rows cascade from it. */
  sessionId: number;
  email: string;
  displayName: string | null;
  /** False until the address is confirmed; only limited routes see such an actor. */
  emailVerified: boolean;
  /** The Masquerade package's admission for a member route, captured before the transaction. */
  masqueradeContext?: ResolvedContext;
}

/** The signed-in Account Kit account, checked in the Kit's own transaction. */
export async function currentAccount(ctx: HttpContext) {
  return accountKit.authentication.current(await managedGuard.current(ctx));
}

/** The Kit's admission decision for an account, read under the lock `trx` already holds. */
export async function admissionDecision(userId: string | number, trx: Trx) {
  const user = await users.findById(userId, trx);
  if (!user) throw new InvalidSessionError();
  const admission = await app.container.make(AccountAdmission);
  return admission.decide(user, trx);
}

const actors = new WeakMap<Trx, CurrentActor>();
const kitContexts = new WeakMap<Trx, KitContext>();

/** Requires the confirmed address and admission shared by product and password confirmation transactions. */
export async function requireConfirmedAdmission(account: KitContext['account'], trx: Trx) {
  if (!account.active) throw new UnverifiedEmailError();
  const decision = await admissionDecision(account.id, trx);
  if (!decision.admitted) throw new AdmissionRequiredError(decision);
}

/**
 * The view-as context the Masquerade package admitted for this request, or `undefined` on a route
 * that does not use the effective guard. The package caches one admission per request, and this
 * reads it before the product transaction opens.
 */
async function admittedMasqueradeContext(ctx: HttpContext): Promise<ResolvedContext | undefined> {
  const runtime = await ctx.containerResolver.make('masquerade.runtime');
  if (runtime.selectGuard(ctx).kind !== 'effective') return undefined;
  const admitted = await runtime.admit(ctx);
  return admitted.context;
}

/**
 * Runs `run` in the Account Kit's transaction after it has verified the session, its credential
 * revision and its registry row under the account lock; a concurrent revocation or credential
 * change waits for the commit or is observed first. Product access additionally requires a
 * confirmed address and admission, read in the same transaction. `run` must stay database-only:
 * SQLite may retry it.
 */
export async function withActor<T>(
  ctx: HttpContext,
  run: (actor: CurrentActor, trx: Trx) => Promise<T>,
  options: { limited?: boolean } = {}
): Promise<T> {
  const input = await managedGuard.current(ctx);
  const masqueradeContext = await admittedMasqueradeContext(ctx);
  return accountKit.authentication.withCurrent(input, async (context) => {
    const { account, signInId, trx } = context;
    if (signInId === undefined) throw new InvalidSessionError();
    if (!options.limited) {
      await requireConfirmedAdmission(account, trx);
    }
    const row = await trx
      .from('users')
      .where('id', String(account.id))
      .select('display_name')
      .first();
    const actor: CurrentActor = {
      userId: String(account.id),
      sessionId: signInId,
      email: account.email,
      displayName: row?.display_name ?? null,
      emailVerified: account.active,
      masqueradeContext,
    };
    if (masqueradeContext && masqueradeContext.actorId !== actor.userId) {
      throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
    }
    actors.set(trx, actor);
    kitContexts.set(trx, context);
    try {
      return await run(actor, trx);
    } finally {
      actors.delete(trx);
      kitContexts.delete(trx);
    }
  });
}

/** The actor `withActor` verified for this transaction; anything else is a programming error. */
export function actorIn(trx: Trx): CurrentActor {
  const actor = actors.get(trx);
  if (!actor) throw new Error('This operation must run inside withActor.');
  return actor;
}

/** The Kit context verified by `withActor`; valid only during its callback. */
export function kitContextIn(trx: Trx): KitContext {
  const context = kitContexts.get(trx);
  if (!context) throw new Error('This operation must run inside withActor.');
  return context;
}

/**
 * The caller's verified sign-in for request-wide checks, or null when the request carries none or
 * it is no longer valid. Route handlers still authorize through `withActor`.
 */
export async function signedInSession(ctx: HttpContext) {
  if (!ctx.session.get(handleKey)) return null;
  try {
    return await withActor(ctx, async (actor) => actor, { limited: true });
  } catch (error) {
    if (error instanceof InvalidSessionError) return null;
    throw error;
  }
}
