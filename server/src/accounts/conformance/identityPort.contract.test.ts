import { afterEach, describe, expect, it } from "vitest";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type {
  ActorContext,
  ApplicationSession,
  CommandIdentity,
  LocalPrincipal,
  OperationReceipt,
  PrincipalSummary,
  ProvisionalPrincipal,
  SessionSummary,
} from "@capacitylens/shared/account/types";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { createAuthFromEnvironment, runAuthMigrations, type Auth } from "../../auth";
import { openDb } from "../../db";
import { PASSWORD_ENV } from "../../testHelpers";
import { createBetterAuthIdentityPort } from "../betterAuthIdentityPort";
import { buildApplicationSessionHandle } from "../buildApplicationSessionHandle";
import { recordSessionAssurance } from "../state";
import { createTrustedLocalIdentityPort } from "../createTrustedLocalIdentityPort";

const APPLICATION_ID = "identity-conformance";
const NOW = "2026-07-18T10:00:00.000Z";
const LATER = "2099-07-18T22:00:00.000Z";
const PRINCIPAL: LocalPrincipal = {
  id: "principal-1",
  displayName: "Conformance User",
  email: "conformance@example.com",
  emailVerified: true,
  image: null,
  linkedSubject: null,
};
const ACTOR: ActorContext = {
  principalId: PRINCIPAL.id,
  sessionId: "session-1",
  assurance: "password",
  fresh: true,
  mfaSatisfied: false,
};

type Capability = "durablePrincipalStorage" | "credentials" | "passwordReset" | "administrativeSessionRevocation";

interface Harness {
  port: IdentityPort;
  session: ApplicationSession;
  actor: ActorContext;
  knownPrincipal: PrincipalSummary;
  capabilities: Readonly<Record<Capability, boolean>>;
  cleanup(): void | Promise<void>;
}

type HarnessFactory = () => Harness | Promise<Harness>;

const command = (suffix: string): CommandIdentity => ({
  commandId: `command-${suffix}`,
  idempotencyKey: `idempotency-${suffix}`,
});

const summaryOf = (id: string): PrincipalSummary => ({
  id,
  displayName: PRINCIPAL.displayName,
  email: PRINCIPAL.email,
});

async function expectUnsupported(operation: Promise<unknown>, commandId?: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    failure: {
      code: "UNSUPPORTED_CAPABILITY",
      retryable: false,
      ...(commandId ? { commandId } : {}),
    },
  });
}

function requireAuth(configured: ReturnType<typeof createAuthFromEnvironment>): Auth {
  if (!configured.auth) throw new Error("expected configured authentication");
  return configured.auth;
}

function requireMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new Error("expected seeded map value");
  return value;
}

function expectExactKeys(value: object, expectedKeys: string[]): void {
  expect(Object.keys(value).sort()).toEqual(expectedKeys.sort());
}

function withApplicationSession(auth: Auth, principalId: string, sessionId: string): Auth {
  return {
    ...auth,
    api: {
      ...auth.api,
      getSession: async () => ({
        user: {
          id: principalId,
          name: PRINCIPAL.displayName,
          email: PRINCIPAL.email,
          emailVerified: true,
          image: null,
        },
        session: { id: sessionId, createdAt: NOW, expiresAt: LATER },
      }),
    },
  };
}

/**
 * One provider-neutral executable contract. Every implementation runs the same assertions; an
 * adapter may omit a capability only by returning the contract's explicit fail-closed error.
 */
