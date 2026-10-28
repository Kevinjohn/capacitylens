import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import { errors as authErrors } from '@adonisjs/auth';
import accountKit from 'adonisjs-account-kit/services/main';
import { AccountAdmission, AdmissionRequiredError } from 'adonisjs-account-kit/admission';
import { InvalidSessionError, UnverifiedEmailError } from 'adonisjs-account-kit/errors';
import type { CurrentAccountInput, Trx } from 'adonisjs-account-kit/types';
import type User from '#models/user';
import { users } from '#services/account_kit/users';
import { capturedMasqueradeContext } from '#services/auth/masquerade_request';
import { MasqueradeError } from 'adonisjs-masquerade';
import type { ResolvedContext } from 'adonisjs-masquerade';

const revisionKey = 'accountKitRevision';
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
  /** Immutable package admission captured before this request's product transaction. */
  masqueradeContext?: ResolvedContext;
}

/** The Account Kit guard port for the existing `web` session guard. */
export function sessionGuard(ctx: HttpContext) {
  const guard = ctx.auth.use('web');
  return {
    strategy: 'session' as const,
    name: 'web',
    async establish(userId: string | number, revision: string | null, handle?: string) {
      const { default: UserModel } = await import('#models/user');
      ctx.session.regenerate();
      await guard.login(await UserModel.findOrFail(String(userId)));
      ctx.session.put(revisionKey, revision ?? '');
      if (handle) ctx.session.put(handleKey, handle);
      return undefined;
    },
    async terminate() {
      await guard.logout();
      ctx.session.clear();
      ctx.session.regenerate();
    },
  };
}

/** The trusted session facts the Kit checks: user, credential revision and registry handle. */
export async function accountInput(ctx: HttpContext): Promise<CurrentAccountInput> {
  let user: User;
  try {
    user = (await ctx.auth.use('web').authenticate()) as User;
  } catch (error) {
    // Only a missing or rejected session is a sign-out; a database fault must surface as one.
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) throw new InvalidSessionError();
    throw error;
  }
  const revision: unknown = ctx.session.get(revisionKey);
  const handle: unknown = ctx.session.get(handleKey);
  if (typeof revision !== 'string' || typeof handle !== 'string' || !handle)
    throw new InvalidSessionError();
  return {
    userId: String(user.id),
    revision: revision === '' ? null : revision,
    sessionHandle: handle,
  };
}

/** The signed-in Account Kit account, checked in the Kit's own transaction. */
export async function currentAccount(ctx: HttpContext) {
  return accountKit.authentication.current(await accountInput(ctx));
}

/** The Kit's admission decision for an account, read under the lock `trx` already holds. */
export async function admissionDecision(userId: string | number, trx: Trx) {
  const user = await users.findById(userId, trx);
  if (!user) throw new InvalidSessionError();
  const admission = await app.container.make(AccountAdmission);
  return admission.decide(user, trx);
}

const actors = new WeakMap<Trx, CurrentActor>();

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
  const input = await accountInput(ctx);
  return accountKit.authentication.withCurrent(input, async ({ account, signInId, trx }) => {
    if (signInId === undefined) throw new InvalidSessionError();
    if (!options.limited) {
      if (!account.active) throw new UnverifiedEmailError();
      const decision = await admissionDecision(account.id, trx);
      if (!decision.admitted) throw new AdmissionRequiredError(decision);
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
      masqueradeContext: capturedMasqueradeContext(ctx),
    };
    const captured = capturedMasqueradeContext(ctx);
    if (captured && captured.actorId !== actor.userId)
      throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
    actors.set(trx, actor);
    try {
      return await run(actor, trx);
    } finally {
      actors.delete(trx);
    }
  });
}

/** The actor `withActor` verified for this transaction; anything else is a programming error. */
export function actorIn(trx: Trx): CurrentActor {
  const actor = actors.get(trx);
  if (!actor) throw new Error('This operation must run inside withActor.');
  return actor;
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
