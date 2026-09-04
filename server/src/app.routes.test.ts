import type { FastifyInstance, HTTPMethods, InjectOptions, RouteOptions } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import type { Auth } from "./auth";
import { openDb } from "./db";

const { rootHookRegistrations } = vi.hoisted(() => ({
  rootHookRegistrations: new WeakMap<object, Map<string, string[]>>(),
}));

vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>();
  const trackedFastify = ((...args: unknown[]) => {
    const app = Reflect.apply(actual.default, undefined, args) as FastifyInstance;
    const registrations = new Map<string, string[]>();
    const addHook = app.addHook.bind(app);
    app.addHook = ((name: string, hook: (...args: unknown[]) => unknown) => {
      const hooks = registrations.get(name) ?? [];
      hooks.push(hook.name);
      registrations.set(name, hooks);
      return Reflect.apply(addHook, app, [name, hook]) as FastifyInstance;
    }) as typeof app.addHook;
    rootHookRegistrations.set(app, registrations);
    return app;
  }) as typeof actual.default;
  Object.assign(trackedFastify, actual.default);
  return { ...actual, default: trackedFastify };
});

const EXPECTED_OFF_ROUTES = [
  "POST /api/security/csp-report",
  "GET /api/health",
  "HEAD /api/health",
  "GET /api/auth/me",
  "HEAD /api/auth/me",
  "GET /api/accounts",
  "HEAD /api/accounts",
  "GET /api/state",
  "HEAD /api/state",
  "GET /api/meta",
  "HEAD /api/meta",
  "POST /api/orgs",
  "POST /api/account-commands/reconcile",
  "POST /api/account/sign-out",
  "GET /api/account/sessions",
  "HEAD /api/account/sessions",
  "DELETE /api/account/sessions/:sessionId",
  "POST /api/invites",
  "GET /api/invites/:token/preview",
  "HEAD /api/invites/:token/preview",
  "POST /api/invites/:token/accept",
  "POST /api/invites/:token/signup",
  "GET /api/accounts/:accountId/members",
  "HEAD /api/accounts/:accountId/members",
  "PUT /api/accounts/:accountId/member-sign-in-tracking",
  "PATCH /api/accounts/:accountId/members/:userId",
  "PATCH /api/accounts/:accountId/members/:userId/status",
  "DELETE /api/accounts/:accountId/members/:userId",
  "POST /api/accounts/:accountId/transfer-ownership",
  "POST /api/accounts/:accountId/members/:userId/reset-password",
  "POST /api/accounts/:accountId/members/:userId/revoke-sessions",
  "GET /api/accounts/:accountId/invites",
  "HEAD /api/accounts/:accountId/invites",
  "DELETE /api/accounts/:accountId/invites/:id",
  "POST /api/accounts/:accountId/masquerade",
  "GET /api/masquerade",
  "HEAD /api/masquerade",
  "DELETE /api/masquerade",
  "POST /api/:entity/:id/archive",
  "POST /api/:entity/:id/unarchive",
  "POST /api/:entity/:id/delete",
  "POST /api/:entity/:id/purge",
  "POST /api/accounts",
  "PUT /api/accounts/:id",
  "PATCH /api/accounts/:id",
  "DELETE /api/accounts/:id",
  "POST /api/:entity",
  "PUT /api/:entity/:id",
  "PATCH /api/:entity/:id",
  "DELETE /api/:entity/:id",
  "POST /api/batch",
  "POST /api/import",
  "POST /api/test/reset",
];

const EXPECTED_AUTH_ROUTES = [
  "POST /api/security/csp-report",
  "GET /api/health",
  "HEAD /api/health",
  "GET /api/auth/me",
  "HEAD /api/auth/me",
  "GET /api/identity/provider",
  "HEAD /api/identity/provider",
  "POST /api/identity/link-provider",
  "GET /api/accounts/:accountId/sso-readiness",
  "HEAD /api/accounts/:accountId/sso-readiness",
  "PATCH /api/accounts/:accountId/members/:userId/email",
  "DELETE /api/accounts/:accountId/members/:userId/federated-link",
  "GET /api/auth/*",
  "POST /api/auth/*",
  "HEAD /api/auth/*",
  "GET /api/accounts",
  "HEAD /api/accounts",
  "GET /api/state",
  "HEAD /api/state",
  "GET /api/meta",
  "HEAD /api/meta",
  "POST /api/orgs",
  "POST /api/account-commands/reconcile",
  "POST /api/account/sign-out",
  "GET /api/account/sessions",
  "HEAD /api/account/sessions",
  "DELETE /api/account/sessions/:sessionId",
  "POST /api/invites",
  "GET /api/invites/:token/preview",
  "HEAD /api/invites/:token/preview",
  "POST /api/invites/:token/accept",
  "POST /api/invites/:token/signup",
  "GET /api/accounts/:accountId/members",
  "HEAD /api/accounts/:accountId/members",
  "PUT /api/accounts/:accountId/member-sign-in-tracking",
  "PATCH /api/accounts/:accountId/members/:userId",
  "PATCH /api/accounts/:accountId/members/:userId/status",
  "DELETE /api/accounts/:accountId/members/:userId",
  "POST /api/accounts/:accountId/transfer-ownership",
  "POST /api/accounts/:accountId/members/:userId/reset-password",
  "POST /api/accounts/:accountId/members/:userId/revoke-sessions",
  "GET /api/accounts/:accountId/invites",
  "HEAD /api/accounts/:accountId/invites",
  "DELETE /api/accounts/:accountId/invites/:id",
  "POST /api/accounts/:accountId/masquerade",
  "GET /api/masquerade",
  "HEAD /api/masquerade",
  "DELETE /api/masquerade",
  "POST /api/:entity/:id/archive",
  "POST /api/:entity/:id/unarchive",
  "POST /api/:entity/:id/delete",
  "POST /api/:entity/:id/purge",
  "POST /api/accounts",
  "PUT /api/accounts/:id",
  "PATCH /api/accounts/:id",
  "DELETE /api/accounts/:id",
  "POST /api/:entity",
  "PUT /api/:entity/:id",
  "PATCH /api/:entity/:id",
  "DELETE /api/:entity/:id",
  "POST /api/batch",
  "POST /api/import",
  "POST /api/test/reset",
];