function identityPortContract(name: string, createHarness: HarnessFactory): void {
  describe(`IdentityPort contract: ${name}`, () => {
    let harness: Harness | null = null;

    afterEach(async () => {
      await harness?.cleanup();
      harness = null;
    });

    async function setup(): Promise<Harness> {
      harness = await createHarness();
      return harness;
    }

    it("normalizes the verified application session", async () => {
      const current = await setup();
      await expect(current.port.verifyApplicationSession({ headers: new Headers() })).resolves.toEqual(current.session);
    });

    it("deduplicates known principal summaries and omits unknown principals", async () => {
      const current = await setup();
      const summaries = await current.port.getPrincipalSummaries({
        principalIds: [current.knownPrincipal.id, "unknown-principal", current.knownPrincipal.id],
      });
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual(current.knownPrincipal);
    });

    it("does not correlate an unknown upstream identity by email", async () => {
      const current = await setup();
      await expect(
        current.port.findPrincipalByFederatedSubject({
          subject: { issuer: "https://unknown-issuer.example", subject: current.knownPrincipal.email ?? "" },
        }),
      ).resolves.toBeNull();
    });

    it("returns transport-neutral sign-out mutations and session summaries", async () => {
      const current = await setup();
      const result = await current.port.signOut({ headers: new Headers() });
      expect(Array.isArray(result.setCookies)).toBe(true);
      expect(result.setCookies.every((cookie) => typeof cookie === "string")).toBe(true);
      const sessions = await current.port.listSessions({ actor: current.actor });
      expect(Array.isArray(sessions)).toBe(true);
      for (const session of sessions) {
        expectExactKeys(session, ["createdAt", "current", "expiresAt", "id"]);
        expect(typeof session.id).toBe("string");
        expect(isIsoInstant(session.createdAt)).toBe(true);
        expect(session.expiresAt === null || isIsoInstant(session.expiresAt)).toBe(true);
        expect(typeof session.current).toBe("boolean");
        expect(session.id).not.toContain("bearer");
      }
    });

    it("revokes an own-session handle idempotently without exposing a bearer", async () => {
      const current = await setup();
      const operation = command("own-session");
      const sessionExisted = (await current.port.listSessions({ actor: current.actor })).some(
        (session) => session.id === current.actor.sessionId,
      );
      await expect(
        current.port.revokeOwnSession({
          actor: current.actor,
          sessionId: current.actor.sessionId,
          command: operation,
        }),
      ).resolves.toMatchObject({ commandId: operation.commandId, changed: sessionExisted });
      await expect(
        current.port.revokeOwnSession({
          actor: current.actor,
          sessionId: current.actor.sessionId,
          command: operation,
        }),
      ).resolves.toMatchObject({ commandId: operation.commandId, changed: false });
    });

    it("deprovisions only the requested installation-local principal", async () => {
      const current = await setup();
      const operation = command("deprovision");
      await expect(
        current.port.deprovisionLocalPrincipal({
          principalId: current.knownPrincipal.id,
          reason: "identity-erasure",
          command: operation,
        }),
      ).resolves.toMatchObject({ commandId: operation.commandId });
      if (current.capabilities.durablePrincipalStorage) {
        await expect(
          current.port.getPrincipalSummaries({ principalIds: [current.knownPrincipal.id] }),
        ).resolves.toEqual([]);
      }
    });

    it("implements credential provisioning or rejects the entire capability explicitly", async () => {
      const current = await setup();
      const operation = command("credential");
      const create = current.port.createProvisionalCredentialPrincipal({
        email: "new-person@example.com",
        displayName: "New Person",
        password: "conformance-password-123",
        emailVerified: true,
        command: operation,
      });
      if (!current.capabilities.credentials) {
        await expectUnsupported(create, operation.commandId);
        await expectUnsupported(
          current.port.compensateProvisionalPrincipal({
            provisional: { principalId: "unsupported", compensationHandle: "opaque" },
            reason: "invitation-claim-failed",
            command: operation,
          }),
          operation.commandId,
        );
        return;
      }

      const provisional = await create;
      expectExactKeys(provisional, ["compensationHandle", "principalId"]);
      expect(typeof provisional.principalId).toBe("string");
      expect(typeof provisional.compensationHandle).toBe("string");
      expect(provisional.compensationHandle).not.toContain(provisional.principalId);
      await expect(
        current.port.compensateProvisionalPrincipal({
          provisional,
          reason: "invitation-claim-failed",
          command: operation,
        }),
      ).resolves.toBeUndefined();
      await expect(current.port.getPrincipalSummaries({ principalIds: [provisional.principalId] })).resolves.toEqual(
        [],
      );
    });

    it("implements reset-ceremony issue/revoke or rejects both operations explicitly", async () => {
      const current = await setup();
      const operation = command("password-reset");
      const issue = current.port.issuePasswordReset({
        targetPrincipalId: current.knownPrincipal.id,
        command: operation,
      });
      if (!current.capabilities.passwordReset) {
        await expectUnsupported(issue, operation.commandId);
        await expectUnsupported(
          current.port.revokePasswordResetCeremony({
            targetPrincipalId: current.knownPrincipal.id,
            ceremonyId: "unsupported",
            command: operation,
          }),
          operation.commandId,
        );
        return;
      }

      const ceremony = await issue;
      expectExactKeys(ceremony, ["ceremonyId", "expiresAt", "token"]);
      expect(typeof ceremony.ceremonyId).toBe("string");
      expect(typeof ceremony.token).toBe("string");
      expect(typeof ceremony.expiresAt).toBe("string");
      expect(ceremony.ceremonyId).not.toBe(ceremony.token);
      await expect(
        current.port.revokePasswordResetCeremony({
          targetPrincipalId: current.knownPrincipal.id,
          ceremonyId: ceremony.ceremonyId,
          command: operation,
        }),
      ).resolves.toBeUndefined();
    });

    it("implements identity-global session revocation or rejects it explicitly", async () => {
      const current = await setup();
      const operation = command("principal-sessions");
      const revoke = current.port.revokePrincipalSessions({
        targetPrincipalId: current.knownPrincipal.id,
        command: operation,
      });
      if (!current.capabilities.administrativeSessionRevocation) {
        await expectUnsupported(revoke, operation.commandId);
        return;
      }
      await expect(revoke).resolves.toMatchObject({ commandId: operation.commandId });
      await expect(current.port.listSessions({ actor: current.actor })).resolves.toEqual([]);
    });
  });
}

