import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AccountContractError, statusForAccountFailure } from "@capacitylens/shared/account/errors";
import type { Auth } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort } from "./sqliteAccountAdminPort";
import { registerSsoCutoverRoutes } from "./ssoCutoverRoutes";

const provider = { id: "workforce", label: "Workforce", kind: "oidc", experimental: false } as const;

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    auth: { strictProvider: provider, providers: [provider] } as Auth,
    authMode: "password" as const,
    identity: {} as SsoCutoverIdentityPort,
    administration: {} as SsoCutoverAccountAdminPort,
    applicationId: "capacitylens",
    openSignup: false,
    authorize: () => true,
    fail: (reply: Parameters<Parameters<typeof registerSsoCutoverRoutes>[1]["fail"]>[0], error: unknown) => {
      if (error instanceof AccountContractError) {
        return reply.code(statusForAccountFailure(error.failure)).send(error.failure);
      }
      return reply.code(503).send({ error: "mapped dependency failure" });
    },
    toWebHeaders: () => new Headers(),
    ...overrides,
  } as Parameters<typeof registerSsoCutoverRoutes>[1];
}

function authenticatedApp(overrides: Record<string, unknown> = {}) {
  const app = Fastify();
  app.addHook("preHandler", async (request) => {
    request.user = { id: "owner-1" } as never;
    request.accountActor = { principalId: "owner-1", fresh: true } as never;
  });
  registerSsoCutoverRoutes(app, routeDependencies(overrides));
  return app;
}

