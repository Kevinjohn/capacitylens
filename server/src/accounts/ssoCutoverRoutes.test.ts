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

function readGlobalIssues(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || !("globalIssues" in value) || !Array.isArray(value.globalIssues)) {
    throw new Error("Expected SSO readiness global issues");
  }
  return value.globalIssues;
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
});

describe("SSO provider linking", () => {
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
});

describe("SSO provider-link failures", () => {
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
      throw Object.assign(new Error(`failure ${code}`), { body: { code, message: `failure ${code}` } });
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
});

describe("SSO cutover readiness authorization", () => {
  it("enforces readiness authorization and provider configuration before inventory reads", async () => {
    const authorize = vi.fn((input: Parameters<Parameters<typeof registerSsoCutoverRoutes>[1]["authorize"]>[0]) => {
      input.reply.code(403).send({ error: "Forbidden." });
      return false;
    });
    const identity = { readSsoCutoverSnapshot: vi.fn() } as unknown as SsoCutoverIdentityPort;
    const refused = authenticatedApp({ authorize, identity });
    expect((await refused.inject({ method: "GET", url: "/api/accounts/workspace-1/sso-readiness" })).statusCode).toBe(
      403,
    );
    const authorization = authorize.mock.calls[0]?.[0];
    if (!authorization) throw new Error("Expected readiness authorization");
    expect(authorize).toHaveBeenCalledWith({
      req: authorization.req,
      reply: authorization.reply,
      accountId: "workspace-1",
      action: "manageMembers",
      options: { requireFreshSession: false },
    });
    expect(identity.readSsoCutoverSnapshot).not.toHaveBeenCalled();
    await refused.close();

    const noProvider = authenticatedApp({ auth: {} as Auth, identity });
    expect(
      (await noProvider.inject({ method: "GET", url: "/api/accounts/workspace-1/sso-readiness" })).statusCode,
    ).toBe(400);
    expect(identity.readSsoCutoverSnapshot).not.toHaveBeenCalled();
    await noProvider.close();
  });
});

describe("SSO cutover readiness disclosure", () => {
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
    expect(readGlobalIssues(response.json<unknown>())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "operator_identity_repair_required" }),
        expect.objectContaining({ reason: "other_workspace_not_ready" }),
      ]),
    );
    await app.close();
  });
});

describe("SSO provider inspection", () => {
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
});

describe("SSO cutover repairs", () => {
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
});

describe("SSO cutover repair identity", () => {
  it("uses the authorized path principal when a link-removal body contains extra identity fields", async () => {
    const removeFederatedLink = vi.fn(async (input: Parameters<SsoCutoverIdentityPort["removeFederatedLink"]>[0]) => {
      void input;
      return true;
    });
    const administration = {
      evaluateIdentityAdminAuthority: vi.fn(async () => ({
        allowed: true as const,
        revision: "revision-1",
        policyVersion: "policy-1",
      })),
    } as unknown as SsoCutoverAccountAdminPort;
    const app = authenticatedApp({
      identity: { removeFederatedLink } as unknown as SsoCutoverIdentityPort,
      administration,
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/accounts/workspace-1/members/member-1/federated-link",
      payload: {
        rowId: "link-1",
        providerId: "workforce",
        subject: "subject-1",
        principalId: "attacker-selected-principal",
      },
    });

    expect(response.statusCode).toBe(204);
    const removal = removeFederatedLink.mock.calls[0]?.[0];
    expect(removal?.principalId).toBe("member-1");
    expect(removal?.audit.targetPrincipalId).toBe("member-1");
    await app.close();
  });
});

function registerSameMillisecondEmailRepairTest(): void {
  it("commits two same-millisecond email repairs with distinct audit ids", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T08:15:30.123Z"));
    const auditIds = new Set<string>();
    const committedEmails: string[] = [];
    const correctPrincipalEmail = vi.fn(
      async (input: Parameters<SsoCutoverIdentityPort["correctPrincipalEmail"]>[0]) => {
        if (auditIds.has(input.audit.id)) throw new Error("duplicate audit id");
        auditIds.add(input.audit.id);
        committedEmails.push(input.email);
      },
    );
    const administration = {
      evaluateIdentityAdminAuthority: vi.fn(async () => ({
        allowed: true as const,
        revision: "revision-1" as never,
        policyVersion: "policy-1" as never,
      })),
    } as unknown as SsoCutoverAccountAdminPort;
    const app = authenticatedApp({
      identity: { correctPrincipalEmail } as unknown as SsoCutoverIdentityPort,
      administration,
    });

    try {
      const first = await app.inject({
        method: "PATCH",
        url: "/api/accounts/workspace-1/members/member-1/email",
        payload: { email: "bruce.one@example.com" },
      });
      const second = await app.inject({
        method: "PATCH",
        url: "/api/accounts/workspace-1/members/member-1/email",
        payload: { email: "bruce.two@example.com" },
      });

      expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
      expect(committedEmails).toEqual(["bruce.one@example.com", "bruce.two@example.com"]);
      const ids = correctPrincipalEmail.mock.calls.map(([input]) => input.audit.id);
      expect(new Set(ids)).toHaveLength(2);
      expect(ids).toEqual([
        expect.stringMatching(
          /^identity-email:member-1:2026-09-13T08:15:30\.123Z:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        expect.stringMatching(
          /^identity-email:member-1:2026-09-13T08:15:30\.123Z:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      ]);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });
}

describe("SSO cutover repair transactions", () => {
  registerSameMillisecondEmailRepairTest();

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
    const app = authenticatedApp({
      identity: { correctPrincipalEmail, removeFederatedLink } as unknown as SsoCutoverIdentityPort,
      administration: {
        evaluateIdentityAdminAuthority,
        assertIdentityRepairAuthorityInTx,
      } as unknown as SsoCutoverAccountAdminPort,
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

describe("SSO cutover repair preconditions", () => {
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
});

describe("SSO cutover repair authority", () => {
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
});

describe("SSO cutover repair failures", () => {
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
});

describe("SSO cutover repair conflicts", () => {
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