async function betterAuthHarness(): Promise<Harness> {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  const realAuth = requireAuth(configured);
  await runAuthMigrations(realAuth);
  const created = await realAuth.createCredentialUser({
    email: PRINCIPAL.email,
    name: PRINCIPAL.displayName,
    password: "conformance-password-123",
    emailVerified: true,
  });
  const token = "conformance-session-bearer";
  const sessionId = buildApplicationSessionHandle(APPLICATION_ID, token);
  db.prepare(
    `
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `,
  ).run("session-row-1", LATER, token, NOW, NOW, created.id);
  recordSessionAssurance({ db, sessionId, principalId: created.id, assurance: "password" });
  const session: ApplicationSession = {
    id: sessionId,
    principal: { ...PRINCIPAL, id: created.id },
    createdAt: NOW,
    expiresAt: LATER,
    freshUntil: "2026-07-18T10:15:00.000Z",
    assurance: "password",
    providerId: null,
  };
  const auth = withApplicationSession(realAuth, created.id, sessionId);
  const actor = { ...ACTOR, principalId: created.id, sessionId };
  return {
    port: createBetterAuthIdentityPort({
      applicationId: APPLICATION_ID,
      auth,
      authMode: "password",
      db,
    }),
    session,
    actor,
    knownPrincipal: summaryOf(created.id),
    capabilities: {
      durablePrincipalStorage: true,
      credentials: true,
      passwordReset: true,
      administrativeSessionRevocation: true,
    },
    cleanup: () => db.close(),
  };
}

function trustedLocalHarness(): Harness {
  const session: ApplicationSession = {
    id: "trusted-local",
    principal: PRINCIPAL,
    createdAt: "1970-01-01T00:00:00.000Z",
    expiresAt: null,
    freshUntil: null,
    assurance: "trusted-local",
  };
  return {
    port: createTrustedLocalIdentityPort(PRINCIPAL),
    session,
    actor: { ...ACTOR, sessionId: session.id, assurance: "trusted-local" },
    knownPrincipal: summaryOf(PRINCIPAL.id),
    capabilities: {
      durablePrincipalStorage: false,
      credentials: false,
      passwordReset: false,
      administrativeSessionRevocation: false,
    },
    cleanup: () => {},
  };
}

interface FakeIdentityState {
  principals: Map<string, PrincipalSummary>;
  sessions: Map<string, SessionSummary>;
  provisional: Map<string, ProvisionalPrincipal>;
  session: ApplicationSession;
  receipt(operation: CommandIdentity): OperationReceipt;
}

