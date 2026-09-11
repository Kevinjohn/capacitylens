import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountAuditPort, IdentityPort } from "@capacitylens/shared/account/ports";
import type { ApplicationSession, PrincipalSummary, Role } from "@capacitylens/shared/account/types";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { MasqueradeRegistry, type MasqueradeRecord } from "../MasqueradeRegistry";
import type { MasqueradeRouteDependencies } from "./masqueradeRoutes";
import { registerMasqueradeRoutes } from "./masqueradeRoutes";

const EXPIRY = "2026-09-02T10:00:00.000Z";
const STARTED = "2026-09-01T10:00:00.000Z";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function session(overrides: Partial<Pick<ApplicationSession, "expiresAt">> = {}): ApplicationSession {
  return {
    id: "session-1",
    principal: {
      id: "owner-1",
      displayName: "Bruce Wayne",
      email: "bruce@wayne.example",
      emailVerified: true,
      linkedSubject: null,
    },
    createdAt: STARTED,
    expiresAt: EXPIRY,
    freshUntil: null,
    assurance: "password",
    ...overrides,
  };
}

function identity(summaries: readonly PrincipalSummary[] = []): IdentityPort {
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected identity operation.");
  };
  return {
    verifyApplicationSession: unavailable,
    getPrincipalSummaries: async () => summaries,
    findPrincipalByFederatedSubject: unavailable,
    signOut: unavailable,
    listSessions: unavailable,
    revokeOwnSession: unavailable,
    createProvisionalCredentialPrincipal: unavailable,
    compensateProvisionalPrincipal: unavailable,
    deprovisionLocalPrincipal: unavailable,
    issuePasswordReset: unavailable,
    revokePasswordResetCeremony: unavailable,
    revokePrincipalSessions: unavailable,
  };
}

function audit(append: AccountAuditPort["append"] = () => true): AccountAuditPort {
  return { append };
}

function record(overrides: Partial<MasqueradeRecord> = {}): MasqueradeRecord {
  return {
    sessionHandle: "session-1",
    userId: "owner-1",
    accountId: "a1",
    targetUserId: "target-1",
    token: "valid-token",
    startedAt: STARTED,
    expiresAt: EXPIRY,
    ...overrides,
  };
}

function appFor(
  overrides: Partial<MasqueradeRouteDependencies> = {},
  requestSession: ApplicationSession | null = session(),
): { app: FastifyInstance; registry: MasqueradeRegistry } {
  const app = Fastify();
  const registry = overrides.registry ?? new MasqueradeRegistry({ now: () => Date.parse(STARTED) });
  app.addHook("preHandler", async (request) => {
    request.session = requestSession;
  });
  registerMasqueradeRoutes(app, {
    authMode: "password",
    applicationId: "capacitylens",
    accountAudit: audit(),
    registry,
    identity: identity([{ id: "target-1", displayName: "Diana Prince", email: "diana@wayne.example" }]),
    authorize: () => true,
    roleForPrincipal: (): Role | null => "viewer",
    effectiveRole: () => ({ kind: "resolved", role: "viewer" }),
    ...overrides,
  });
  apps.push(app);
  return { app, registry };
}

