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

type RequestHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

type RequestHookOptions = {
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
};

type ActiveHookSession = Awaited<ReturnType<typeof getSessionFromCtx>> | undefined;

function createHookContinuation(activeHookSession: ActiveHookSession) {
  return activeHookSession === undefined ? undefined : { context: { session: activeHookSession } };
}

function isBootstrapSetupRequest(
  context: RequestHookContext,
  { db, setupToken, countUsers, secretTokenMatches }: RequestHookOptions,
) {
  return (
    countUsers(db) === 0 && secretTokenMatches(setupToken, context.headers?.get("x-capacitylens-setup-token") ?? null)
  );
}

async function resolveActiveHookSession(
  context: RequestHookContext,
  { db, enforceSessionActivity, sessionDeletionLifecycleRef }: RequestHookOptions,
): Promise<ActiveHookSession> {
  const cookie = context.headers?.get("cookie") ?? "";
  const sessionPresented = cookie.length > 0 || context.headers?.has("authorization") === true;
  if (!sessionPresented) return undefined;

  const resolved = await getSessionFromCtx(context, {
    disableCookieCache: true,
    disableRefresh: true,
  });
  if (!resolved) return null;

  const sessionDeletionLifecycle = sessionDeletionLifecycleRef.current;
  return enforceSessionActivity(
    resolved,
    db,
    sessionDeletionLifecycle
      ? {
          prepare: (sessionToken, reason) => sessionDeletionLifecycle.prepareSession(sessionToken, reason),
          commit: (sessionHandles) => sessionDeletionLifecycle.commit(sessionHandles),
        }
      : undefined,
  );
}

function createBeforeRequestHook(options: RequestHookOptions) {
  const {
    db,
    allowOpenSignup,
    acquireBootstrapClaim,
    assertAuthRequestPasswordLength,
    countUsers,
    externalIdentityPath,
  } = options;

  return createAuthMiddleware(async (context) => {
    // Resolve a presented session once at the Better Auth pipeline boundary. Endpoint session
    // middleware reuses context.context.session, and /get-session can return it directly, so idle
    // enforcement no longer causes a wrapper lookup followed by the endpoint's second lookup.
    // Do not couple inactivity enforcement to Better Auth's internal session-cookie suffix. Any
    // presented cookie may be a session under a newer provider version; resolving it is the
    // fail-closed compatibility posture, while a truly cookieless public request still skips work.
    const activeHookSession = await resolveActiveHookSession(context, options);
    if (activeHookSession !== undefined) {
      context.context.session = activeHookSession;
      if (context.path === "/get-session" && activeHookSession) return activeHookSession;
    }
    const continuingContext = createHookContinuation(activeHookSession);

    if (externalIdentityPath(context.path)) {
      if (countUsers(db) === 0) {
        return {
          context: {
            ...continuingContext?.context,
            bootstrapClaimToken: acquireBootstrapClaim(),
          },
        };
      }
      return continuingContext;
    }
    if (allowOpenSignup) {
      assertAuthRequestPasswordLength(context.path, context.body);
      return continuingContext;
    }
    if (context.path !== "/sign-up/email") {
      assertAuthRequestPasswordLength(context.path, context.body);
      return continuingContext;
    }
    // A fresh password instance is never claimable merely because it is reachable. The operator
    // configures CAPACITYLENS_SETUP_TOKEN and the owner-setup form presents it in this header.
    // index.ts also refuses a fresh password boot when the secret is absent.
    if (isBootstrapSetupRequest(context, options)) {
      // Validate before acquiring the one-at-a-time bootstrap claim: a malformed password must not
      // strand setup waiting for an after-hook that this before-hook failure never reaches.
      assertAuthRequestPasswordLength(context.path, context.body);
      return {
        context: {
          ...continuingContext?.context,
          bootstrapClaimToken: acquireBootstrapClaim(),
        },
      };
    }
    // The EXACT refusal Better Auth's own disableSignUp emits (sign-up.mjs, 1.6.23), so the client
    // and tests see one unchanged error shape regardless of which gate closed the door.
    throw APIError.from("BAD_REQUEST", {
      message: "Email and password sign up is not enabled",
      code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    });
  });
}

function createAfterRequestHook({ db, allowOpenSignup, externalIdentityPath }: RequestHookOptions) {
  return createAuthMiddleware(async (context) => {
    // Email open signup does not acquire a claim. External first-owner and closed email setup
    // release any claim on both success and failure so a failed attempt cannot strand setup.
    if (externalIdentityPath(context.path) || (!allowOpenSignup && context.path === "/sign-up/email")) {
      const claimToken = (context as { bootstrapClaimToken?: unknown }).bootstrapClaimToken;
      if (typeof claimToken === "string") {
        db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
      }
    }
  });
}

export function buildRequestHooks(options: RequestHookOptions): Pick<BetterAuthOptions, "hooks" | "onAPIError"> {
  const { browserAuthErrorUrl, authHandlerErrorCapture } = options;
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
      before: createBeforeRequestHook(options),
      after: createAfterRequestHook(options),
    },
  };
}
