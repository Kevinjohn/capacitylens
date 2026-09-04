import type { FastifyInstance, HTTPMethods, InjectOptions, RouteOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";

const EXPECTED_ROUTES = [
  "DELETE /api/:entity/:id",
  "DELETE /api/account/sessions/:sessionId",
  "DELETE /api/accounts/:accountId/invites/:id",
  "DELETE /api/accounts/:accountId/members/:userId",
  "DELETE /api/accounts/:id",
  "DELETE /api/masquerade",
  "GET /api/account/sessions",
  "GET /api/accounts",
  "GET /api/accounts/:accountId/invites",
  "GET /api/accounts/:accountId/members",
  "GET /api/auth/me",
  "GET /api/health",
  "GET /api/invites/:token/preview",
  "GET /api/masquerade",
  "GET /api/meta",
  "GET /api/state",
  "HEAD /api/account/sessions",
  "HEAD /api/accounts",
  "HEAD /api/accounts/:accountId/invites",
  "HEAD /api/accounts/:accountId/members",
  "HEAD /api/auth/me",
  "HEAD /api/health",
  "HEAD /api/invites/:token/preview",
  "HEAD /api/masquerade",
  "HEAD /api/meta",
  "HEAD /api/state",
  "PATCH /api/:entity/:id",
  "PATCH /api/accounts/:accountId/members/:userId",
  "PATCH /api/accounts/:accountId/members/:userId/status",
  "PATCH /api/accounts/:id",
  "POST /api/:entity",
  "POST /api/:entity/:id/archive",
  "POST /api/:entity/:id/delete",
  "POST /api/:entity/:id/purge",
  "POST /api/:entity/:id/unarchive",
  "POST /api/account-commands/reconcile",
  "POST /api/account/sign-out",
  "POST /api/accounts",
  "POST /api/accounts/:accountId/masquerade",
  "POST /api/accounts/:accountId/members/:userId/reset-password",
  "POST /api/accounts/:accountId/members/:userId/revoke-sessions",
  "POST /api/accounts/:accountId/transfer-ownership",
  "POST /api/batch",
  "POST /api/import",
  "POST /api/invites",
  "POST /api/invites/:token/accept",
  "POST /api/invites/:token/signup",
  "POST /api/orgs",
  "POST /api/security/csp-report",
  "POST /api/test/reset",
  "PUT /api/:entity/:id",
  "PUT /api/accounts/:accountId/member-sign-in-tracking",
  "PUT /api/accounts/:id",
].sort();

function methods(method: HTTPMethods | HTTPMethods[]): HTTPMethods[] {
  return Array.isArray(method) ? method : [method];
}

function buildTrackedApp(): { app: FastifyInstance; registeredRoutes: string[] } {
  const registeredRoutes: string[] = [];
  const app = buildApp(openDb(":memory:"), {
    allowReset: true,
    optimisticConcurrency: false,
    rateLimit: 2,
  });
  app.addHook("onRoute", (routeOptions: RouteOptions) => {
    for (const method of methods(routeOptions.method)) {
      registeredRoutes.push(`${method} ${routeOptions.url}`);
    }
  });
  return { app, registeredRoutes };
}

describe("buildApp route registration", () => {
  it("registers the complete route tree", async () => {
    const { app, registeredRoutes } = buildTrackedApp();

    await app.ready();

    expect(registeredRoutes.sort()).toEqual(EXPECTED_ROUTES);
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