describe("SSO cutover routes", () => {
  it("returns 404 when no strict provider is configured and maps provider inspection failures", async () => {
    const withoutProvider = authenticatedApp({ auth: {} as Auth });
    expect((await withoutProvider.inject({ method: "GET", url: "/api/identity/provider" })).statusCode).toBe(404);
    await withoutProvider.close();

    const inspectProviderLinks = vi.fn(() => {
      throw new Error("database detail");
    });
    const failing = authenticatedApp({ identity: { inspectProviderLinks } as unknown as SsoCutoverIdentityPort });
    const response = await failing.inject({ method: "GET", url: "/api/identity/provider" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "mapped dependency failure" });
    await failing.close();
  });

  it("requires a fresh session and string callback URLs before beginning a provider link", async () => {
    const beginFederatedLink = vi.fn();
    const stale = Fastify();
    stale.addHook("preHandler", async (request) => {
      request.user = { id: "owner-1" } as never;
      request.accountActor = { principalId: "owner-1", fresh: false } as never;
    });
    registerSsoCutoverRoutes(
      stale,
      routeDependencies({ auth: { strictProvider: provider, beginFederatedLink } as unknown as Auth }),
    );
    const staleResponse = await stale.inject({
      method: "POST",
      url: "/api/identity/link-provider",
      payload: { callbackURL: "https://app.test/ok", errorCallbackURL: "https://app.test/error" },
    });
    expect(staleResponse.statusCode).toBe(403);
    expect(staleResponse.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    await stale.close();

    const app = authenticatedApp({ auth: { strictProvider: provider, beginFederatedLink } as unknown as Auth });
    for (const payload of [
      { callbackURL: 1, errorCallbackURL: "https://app.test/error" },
      { callbackURL: "https://app.test/ok", errorCallbackURL: {} },
    ]) {
      expect((await app.inject({ method: "POST", url: "/api/identity/link-provider", payload })).statusCode).toBe(400);
    }
    expect(beginFederatedLink).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["SESSION_EXPIRED", 401],
    ["INVALID_CALLBACK_URL", 400],
    ["PROVIDER_NOT_FOUND", 400],
    ["PROVIDER_ALREADY_LINKED", 409],
    ["MULTIPLE_PROVIDER_LINKS", 409],
    ["PROVIDER_UNAVAILABLE", 502],
    ["SOMETHING_NEW", 500],
  ])("maps beginFederatedLink %s failures to %i", async (code, status) => {
    const beginFederatedLink = vi.fn(async () => {
      throw { body: { code, message: `failure ${code}` } };
    });
    const app = authenticatedApp({ auth: { strictProvider: provider, beginFederatedLink } as unknown as Auth });
    const response = await app.inject({
      method: "POST",
      url: "/api/identity/link-provider",
      payload: { callbackURL: "https://app.test/ok", errorCallbackURL: "https://app.test/error" },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual(
      status === 500
        ? { error: "The identity-provider connection could not be started." }
        : { error: `failure ${code}`, code },
    );
    await app.close();
  });

  it("enforces readiness authorization and provider configuration before inventory reads", async () => {
    const authorize = vi.fn(() => false);
    const identity = { readSsoCutoverSnapshot: vi.fn() } as unknown as SsoCutoverIdentityPort;
    const refused = authenticatedApp({ authorize, identity });
    expect((await refused.inject({ method: "GET", url: "/api/accounts/workspace-1/sso-readiness" })).statusCode).toBe(
      200,
    );
    expect(authorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), "workspace-1", "manageMembers");
    expect(identity.readSsoCutoverSnapshot).not.toHaveBeenCalled();
    await refused.close();

    const noProvider = authenticatedApp({ auth: {} as Auth, identity });
    expect(
      (await noProvider.inject({ method: "GET", url: "/api/accounts/workspace-1/sso-readiness" })).statusCode,
    ).toBe(400);
    expect(identity.readSsoCutoverSnapshot).not.toHaveBeenCalled();
    await noProvider.close();
  });

  it("does not disclose absent or other workspaces and collapses principal-scoped issues", async () => {
    const identity = {
      readSsoCutoverSnapshot: (read: () => unknown) => read(),
      inspectSsoCutover: () => ({
        principals: [
          { id: "owner-1", email: "owner@example.com", displayName: "Owner", providerIds: ["workforce"] },
          { id: "secret-principal", email: "secret@example.com", displayName: "Secret", providerIds: [] },
        ],
        requiredProviderLinks: [{ rowId: "link-1", principalId: "owner-1", subject: "subject-1", verified: true }],
        alternativeProviderLinks: [],
        outstandingResetPrincipalIds: [],
      }),
    } as unknown as SsoCutoverIdentityPort;
    const administration = {
      inspectSsoCutoverWorkspaces: () => [
        {
          workspaceId: "workspace-1",
          workspaceName: "Visible",
          members: [{ principalId: "owner-1", role: "owner", status: "active" }],
        },
        {
          workspaceId: "secret-workspace",
          workspaceName: "Secret Workspace",
          members: [{ principalId: "missing-secret", role: "owner", status: "active" }],
        },
      ],
    } as unknown as SsoCutoverAccountAdminPort;
    const app = authenticatedApp({ identity, administration });
    const missing = await app.inject({ method: "GET", url: "/api/accounts/absent/sso-readiness" });
    expect(missing.statusCode).toBe(404);

    const response = await app.inject({ method: "GET", url: "/api/accounts/workspace-1/sso-readiness" });
    const serialized = response.body;
    expect(response.statusCode).toBe(200);
    expect(serialized).not.toContain("secret-principal");
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("missing-secret");
    expect(serialized).not.toContain("Secret Workspace");
    expect(response.json().globalIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "operator_identity_repair_required" }),
        expect.objectContaining({ reason: "other_workspace_not_ready" }),
      ]),
    );
    await app.close();
  });
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

  it.each([
    ["PATCH", "/api/accounts/workspace-1/members/member-1/email", { email: "member@example.com" }],
    [
      "DELETE",
      "/api/accounts/workspace-1/members/member-1/federated-link",
      { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
    ],
  ] as const)("rejects %s repairs outside password staging mode", async (method, url, payload) => {
    const app = authenticatedApp({ authMode: "sso" });
    const response = await app.inject({ method, url, payload });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CONFLICT" });
    await app.close();
  });

  it.each([
    ["PATCH", "/api/accounts/workspace-1/members/member-1/email", { email: "member@example.com" }],
    [
      "DELETE",
      "/api/accounts/workspace-1/members/member-1/federated-link",
      { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
    ],
  ] as const)("requires a strict provider for %s repairs", async (method, url, payload) => {
    const app = authenticatedApp({ auth: {} as Auth });
    expect((await app.inject({ method, url, payload })).statusCode).toBe(400);
    await app.close();
  });

  it.each([undefined, 12, "not-an-email", "member@@example.com"])(
    "rejects an invalid correction email %#",
    async (email) => {
      const app = authenticatedApp();
      const response = await app.inject({
        method: "PATCH",
        url: "/api/accounts/workspace-1/members/member-1/email",
        payload: email === undefined ? {} : { email },
      });
      expect(response.statusCode).toBe(400);
      await app.close();
    },
  );

  it.each([
    {
      name: "email correction",
      method: "PATCH" as const,
      url: "/api/accounts/workspace-1/members/member-1/email",
      payload: { email: "member@example.com" },
      identityMethod: "correctPrincipalEmail" as const,
      action: "correct-email",
    },
    {
      name: "provider-link removal",
      method: "DELETE" as const,
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
      identityMethod: "removeFederatedLink" as const,
      action: "remove-federated-link",
    },
  ])("maps denied identity-global authority for $name", async (testCase) => {
    const evaluateIdentityAdminAuthority = vi.fn(async () => ({ allowed: false as const }));
    const identityMethod = vi.fn();
    const app = authenticatedApp({
      identity: { [testCase.identityMethod]: identityMethod } as unknown as SsoCutoverIdentityPort,
      administration: { evaluateIdentityAdminAuthority } as unknown as SsoCutoverAccountAdminPort,
    });
    const response = await app.inject({ method: testCase.method, url: testCase.url, payload: testCase.payload });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(identityMethod).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {
      name: "email correction",
      method: "PATCH" as const,
      url: "/api/accounts/workspace-1/members/member-1/email",
      payload: { email: "member@example.com" },
      identity: { correctPrincipalEmail: vi.fn(async () => Promise.reject(new Error("storage detail"))) },
    },
    {
      name: "provider-link removal",
      method: "DELETE" as const,
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
      identity: { removeFederatedLink: vi.fn(async () => Promise.reject(new Error("storage detail"))) },
    },
  ])("maps $name port failures through fail", async (testCase) => {
    const administration = {
      evaluateIdentityAdminAuthority: vi.fn(async () => ({
        allowed: true as const,
        revision: "revision-1",
        policyVersion: "policy-1",
      })),
    } as unknown as SsoCutoverAccountAdminPort;
    const app = authenticatedApp({ identity: testCase.identity as unknown as SsoCutoverIdentityPort, administration });
    const response = await app.inject({ method: testCase.method, url: testCase.url, payload: testCase.payload });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "mapped dependency failure" });
    await app.close();
  });

  it("reports a conflict when a provider link changes after inspection", async () => {
    const identity = { removeFederatedLink: vi.fn(async () => false) } as unknown as SsoCutoverIdentityPort;
    const administration = {
      evaluateIdentityAdminAuthority: vi.fn(async () => ({
        allowed: true as const,
        revision: "revision-1",
        policyVersion: "policy-1",
      })),
    } as unknown as SsoCutoverAccountAdminPort;
    const app = authenticatedApp({ identity, administration });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: { rowId: "link-1", providerId: "workforce", subject: "subject-1" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "CONFLICT" });
    await app.close();
  });
});
