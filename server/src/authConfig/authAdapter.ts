import { randomBytes } from "node:crypto";
import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import type * as AuthFacade from "../auth";
import { bindFederatedProvider } from "../accounts/state";
import { buildApplicationSessionHandle } from "../accounts/buildApplicationSessionHandle";
import {
  createFederatedLinkCeremony,
  deleteFederatedLinkCeremony,
  reconcileObservedFederatedLinks,
} from "../federatedLinkLifecycle";
import { buildProviders } from "./providers";
import { createErrorRedirect } from "./errorRedirect";
import type { Auth, AuthProviderInfo, RawSessionUser } from "./authTypes";
import { SESSION_ABSOLUTE_TTL_SECONDS } from "./authConstants";
import { buildSessionUser } from "./sessionActivity";
import { verifiedUnauditedFederatedLinks, sqliteTableExists } from "./federatedIdentitySchema";
import { createCredentialUserWith } from "./bootstrapAdmin";
import { createAuthRequestHandler } from "./authRequestHandler";

type AdapterFactoryDependencies = {
  revokeFederatedLinkStateInTx: typeof AuthFacade.revokeFederatedLinkStateInTx;
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  providerIdFromExternalContext: typeof AuthFacade.parseProviderIdFromExternalContext;
};
type LifecycleRef = {
  current: {
    prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
    prepareUser(userId: string, reason: "session_revoked"): readonly string[];
    commit(sessionHandles: readonly string[]): void;
  } | null;
};
type AdapterOptions = {
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
  sessionDeletionLifecycleRef: LifecycleRef;
};
type RawAuth = {
  handler: Auth["handler"];
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: RawSessionUser;
      session: { createdAt: Date | string; updatedAt: Date | string; token: string };
    } | null>;
    requestPasswordReset: Auth["api"]["requestPasswordReset"];
  };
  options: BetterAuthOptions;
  $context: Promise<{
    password: { hash(password: string): Promise<string> };
    internalAdapter: {
      deleteUser(userId: string): Promise<void>;
      deleteUserSessions(userId: string): Promise<void>;
    };
  }>;
};

function buildTrustedOrigins(
  options: AdapterOptions,
  AuthConfigError: AdapterFactoryDependencies["AuthConfigError"],
): Set<string> {
  return new Set([
    options.publicUrl.origin,
    ...(options.trustedOrigins ?? []).map((value) => {
      try {
        return new URL(value).origin;
      } catch (cause) {
        throw new AuthConfigError(`Trusted origin ${JSON.stringify(value)} must be an absolute URL.`, { cause });
      }
    }),
  ]);
}

function parseLinkReturnUrl(options: {
  value: string;
  parameter: string;
  ceremonyId: string;
  trustedOrigins: Set<string>;
}): URL {
  let url: URL;
  try {
    url = new URL(options.value);
  } catch {
    throw APIError.from("BAD_REQUEST", {
      message: "The identity-link return URL is invalid.",
      code: "INVALID_CALLBACK_URL",
    });
  }
  if (!options.trustedOrigins.has(url.origin) || url.username || url.password) {
    throw APIError.from("FORBIDDEN", {
      message: "The identity-link return URL is not a trusted browser origin.",
      code: "INVALID_CALLBACK_URL",
    });
  }
  url.searchParams.set(options.parameter, options.ceremonyId);
  return url;
}

function createBindingMethods(options: AdapterOptions) {
  return {
    ensureProviderBindings: () => {
      for (const [providerId, issuer] of options.configuredFederatedIssuers) {
        bindFederatedProvider({ db: options.db, applicationId: options.application.applicationId, issuer, providerId });
      }
    },
    assertProviderBindings: () => {
      for (const [providerId, issuer] of options.configuredFederatedIssuers) {
        const rows = options.db
          .prepare(
            `SELECT issuer, providerId
          FROM account_federated_provider_bindings
          WHERE applicationId = ? AND (issuer = ? OR providerId = ?)`,
          )
          .all(options.application.applicationId, issuer, providerId) as Array<{ issuer: string; providerId: string }>;
        const binding = rows[0];
        if (!binding || rows.length !== 1 || binding.issuer !== issuer || binding.providerId !== providerId) {
          throw new Error(`Persisted provider binding does not match configured provider ${providerId}.`);
        }
      }
    },
  };
}