describe("masquerade route adapter authentication", () => {
  it("distinguishes malformed targets, missing sessions, and authentication-off responses", async () => {
    const authenticated = appFor();
    for (const payload of [{}, { targetUserId: "" }, { targetUserId: 1 }, []]) {
      expect(
        (await authenticated.app.inject({ method: "POST", url: "/api/accounts/a1/masquerade", payload })).statusCode,
      ).toBe(400);
    }

    let missingSessionAuditCount = 0;
    const missingSession = appFor(
      {
        accountAudit: audit(() => {
          missingSessionAuditCount += 1;
          return true;
        }),
      },
      null,
    );
    expect(
      (
        await missingSession.app.inject({
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          payload: { targetUserId: "target-1" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await missingSession.app.inject({ method: "GET", url: "/api/masquerade" })).statusCode).toBe(401);
    expect(
      (
        await missingSession.app.inject({
          method: "DELETE",
          url: "/api/masquerade",
          payload: { token: "valid-token", reason: "explicit" },
        })
      ).statusCode,
    ).toBe(204);
    expect(missingSessionAuditCount).toBe(0);

    const authOff = appFor({ authMode: "off" });
    for (const request of [
      { method: "POST" as const, url: "/api/accounts/a1/masquerade", payload: { targetUserId: "target-1" } },
      { method: "GET" as const, url: "/api/masquerade" },
      { method: "DELETE" as const, url: "/api/masquerade", payload: { token: "valid-token", reason: "explicit" } },
    ]) {
      expect((await authOff.app.inject(request)).statusCode).toBe(403);
    }
  });
});

describe("masquerade route adapter start", () => {
  it("refuses a start when the session expiry cannot be verified", async () => {
    const { app, registry } = appFor({}, session({ expiresAt: null }));
    expect(
      (await app.inject({ method: "POST", url: "/api/accounts/a1/masquerade", payload: { targetUserId: "target-1" } }))
        .statusCode,
    ).toBe(503);
    expect(registry.lookup("session-1")).toBeUndefined();
  });
});

describe("masquerade route adapter status", () => {
  it("uses a safe member fallback and refuses ended or roleless status", async () => {
    const fallback = appFor({ identity: identity([]) });
    fallback.registry.start(record(), () => undefined);
    const active = await fallback.app.inject({ method: "GET", url: "/api/masquerade" });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({ active: true, targetName: "Member" });

    const ended = appFor({ effectiveRole: () => ({ kind: "ended" }) });
    ended.registry.start(record(), () => undefined);
    const endedStatus = await ended.app.inject({ method: "GET", url: "/api/masquerade" });
    expect(endedStatus.statusCode).toBe(403);
    expect(endedStatus.json()).toMatchObject({ code: MASQUERADE_ERROR_CODES.ended });

    const roleless = appFor({ effectiveRole: () => ({ kind: "resolved", role: null }) });
    roleless.registry.start(record(), () => undefined);
    const rolelessStatus = await roleless.app.inject({ method: "GET", url: "/api/masquerade" });
    expect(rolelessStatus.statusCode).toBe(403);
    expect(rolelessStatus.json()).toEqual({ error: "Forbidden." });
  });
});

describe("masquerade route adapter end", () => {
  it("rejects malformed end credentials before changing registry state", async () => {
    const { app, registry } = appFor();
    registry.start(record(), () => undefined);
    for (const payload of [{}, { token: "", reason: "explicit" }, { token: "valid-token", reason: "expired" }]) {
      expect((await app.inject({ method: "DELETE", url: "/api/masquerade", payload })).statusCode).toBe(400);
      expect(registry.lookup("session-1")).toBeDefined();
    }
  });
});

describe("masquerade route adapter end idempotence", () => {
  it("makes valid end requests idempotent without repeating their audit event", async () => {
    let auditCount = 0;
    const { app, registry } = appFor({
      accountAudit: audit(() => {
        auditCount += 1;
        return true;
      }),
    });
    registry.start(record(), () => undefined);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: "/api/masquerade",
            payload: { token: "valid-token", reason: "explicit" },
          })
        ).statusCode,
      ).toBe(204);
    }
    expect(auditCount).toBe(1);
  });
});

describe("masquerade route adapter start races and audit failures", () => {
  it("returns a conflict when a registry entry appears during start authorization", async () => {
    const registry = new MasqueradeRegistry({ now: () => Date.parse(STARTED) });
    const { app } = appFor({
      registry,
      authorize: () => {
        registry.start(record(), () => undefined);
        return true;
      },
    });
    const raced = await app.inject({
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      payload: { targetUserId: "target-1" },
    });
    expect(raced.statusCode).toBe(409);
    expect(raced.json()).toMatchObject({ code: MASQUERADE_ERROR_CODES.active });
  });

  it("surfaces audit failures without permitting unauthorized transitions", async () => {
    const startFailure = appFor({
      accountAudit: audit(() => {
        throw new Error("audit unavailable");
      }),
    });
    expect(
      (
        await startFailure.app.inject({
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          payload: { targetUserId: "target-1" },
        })
      ).statusCode,
    ).toBe(500);
    expect(startFailure.registry.lookup("session-1")).toBeUndefined();

    const endFailure = appFor({
      accountAudit: audit(() => {
        throw new Error("audit unavailable");
      }),
    });
    endFailure.registry.start(record(), () => undefined);
    expect(
      (
        await endFailure.app.inject({
          method: "DELETE",
          url: "/api/masquerade",
          payload: { token: "valid-token", reason: "explicit" },
        })
      ).statusCode,
    ).toBe(500);
    expect(endFailure.registry.peek("session-1")).toMatchObject({ phase: "ending" });
  });
});