const EXPECTED_ROOT_HOOKS = {
  onRequest: ["", "helmetConfigureReply", "helmetApplyHeaders", ""],
  preHandler: [""],
  onSend: [""],
  onResponse: [""],
  onClose: [""],
};

function methods(method: HTTPMethods | HTTPMethods[]): HTTPMethods[] {
  return Array.isArray(method) ? method : [method];
}

function stubAuth(): Auth {
  return {
    handler: async () => new Response(null),
    api: {
      getSession: async () => null,
      requestPasswordReset: async () => ({ status: true }),
    },
    options: {},
    providers: [],
    federatedIssuers: new Map(),
    ensureProviderBindings: () => {},
    revokeUserSessions: async () => {},
    createCredentialUser: async () => ({ id: "route-test-user" }),
    deleteCredentialUser: async () => {},
  };
}

function buildTrackedApp(auth: Auth | null = null): { app: FastifyInstance; registeredRoutes: string[] } {
  const registeredRoutes: string[] = [];
  const app = buildApp(openDb(":memory:"), {
    allowReset: true,
    optimisticConcurrency: false,
    rateLimit: 2,
    ...(auth ? { authMode: "password", auth } : {}),
  });
  app.addHook("onRoute", (routeOptions: RouteOptions) => {
    for (const method of methods(routeOptions.method)) {
      registeredRoutes.push(`${method} ${routeOptions.url}`);
    }
  });
  return { app, registeredRoutes };
}

function rootHookNames(app: FastifyInstance): typeof EXPECTED_ROOT_HOOKS {
  const hookStoreSymbol = Object.getOwnPropertySymbols(app).find(
    (candidate) => candidate.description === "fastify.hooks",
  );
  if (!hookStoreSymbol) throw new Error("Fastify hook store was not found");
  const hookStore = app[hookStoreSymbol as keyof FastifyInstance] as unknown as Record<
    string,
    Array<(...args: never[]) => unknown>
  >;
  const onClose = rootHookRegistrations.get(app)?.get("onClose");
  if (!onClose) throw new Error("Fastify onClose hook registration was not captured");
  return {
    onRequest: hookStore.onRequest!.map((hook) => hook.name),
    preHandler: hookStore.preHandler!.map((hook) => hook.name),
    onSend: hookStore.onSend!.map((hook) => hook.name),
    onResponse: hookStore.onResponse!.map((hook) => hook.name),
    onClose,
  };
}

describe("buildApp route registration", () => {
  it("registers the complete route tree in order with authentication off", async () => {
    const { app, registeredRoutes } = buildTrackedApp();

    await app.ready();

    expect(registeredRoutes).toEqual(EXPECTED_OFF_ROUTES);
    await app.close();
  });

  it("registers the complete route tree in order with authentication enabled", async () => {
    const { app, registeredRoutes } = buildTrackedApp(stubAuth());

    await app.ready();

    expect(registeredRoutes).toEqual(EXPECTED_AUTH_ROUTES);
    await app.close();
  });

  it("keeps root hooks in lifecycle order", async () => {
    const { app } = buildTrackedApp();

    await app.ready();

    expect(rootHookNames(app)).toEqual(EXPECTED_ROOT_HOOKS);
    await app.close();
  });

  it.each<[string, InjectOptions]>([
    ["systemRoutes", { method: "GET", url: "/api/meta" }],
    ["authProxyRoutes", { method: "GET", url: "/api/auth/me" }],
    ["stateRoutes", { method: "GET", url: "/api/state" }],
    ["entityRoutes", { method: "POST", url: "/api/clients" }],
    ["batchRoutes", { method: "POST", url: "/api/batch" }],
    ["importRoutes", { method: "POST", url: "/api/import" }],
  ])("keeps %s inside the rate-limited child scope", async (_module, request) => {
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      optimisticConcurrency: false,
      rateLimit: 2,
    });

    expect((await app.inject(request)).statusCode).not.toBe(429);
    expect((await app.inject(request)).statusCode).not.toBe(429);
    expect((await app.inject(request)).statusCode).toBe(429);
    await app.close();
  });
});