function createAdapterApi(options: AdapterOptions, raw: RawAuth): Auth["api"] {
  return {
    async getSession(input) {
      // raw.api.getSession runs through the same hooks.before pipeline as HTTP routes, so the
      // session is already idle-checked and touched once before this provider-neutral adapter.
      const session = await raw.api.getSession({ headers: input.headers });
      if (!session) return null;
      return {
        user: {
          ...buildSessionUser(session.user),
          sessionCreatedAt: new Date(session.session.createdAt).toISOString(),
        },
        session: {
          // Better Auth exposes the bearer token rather than its database row id here. Hash it
          // before it crosses our identity boundary; callers receive a stable opaque handle,
          // never a credential that could authenticate a request.
          id: buildApplicationSessionHandle(options.application.applicationId, session.session.token),
          createdAt: new Date(session.session.createdAt).toISOString(),
          expiresAt: new Date(
            new Date(session.session.createdAt).getTime() + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
          ).toISOString(),
        },
      };
    },
    // Better Auth's endpoints resolve their context via `this`.
    requestPasswordReset: (input) => raw.api.requestPasswordReset(input),
  };
}

function assertStrictProvider(provider: AuthProviderInfo | null): AuthProviderInfo {
  if (!provider)
    throw APIError.from("BAD_REQUEST", {
      message: "No strict OIDC provider is configured for account linking.",
      code: "PROVIDER_NOT_FOUND",
    });
  return provider;
}

function assertProviderLinkAbsent(options: AdapterOptions, provider: AuthProviderInfo, principalId: string): void {
  const links = options.db
    .prepare(`SELECT id FROM account WHERE userId = ? AND providerId = ? ORDER BY id LIMIT 2`)
    .all(principalId, provider.id) as Array<{ id: string }>;
  if (links.length > 0)
    throw APIError.from("CONFLICT", {
      message:
        links.length === 1
          ? "This identity provider is already connected."
          : "Multiple provider links require stopped-server repair before reconnecting.",
      code: links.length === 1 ? "PROVIDER_ALREADY_LINKED" : "MULTIPLE_PROVIDER_LINKS",
    });
}

async function readLinkResponse(response: Response, db: Db, ceremonyId: string) {
  const body: unknown = await response.json().catch(() => null);
  const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
  if (response.ok && typeof url === "string") return { url, setCookies: response.headers.getSetCookie() };
  deleteFederatedLinkCeremony(db, ceremonyId);
  throw APIError.from("BAD_GATEWAY", {
    message: "The identity provider could not start the link ceremony.",
    code: "PROVIDER_UNAVAILABLE",
  });
}

async function beginLink(
  input: Parameters<NonNullable<Auth["beginFederatedLink"]>>[0],
  context: {
    options: AdapterOptions;
    dependencies: AdapterFactoryDependencies;
    raw: RawAuth;
    provider: AuthProviderInfo | null;
    trustedOrigins: Set<string>;
    reconcile(): void;
  },
) {
  const provider = assertStrictProvider(context.provider);
  // A previous callback may have committed its provider row immediately before a process stop.
  // Repair that durable observation before starting another mutating link ceremony. Readiness
  // reads remain side-effect free.
  context.reconcile();
  const session = await context.raw.api.getSession({ headers: input.headers });
  if (!session || String(session.user.id) !== input.principalId)
    throw APIError.from("UNAUTHORIZED", {
      message: "The identity-link session no longer matches the signed-in user.",
      code: "SESSION_EXPIRED",
    });
  assertProviderLinkAbsent(context.options, provider, input.principalId);
  const ceremonyId = randomBytes(24).toString("base64url");
  const success = parseLinkReturnUrl({
    value: input.callbackURL,
    parameter: "capacitylensSsoLinked",
    ceremonyId,
    trustedOrigins: context.trustedOrigins,
  });
  const failure = parseLinkReturnUrl({
    value: input.errorCallbackURL,
    parameter: "capacitylensSsoLinkFailed",
    ceremonyId,
    trustedOrigins: context.trustedOrigins,
  });
  const ceremony = createFederatedLinkCeremony({
    db: context.options.db,
    principalId: input.principalId,
    providerId: provider.id,
    ceremonyId,
    revokeSupersededProviderStateInTransaction: () =>
      context.dependencies.revokeFederatedLinkStateInTx(context.options.db, input.principalId),
  });
  const headers = new Headers(input.headers);
  headers.set("content-type", "application/json");
  const response = await context.raw.handler(
    new Request(new URL("/api/auth/oauth2/link", context.options.publicUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: provider.id,
        callbackURL: success.toString(),
        errorCallbackURL: failure.toString(),
      }),
    }),
  );
  return readLinkResponse(response, context.options.db, ceremony.id);
}

