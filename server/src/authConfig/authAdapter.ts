import { randomBytes } from "node:crypto";
import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import type * as AuthFacade from "../auth";
import { bindFederatedProvider } from "../accounts/state";
import { applicationSessionHandle } from "../accounts/sessionHandle";
import {
  createFederatedLinkCeremony,
  deleteFederatedLinkCeremony,
  reconcileObservedFederatedLinks,
} from "../federatedLinkLifecycle";
import { buildProviders } from "./providers";
import { buildErrorRedirect } from "./errorRedirect";
import type { Auth, AuthProviderInfo, RawSessionUser } from "./authTypes";
import { SESSION_ABSOLUTE_TTL_SECONDS } from "./authConstants";
import {
  authHandlerErrorCapture,
  passwordResetSessionCapture,
  isFederatedAccountCoordinateConstraint,
} from "./captureContexts";
import { normalizeSessionUser } from "./sessionActivity";
import { verifiedUnauditedFederatedLinks, sqliteTableExists } from "./federatedIdentitySchema";
import { createCredentialUserWith } from "./bootstrapAdmin";

// The reset-state SQL stays in the facade; bind it without a runtime back-edge.
export function buildAuthAdapter({
  revokeFederatedLinkStateInTx,
  AuthConfigError,
  providerIdFromExternalContext,
}: {
  revokeFederatedLinkStateInTx: typeof AuthFacade.revokeFederatedLinkStateInTx;
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  providerIdFromExternalContext: typeof AuthFacade.providerIdFromExternalContext;
}) {
  function createAuthAdapter({
    db,
    application,
    instance,
    configuredProviderInfo,
    configuredFederatedIssuers,
    publicUrl,
    browserAuthErrorUrl,
    trustedOrigins,
    strictOidcClient,
    strictOidcAuthorizationProxyPath,
    sessionDeletionLifecycleRef,
  }: {
    db: Db;
    application: BoundApplication;
    instance: unknown;
    configuredProviderInfo: AuthProviderInfo[];
    configuredFederatedIssuers: Map<string, string>;
    publicUrl: URL;
    browserAuthErrorUrl: URL;
    trustedOrigins: string[] | undefined;
    strictOidcClient: ReturnType<typeof buildProviders>["strictOidcClient"];
    strictOidcAuthorizationProxyPath: string | null;
    sessionDeletionLifecycleRef: {
      current: {
        prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
        prepareUser(userId: string, reason: "session_revoked"): readonly string[];
        commit(sessionHandles: readonly string[]): void;
      } | null;
    };
  }): Auth {
    // Collapse the invariant generic to the structural Auth surface (see Auth), AND normalize at
    // this single narrowing boundary (P1.7a): Better Auth's full user carries the richer fields we
    // drop here, so this is exactly where `emailVerified` is read and defaulted before everything
    // downstream sees only the {id,email,emailVerified,name} SessionUser.
    const raw = instance as unknown as {
      handler: Auth["handler"];
      api: {
        getSession: (input: { headers: Headers }) => Promise<{
          user: RawSessionUser;
          session: {
            createdAt: Date | string;
            updatedAt: Date | string;
            token: string;
          };
        } | null>;
        requestPasswordReset: Auth["api"]["requestPasswordReset"];
      };
      options: BetterAuthOptions;
      // Better Auth's async init context (reverified against better-auth 1.6.23,
      // dist/auth/base.mjs:37 `$context: authContext`, dist/db/internal-adapter.mjs for deletion, and
      // dist/context/create-context.mjs for `password.hash`). Read only through the narrow Auth
      // methods below.
      $context: Promise<{
        password: { hash: (password: string) => Promise<string> };
        internalAdapter: {
          deleteUser: (userId: string) => Promise<void>;
          deleteUserSessions: (userId: string) => Promise<void>;
        };
      }>;
    };

    // raw.api.getSession runs through the same hooks.before pipeline as HTTP routes, so the session is
    // already idle-checked and touched once before it reaches this provider-neutral adapter.
    const activeSession = (headers: Headers) => raw.api.getSession({ headers });
    const strictProvider = configuredProviderInfo.find((provider) => provider.kind === "oidc") ?? null;
    const trustedLinkOrigins = new Set([
      publicUrl.origin,
      ...(trustedOrigins ?? []).map((value) => {
        try {
          return new URL(value).origin;
        } catch (cause) {
          throw new AuthConfigError(`Trusted origin ${JSON.stringify(value)} must be an absolute URL.`, { cause });
        }
      }),
    ]);

    const linkReturnUrl = (value: string, parameter: string, ceremonyId: string): URL => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw APIError.from("BAD_REQUEST", {
          message: "The identity-link return URL is invalid.",
          code: "INVALID_CALLBACK_URL",
        });
      }
      if (!trustedLinkOrigins.has(url.origin) || url.username || url.password) {
        throw APIError.from("FORBIDDEN", {
          message: "The identity-link return URL is not a trusted browser origin.",
          code: "INVALID_CALLBACK_URL",
        });
      }
      url.searchParams.set(parameter, ceremonyId);
      return url;
    };

    // The verification lookup stays here so identity SQL keeps a single owner (see the account
    // boundary conformance test); the builder only decides what to do with the rows.
    const readVerificationValues = (storedIdentifier: string): readonly string[] | null => {
      if (!sqliteTableExists(db, "verification")) return null;
      const rows = db
        .prepare(`SELECT value FROM verification WHERE identifier = ? LIMIT 2`)
        .all(storedIdentifier) as Array<{ value: string }>;
      return rows.map((row) => row.value);
    };
    const callbackErrorUrl = buildErrorRedirect({
      browserAuthErrorUrl,
      trustedLinkOrigins,
      readVerificationValues,
    });

    const isStrictOidcVerificationFailure = (error: unknown): boolean =>
      error instanceof APIError && error.body?.code === "OIDC_IDENTITY_VERIFICATION_FAILED";

    const auth: Auth = {
      // Enforce inactivity even when a caller goes directly to an authenticated Better Auth route
      // such as change-password rather than first touching an application data route.
      handler: async (request) => {
        const callbackPath = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
        const callbackProviderId = providerIdFromExternalContext({ path: callbackPath });
        const failureTarget = callbackProviderId ? callbackErrorUrl(request) : null;
        if (strictOidcClient && strictOidcAuthorizationProxyPath) {
          const requestUrl = new URL(request.url);
          if (request.method === "GET" && requestUrl.pathname === strictOidcAuthorizationProxyPath) {
            try {
              const metadata = await strictOidcClient.metadata();
              const target = new URL(metadata.authorization_endpoint);
              for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
              return new Response(null, {
                status: 302,
                headers: {
                  location: target.toString(),
                  "cache-control": "no-store",
                  pragma: "no-cache",
                },
              });
            } catch (error) {
              console.error("Strict OIDC authorization initialization failed.", error);
              const target = new URL(browserAuthErrorUrl);
              target.searchParams.set("error", "provider_unavailable");
              return new Response(null, {
                status: 302,
                headers: {
                  location: target.toString(),
                  "cache-control": "no-store",
                  pragma: "no-cache",
                },
              });
            }
          }
        }
        try {
          const capture = { error: null as unknown };
          const resetCapture = { sessionHandles: [] as readonly string[] };
          const response = await authHandlerErrorCapture.run(capture, () =>
            passwordResetSessionCapture.run(resetCapture, () => raw.handler(request)),
          );
          if (response.ok && resetCapture.sessionHandles.length > 0) {
            sessionDeletionLifecycleRef.current?.commit(resetCapture.sessionHandles);
          }
          if (callbackProviderId && isStrictOidcVerificationFailure(capture.error)) {
            const target = failureTarget ?? new URL(browserAuthErrorUrl);
            target.searchParams.set("error", "OIDC_IDENTITY_VERIFICATION_FAILED");
            return Response.redirect(target, 302);
          }
          if (callbackProviderId && isFederatedAccountCoordinateConstraint(capture.error)) {
            const target = failureTarget ?? new URL(browserAuthErrorUrl);
            target.searchParams.set("error", "account_already_linked_to_different_user");
            return Response.redirect(target, 302);
          }
          if (callbackProviderId) {
            try {
              reconcileObservedFederatedLinks(db, application.applicationId, () => verifiedUnauditedFederatedLinks(db));
            } catch (error) {
              // The trigger already preserved the durable observation. Keep the browser response
              // truthful and let startup/request reconciliation retry the audit transaction.
              console.error("Federated identity link audit reconciliation is pending.", error);
            }
          }
          return response;
        } catch (error) {
          if (isFederatedAccountCoordinateConstraint(error)) {
            const target = failureTarget ?? new URL(browserAuthErrorUrl);
            target.searchParams.set("error", "account_already_linked_to_different_user");
            return Response.redirect(target, 302);
          }
          throw error;
        }
      },
      options: raw.options,
      providers: configuredProviderInfo,
      federatedIssuers: configuredFederatedIssuers,
      strictProvider,
      ensureProviderBindings: () => {
        for (const [providerId, issuer] of configuredFederatedIssuers) {
          bindFederatedProvider(db, application.applicationId, issuer, providerId);
        }
      },
      assertProviderBindings: () => {
        for (const [providerId, issuer] of configuredFederatedIssuers) {
          const row = db
            .prepare(
              `SELECT issuer, providerId
               FROM account_federated_provider_bindings
              WHERE applicationId = ? AND (issuer = ? OR providerId = ?)`,
            )
            .all(application.applicationId, issuer, providerId) as Array<{ issuer: string; providerId: string }>;
          if (row.length !== 1 || row[0]!.issuer !== issuer || row[0]!.providerId !== providerId) {
            throw new Error(`Persisted provider binding does not match configured provider ${providerId}.`);
          }
        }
      },
      api: {
        async getSession(input) {
          const session = await activeSession(input.headers);
          if (!session) return null;
          return {
            user: {
              ...normalizeSessionUser(session.user),
              sessionCreatedAt: new Date(session.session.createdAt).toISOString(),
            },
            session: {
              // Better Auth exposes the bearer token rather than its database row id here. Hash it
              // before it crosses our identity boundary; callers receive a stable opaque handle,
              // never a credential that could authenticate a request.
              id: applicationSessionHandle(application.applicationId, session.session.token),
              createdAt: new Date(session.session.createdAt).toISOString(),
              expiresAt: new Date(
                new Date(session.session.createdAt).getTime() + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
              ).toISOString(),
            },
          };
        },
        // Bound (not bare-referenced): Better Auth's api endpoints resolve their context via `this`.
        requestPasswordReset: (input) => raw.api.requestPasswordReset(input),
      },
      createCredentialUser: (email, name, password, emailVerified = false, correlateInTransaction) =>
        raw.$context.then((ctx) =>
          createCredentialUserWith(ctx, db, email, name, password, emailVerified, correlateInTransaction),
        ),
      deleteCredentialUser: (userId) => raw.$context.then((ctx) => ctx.internalAdapter.deleteUser(userId)),
      revokeUserSessions: (userId) => raw.$context.then((ctx) => ctx.internalAdapter.deleteUserSessions(userId)),
      setSessionDeletionLifecycle(lifecycle) {
        sessionDeletionLifecycleRef.current = lifecycle;
      },
      async beginFederatedLink({ headers, principalId, callbackURL, errorCallbackURL }) {
        if (!strictProvider) {
          throw APIError.from("BAD_REQUEST", {
            message: "No strict OIDC provider is configured for account linking.",
            code: "PROVIDER_NOT_FOUND",
          });
        }
        // A previous callback may have committed its provider row immediately before a process stop.
        // Repair that durable observation before starting another mutating link ceremony. Readiness
        // reads remain side-effect free.
        auth.reconcileFederatedLinks?.();
        const session = await activeSession(headers);
        if (!session || String(session.user.id) !== principalId) {
          throw APIError.from("UNAUTHORIZED", {
            message: "The identity-link session no longer matches the signed-in user.",
            code: "SESSION_EXPIRED",
          });
        }
        const existingLinks = db
          .prepare(`SELECT id FROM account WHERE userId = ? AND providerId = ? ORDER BY id LIMIT 2`)
          .all(principalId, strictProvider.id) as Array<{ id: string }>;
        if (existingLinks.length > 0) {
          throw APIError.from("CONFLICT", {
            message:
              existingLinks.length === 1
                ? "This identity provider is already connected."
                : "Multiple provider links require stopped-server repair before reconnecting.",
            code: existingLinks.length === 1 ? "PROVIDER_ALREADY_LINKED" : "MULTIPLE_PROVIDER_LINKS",
          });
        }
        const ceremonyId = randomBytes(24).toString("base64url");
        const success = linkReturnUrl(callbackURL, "capacitylensSsoLinked", ceremonyId);
        const failure = linkReturnUrl(errorCallbackURL, "capacitylensSsoLinkFailed", ceremonyId);
        const ceremony = createFederatedLinkCeremony(db, principalId, strictProvider.id, ceremonyId, () =>
          revokeFederatedLinkStateInTx(db, principalId),
        );
        const requestHeaders = new Headers(headers);
        requestHeaders.set("content-type", "application/json");
        const response = await raw.handler(
          new Request(new URL("/api/auth/oauth2/link", publicUrl), {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              providerId: strictProvider.id,
              callbackURL: success.toString(),
              errorCallbackURL: failure.toString(),
            }),
          }),
        );
        const body: unknown = await response.json().catch(() => null);
        const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
        if (!response.ok || typeof url !== "string") {
          deleteFederatedLinkCeremony(db, ceremony.id);
          throw APIError.from("BAD_GATEWAY", {
            message: "The identity provider could not start the link ceremony.",
            code: "PROVIDER_UNAVAILABLE",
          });
        }
        return { url, setCookies: response.headers.getSetCookie() };
      },
      reconcileFederatedLinks() {
        reconcileObservedFederatedLinks(db, application.applicationId, () => verifiedUnauditedFederatedLinks(db));
      },
    };
    return auth;
  }

  return createAuthAdapter;
}
