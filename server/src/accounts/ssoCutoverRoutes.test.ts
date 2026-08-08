import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort } from "./sqliteAccountAdminPort";
import { registerSsoCutoverRoutes } from "./ssoCutoverRoutes";

describe("SSO cutover routes", () => {
  it("uses the principal-scoped provider query and treats duplicate rows as connected repair state", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.user = { id: "principal-1" } as never;
    });
    const inspectProviderLinks = vi.fn(() => [
      { rowId: "link-1", subject: "subject-1", verified: true },
      { rowId: "link-2", subject: "subject-2", verified: true },
    ]);
    const inspectSsoCutover = vi.fn(() => {
      throw new Error("full inventory must not run");
    });
    registerSsoCutoverRoutes(app, {
      auth: {
        strictProvider: { id: "workforce", label: "Workforce", kind: "oidc", experimental: false },
      } as Auth,
      authMode: "password",
      identity: { inspectProviderLinks, inspectSsoCutover } as unknown as SsoCutoverIdentityPort,
      administration: {} as SsoCutoverAccountAdminPort,
      applicationId: "capacitylens",
      openSignup: false,
      authorize: () => true,
      fail: (_reply, error) => {
        throw error;
      },
      toWebHeaders: () => new Headers(),
    });

    const response = await app.inject({ method: "GET", url: "/api/identity/provider" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ connected: true, verified: false });
    expect(inspectProviderLinks).toHaveBeenCalledWith("principal-1", "workforce");
    expect(inspectSsoCutover).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects credential rows before the federated-link repair port", async () => {
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.user = { id: "owner-1" } as never;
      request.accountActor = { principalId: "owner-1", fresh: true } as never;
    });
    const removeFederatedLink = vi.fn();
    registerSsoCutoverRoutes(app, {
      auth: {
        strictProvider: { id: "workforce", label: "Workforce", kind: "oidc", experimental: false },
      } as Auth,
      authMode: "password",
      identity: { removeFederatedLink } as unknown as SsoCutoverIdentityPort,
      administration: {} as SsoCutoverAccountAdminPort,
      applicationId: "capacitylens",
      openSignup: false,
      authorize: () => true,
      fail: (_reply, error) => {
        throw error;
      },
      toWebHeaders: () => new Headers(),
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: { rowId: "credential-1", providerId: "credential", subject: "member-1" },
    });

    expect(response.statusCode).toBe(400);
    expect(removeFederatedLink).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {
      name: "email correction",
      method: "PATCH" as const,
      url: "/api/accounts/workspace-1/members/member-1/email",
      payload: { email: "corrected@example.com" },
      action: "correct-email",
    },
    {
      name: "provider-link removal",
      method: "DELETE" as const,
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
      action: "remove-federated-link",
    },
  ])("reconfirms requested-workspace authority inside the $name transaction", async (testCase) => {
    const app = Fastify();
    app.addHook("preHandler", async (request) => {
      request.user = { id: "owner-1" } as never;
      request.accountActor = { principalId: "owner-1", fresh: true } as never;
    });
    const assertIdentityRepairAuthorityInTx = vi.fn();
    const evaluateIdentityAdminAuthority = vi.fn(async () => ({
      allowed: true as const,
      revision: "revision-1" as never,
      policyVersion: "policy-1" as never,
    }));
    const correctPrincipalEmail = vi.fn(async (input: { authorizeInTransaction(): void }) => {
      input.authorizeInTransaction();
    });
    const removeFederatedLink = vi.fn(async (input: { authorizeInTransaction(): void }) => {
      input.authorizeInTransaction();
      return true;
    });
    registerSsoCutoverRoutes(app, {
      auth: {
        strictProvider: { id: "workforce", label: "Workforce", kind: "oidc", experimental: false },
      } as Auth,
      authMode: "password",
      identity: { correctPrincipalEmail, removeFederatedLink } as unknown as SsoCutoverIdentityPort,
      administration: {
        evaluateIdentityAdminAuthority,
        assertIdentityRepairAuthorityInTx,
      } as unknown as SsoCutoverAccountAdminPort,
      applicationId: "capacitylens",
      openSignup: false,
      authorize: () => true,
      fail: (_reply, error) => {
        throw error;
      },
      toWebHeaders: () => new Headers(),
    });

    const response = await app.inject({ method: testCase.method, url: testCase.url, payload: testCase.payload });

    expect(response.statusCode).toBe(204);
    expect(assertIdentityRepairAuthorityInTx).toHaveBeenCalledWith({
      actor: { principalId: "owner-1", fresh: true },
      workspaceId: "workspace-1",
      targetPrincipalId: "member-1",
      action: testCase.action,
      expectedRevision: "revision-1",
    });
    await app.close();
  });
});
