import type { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { Db } from "../db";

type SessionDeletionLifecycleRef = {
  current: {
    prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
    commit(sessionHandles: readonly string[]): void;
  } | null;
};

export function buildRequestHooks({
  db,
  browserAuthErrorUrl,
  authHandlerErrorCapture,
  allowOpenSignup,
  setupToken,
  sessionDeletionLifecycleRef,
  acquireBootstrapClaim,
  assertAuthRequestPasswordLength,
  countUsers,
  enforceSessionActivity,
  secretTokenMatches,
  externalIdentityPath,
}: {
  db: Db;
  browserAuthErrorUrl: URL;
  authHandlerErrorCapture: AsyncLocalStorage<{ error: unknown }>;
  allowOpenSignup: boolean;
  setupToken: string | undefined;
  sessionDeletionLifecycleRef: SessionDeletionLifecycleRef;
  acquireBootstrapClaim: () => string;
  assertAuthRequestPasswordLength: (path: string, body: unknown) => void;
  countUsers: (db: Db) => number;
  enforceSessionActivity: <Session extends { session: { token: string; updatedAt: Date | string } }>(
    session: Session,
    db: Db,
    lifecycle?: {
      prepare(sessionToken: string, reason: "session_expired"): readonly string[];
      commit(sessionHandles: readonly string[]): void;
    },
  ) => Promise<Session | null>;
  secretTokenMatches: (configured: string | undefined, presented: unknown) => boolean;
  externalIdentityPath: (path: string | undefined) => boolean;
}): Pick<BetterAuthOptions, "hooks" | "onAPIError"> {
  return {
    // OAuth/OIDC callback failures are browser navigations, not JSON API calls. Route them back to
    // the product's sign-in wall, which renders one stable non-sensitive message and removes the
    // provider-controlled query values. Per-flow errorCallbackURL values preserve invite routes.
    onAPIError: {
      errorURL: browserAuthErrorUrl.toString(),
      onError(error) {
        const capture = authHandlerErrorCapture.getStore();
        if (capture) capture.error = error;
        // Supplying onError replaces Better Auth's default logger, so retain a breadcrumb for the
        // dependency failures that it has already normalized to a generic response.
        if (!(error instanceof APIError)) console.error("Better Auth request failed.", error);
      },
    },
    // The LIVE sign-up gate (see the SECURE DEFAULT comment above): allowed when the operator
    // opted in, or for the empty-table owner bootstrap when the request proves knowledge of the
    // configured setup secret. countUsers(db) is consulted per request so the bootstrap route
    // closes immediately after the first identity is created.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Resolve a presented session once at the Better Auth pipeline boundary. Endpoint session
        // middleware reuses ctx.context.session, and /get-session can return it directly, so idle
        // enforcement no longer causes a wrapper lookup followed by the endpoint's second lookup.
        const cookie = ctx.headers?.get("cookie") ?? "";
        // Do not couple inactivity enforcement to Better Auth's internal session-cookie suffix.
        // Any presented cookie may be a session under a newer provider version; resolving it is the
        // fail-closed compatibility posture, while a truly cookieless public request still skips work.
        const sessionPresented = cookie.length > 0 || ctx.headers?.has("authorization") === true;
        let activeHookSession: Awaited<ReturnType<typeof getSessionFromCtx>> | undefined;
        if (sessionPresented) {
          const resolved = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
            disableRefresh: true,
          });
          activeHookSession = resolved
            ? await enforceSessionActivity(
                resolved,
                db,
                sessionDeletionLifecycleRef.current
                  ? {
                      prepare: (sessionToken, reason) =>
                        sessionDeletionLifecycleRef.current!.prepareSession(sessionToken, reason),
                      commit: (sessionHandles) => sessionDeletionLifecycleRef.current!.commit(sessionHandles),
                    }
                  : undefined,
              )
            : null;
          ctx.context.session = activeHookSession;
          if (ctx.path === "/get-session" && activeHookSession) return activeHookSession;
        }
        const continuingContext = () =>
          activeHookSession === undefined ? undefined : { context: { session: activeHookSession } };

        if (externalIdentityPath(ctx.path)) {
          if (countUsers(db) === 0) {
            return {
              context: {
                ...continuingContext()?.context,
                bootstrapClaimToken: acquireBootstrapClaim(),
              },
            };
          }
          return continuingContext();
        }
        if (allowOpenSignup) {
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return continuingContext();
        }
        if (ctx.path !== "/sign-up/email") {
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return continuingContext();
        }
        // A fresh password instance is never claimable merely because it is reachable. The
        // operator configures CAPACITYLENS_SETUP_TOKEN and the owner-setup form presents it in
        // this header. index.ts also refuses a fresh password boot when the secret is absent.
        if (
          countUsers(db) === 0 &&
          secretTokenMatches(setupToken, ctx.headers?.get("x-capacitylens-setup-token") ?? null)
        ) {
          // Validate before acquiring the one-at-a-time bootstrap claim: a malformed password must
          // not strand setup waiting for an after-hook that this before-hook failure never reaches.
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return {
            context: {
              ...continuingContext()?.context,
              bootstrapClaimToken: acquireBootstrapClaim(),
            },
          };
        }
        // The EXACT refusal Better Auth's own disableSignUp emits (sign-up.mjs, 1.6.23), so the
        // client and tests see one unchanged error shape regardless of which gate closed the door.
        throw APIError.from("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Email open signup does not acquire a claim. External first-owner and closed email setup
        // release any claim on both success and failure so a failed attempt cannot strand setup.
        if (externalIdentityPath(ctx.path) || (!allowOpenSignup && ctx.path === "/sign-up/email")) {
          const claimToken = (ctx as { bootstrapClaimToken?: unknown }).bootstrapClaimToken;
          if (typeof claimToken === "string") {
            db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
          }
        }
      }),
    },
  };
}