function createAuthAdapter(options: AdapterOptions, dependencies: AdapterFactoryDependencies): Auth {
  // Collapse the invariant generic to the structural Auth surface (see Auth), AND normalize at
  // this single narrowing boundary (P1.7a): Better Auth's full user carries the richer fields we
  // drop here, so this is exactly where `emailVerified` is read and defaulted before everything
  // downstream sees only the {id,email,emailVerified,name} SessionUser.
  // Better Auth's async init context (reverified against better-auth 1.6.23,
  // dist/auth/base.mjs:37 `$context: authContext`, dist/db/internal-adapter.mjs for deletion, and
  // dist/context/create-context.mjs for `password.hash`). Read only through the narrow Auth
  // methods below.
  const raw = options.instance as RawAuth;
  const provider = options.configuredProviderInfo.find((candidate) => candidate.kind === "oidc") ?? null;
  const trustedOrigins = buildTrustedOrigins(options, dependencies.AuthConfigError);
  // The verification lookup stays here so identity SQL keeps a single owner (see the account
  // boundary conformance test); the builder only decides what to do with the rows.
  const callbackErrorUrl = createErrorRedirect({
    browserAuthErrorUrl: options.browserAuthErrorUrl,
    trustedLinkOrigins: trustedOrigins,
    readVerificationValues: (identifier) => {
      if (!sqliteTableExists(options.db, "verification")) return null;
      const rows = options.db
        .prepare(`SELECT value FROM verification WHERE identifier = ? LIMIT 2`)
        .all(identifier) as Array<{ value: string }>;
      return rows.map((row) => row.value);
    },
  });
  const reconcile = () =>
    reconcileObservedFederatedLinks(options.db, options.application.applicationId, () =>
      verifiedUnauditedFederatedLinks(options.db),
    );
  const handler = createAuthRequestHandler({
    rawHandler: raw.handler,
    providerIdFromExternalContext: dependencies.providerIdFromExternalContext,
    callbackErrorUrl,
    browserAuthErrorUrl: options.browserAuthErrorUrl,
    strictOidcClient: options.strictOidcClient,
    strictOidcAuthorizationProxyPath: options.strictOidcAuthorizationProxyPath,
    commitResetSessions: (handles) => options.sessionDeletionLifecycleRef.current?.commit(handles),
    reconcileFederatedLinks: reconcile,
  });
  return {
    handler,
    options: raw.options,
    providers: options.configuredProviderInfo,
    federatedIssuers: options.configuredFederatedIssuers,
    strictProvider: provider,
    ...createBindingMethods(options),
    api: createAdapterApi(options, raw),
    createCredentialUser: ({ email, name, password, emailVerified = false, correlateInTransaction }) =>
      raw.$context.then((context) =>
        createCredentialUserWith({
          context,
          db: options.db,
          email,
          name,
          password,
          emailVerified,
          correlateInTransaction,
        }),
      ),
    deleteCredentialUser: (userId) => raw.$context.then((context) => context.internalAdapter.deleteUser(userId)),
    revokeUserSessions: (userId) => raw.$context.then((context) => context.internalAdapter.deleteUserSessions(userId)),
    setSessionDeletionLifecycle: (lifecycle) => {
      options.sessionDeletionLifecycleRef.current = lifecycle;
    },
    beginFederatedLink: (input) =>
      beginLink(input, { options, dependencies, raw, provider, trustedOrigins, reconcile }),
    reconcileFederatedLinks: reconcile,
  };
}

// The reset-state SQL stays in the facade; bind it without a runtime back-edge.
export function createAuthAdapterFactory(dependencies: AdapterFactoryDependencies) {
  return (options: AdapterOptions): Auth => createAuthAdapter(options, dependencies);
}