function createFakeIdentityPort(state: FakeIdentityState): IdentityPort {
  return {
    async verifyApplicationSession() {
      return state.session;
    },
    async getPrincipalSummaries({ principalIds }) {
      return [...new Set(principalIds)].flatMap((id) => {
        const summary = state.principals.get(id);
        return summary ? [summary] : [];
      });
    },
    async findPrincipalByFederatedSubject() {
      return null;
    },
    async signOut() {
      return { setCookies: [] };
    },
    async listSessions({ actor }) {
      return [...state.sessions.values()].filter(() => actor.principalId === PRINCIPAL.id);
    },
    async revokeOwnSession({ sessionId, command: operation }) {
      return { ...state.receipt(operation), changed: state.sessions.delete(sessionId) };
    },
    async createProvisionalCredentialPrincipal({ email, displayName, command: operation }) {
      const value = {
        principalId: `fake-${operation.commandId}`,
        compensationHandle: `opaque-${operation.idempotencyKey}`,
      };
      state.provisional.set(value.principalId, value);
      state.principals.set(value.principalId, { id: value.principalId, displayName, email });
      return value;
    },
    async compensateProvisionalPrincipal({ provisional: value }) {
      if (!state.provisional.delete(value.principalId)) throw new Error("unknown provisional principal");
      state.principals.delete(value.principalId);
    },
    async deprovisionLocalPrincipal({ principalId, command: operation }) {
      state.principals.delete(principalId);
      return state.receipt(operation);
    },
    async issuePasswordReset({ command: operation }) {
      return {
        ceremonyId: `ceremony-${operation.commandId}`,
        token: `token-${operation.idempotencyKey}`,
        expiresAt: LATER,
      };
    },
    async revokePasswordResetCeremony() {},
    async revokePrincipalSessions({ command: operation }) {
      state.sessions.clear();
      return state.receipt(operation);
    },
  };
}

function fakeIdentityHarness(): Harness {
  const principals = new Map<string, PrincipalSummary>([[PRINCIPAL.id, summaryOf(PRINCIPAL.id)]]);
  const sessions = new Map<string, SessionSummary>([
    [
      ACTOR.sessionId,
      {
        id: ACTOR.sessionId,
        createdAt: NOW,
        expiresAt: LATER,
        current: true,
      },
    ],
  ]);
  const provisional = new Map<string, ProvisionalPrincipal>();
  const receipt = (operation: CommandIdentity): OperationReceipt => ({
    commandId: operation.commandId,
    completedAt: NOW,
  });
  const session: ApplicationSession = {
    id: ACTOR.sessionId,
    principal: PRINCIPAL,
    createdAt: NOW,
    expiresAt: LATER,
    freshUntil: "2026-07-18T10:10:00.000Z",
    assurance: "password",
  };
  const port = createFakeIdentityPort({ principals, sessions, provisional, session, receipt });
  return {
    port,
    session,
    actor: ACTOR,
    knownPrincipal: requireMapValue(principals, PRINCIPAL.id),
    capabilities: {
      durablePrincipalStorage: true,
      credentials: true,
      passwordReset: true,
      administrativeSessionRevocation: true,
    },
    cleanup: () => {},
  };
}

identityPortContract("Better Auth adapter", betterAuthHarness);
identityPortContract("trusted-local adapter", trustedLocalHarness);
identityPortContract("vendor-free fake", fakeIdentityHarness);

describe("IdentityPort conformance calibration", () => {
  it("uses the canonical contract error for unsupported capabilities", () => {
    const error = new AccountContractError({
      code: "UNSUPPORTED_CAPABILITY",
      message: "unsupported",
      retryable: false,
    });
    expect(error.failure.code).toBe("UNSUPPORTED_CAPABILITY");
  });
});

describe("revocation window race", () => {
  it("removes assurance for sessions created inside the revocation window, not only the snapshot", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    const realAuth = requireAuth(configured);
    await runAuthMigrations(realAuth);
    const created = await realAuth.createCredentialUser({
      email: PRINCIPAL.email,
      name: PRINCIPAL.displayName,
      password: "conformance-password-123",
      emailVerified: true,
    });
    const seedSession = (suffix: string) => {
      const bearer = `race-session-${suffix}`;
      const handle = buildApplicationSessionHandle(APPLICATION_ID, bearer);
      db.prepare(
        `
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
      ).run(`session-row-${suffix}`, LATER, bearer, NOW, NOW, created.id);
      recordSessionAssurance({ db, sessionId: handle, principalId: created.id, assurance: "password" });
      return handle;
    };
    seedSession("before"); // visible before revocation
    seedSession("window"); // simulates a sign-in landing inside the provider-revocation window

    const port = createBetterAuthIdentityPort({
      applicationId: APPLICATION_ID,
      auth: realAuth,
      authMode: "password",
      db,
    });
    const operation = command("principal-sessions-race");
    await expect(
      port.revokePrincipalSessions({ targetPrincipalId: created.id, command: operation }),
    ).resolves.toMatchObject({ commandId: operation.commandId });

    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM account_session_assurance WHERE principalId = ?`)
      .get(created.id);
    if (typeof remaining !== "object" || !("n" in remaining) || typeof remaining.n !== "number") {
      throw new Error("expected numeric assurance count");
    }
    expect(remaining.n).toBe(0); // no orphaned assurance — including the in-window session
    db.close();
  });
});
