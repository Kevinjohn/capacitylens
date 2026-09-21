import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type Db } from "./db";
import { upsertMember, getMemberRole } from "./controlTables";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { PASSWORD_ENV, call, signUp } from "./testHelpers";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";

const TS = "2026-01-01T00:00:00.000Z";
const meta = () => ({ createdAt: TS, updatedAt: TS });
const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});

function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1"), account("a2")];
  insertAll(db, d as unknown as AppData);
}

async function appWithAuth(options: { rateLimit?: number } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected auth configuration.");
  await runAuthMigrations(auth);
  return { app: createApp(db, { authMode: mode, auth, ...options }), db };
}

function parseErrorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || !("code" in value) || typeof value.code !== "string") {
    throw new Error("Expected response body to contain a string error code");
  }
  return value.code;
}
interface NominateInput {
  app: FastifyInstance;
  accountId: string;
  toUserId: string;
  cookie?: string | undefined;
  expected?: { expectedRequestId: string; expectedRevision: string };
}

const nominate = ({ app, accountId, toUserId, cookie, expected }: NominateInput) =>
  call(app, {
    method: "POST",
    url: `/api/accounts/${accountId}/ownership-transfer`,
    payload: { toUserId, ...(expected ?? {}) },
    headers: cookie ? { cookie } : {},
  });

interface CeremonyStepInput {
  app: FastifyInstance;
  accountId: string;
  requestId: string;
  expectedRevision: string;
  cookie?: string | undefined;
}

const ceremonyStep = (step: "accept" | "withdraw" | "decline" | "complete") =>
  function perform({ app, accountId, requestId, expectedRevision, cookie }: CeremonyStepInput) {
    return call(app, {
      method: "POST",
      url: `/api/accounts/${accountId}/ownership-transfer/${requestId}/${step}`,
      payload: { expectedRevision },
      headers: cookie ? { cookie } : {},
    });
  };

const acceptNomination = ceremonyStep("accept");
const declineNomination = ceremonyStep("decline");
const completeNomination = ceremonyStep("complete");

const cancelNomination = ({ app, accountId, requestId, expectedRevision, cookie }: CeremonyStepInput) =>
  call(app, {
    method: "DELETE",
    url: `/api/accounts/${accountId}/ownership-transfer/${requestId}`,
    payload: { expectedRevision },
    headers: cookie ? { cookie } : {},
  });

async function seedOwnerAndAdmin(app: FastifyInstance, db: Db, emails: { owner: string; admin: string }) {
  const owner = await signUp(app, emails.owner);
  upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
  const admin = await signUp(app, emails.admin);
  upsertMember(db, { accountId: "a1", userId: admin.userId, role: "admin", status: "active", createdAt: TS });
  return { owner, admin };
}

function registerOwnershipCeremonySuccessTest(): void {
  it("owner nominates, the admin consents, the owner approves: only then do the roles change", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { owner, admin } = await seedOwnerAndAdmin(app, db, {
      owner: "owner-xfer@capacitylens.dev",
      admin: "member-xfer@capacitylens.dev",
    });

    const nominated = await nominate({ app, accountId: "a1", toUserId: admin.userId, cookie: owner.cookie });
    expect(nominated.statusCode).toBe(201);
    const requestId = (nominated.json() as { request: { id: string } }).request.id;
    // Nomination alone confers nothing: the roles are exactly as they were.
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
    expect(getMemberRole(db, "a1", admin.userId)).toBe("admin");

    const accepted = await acceptNomination({
      app,
      accountId: "a1",
      requestId,
      expectedRevision: "0",
      cookie: admin.cookie,
    });
    expect(accepted.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");

    expect(
      (await completeNomination({ app, accountId: "a1", requestId, expectedRevision: "1", cookie: owner.cookie }))
        .statusCode,
    ).toBe(200);
    expect(getMemberRole(db, "a1", admin.userId)).toBe("owner");
    expect(getMemberRole(db, "a1", owner.userId)).toBe("admin");
    // createdAt is the immutable JOIN timestamp — the exchange (a role change on both rows) must NOT
    // reset it, else both users jump to the bottom of the createdAt-ordered member list and show the
    // transfer moment as their "joined" date.
    const createdAtOf = (userId: string) =>
      (
        db.prepare("SELECT createdAt FROM account_members WHERE accountId = ? AND userId = ?").get("a1", userId) as {
          createdAt: string;
        }
      ).createdAt;
    expect(createdAtOf(admin.userId)).toBe(TS);
    expect(createdAtOf(owner.userId)).toBe(TS);
  });
}

function registerOwnershipConsentTests(): void {
  it("refuses to complete a nomination the nominee has not consented to", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { owner, admin } = await seedOwnerAndAdmin(app, db, {
      owner: "owner-consent@capacitylens.dev",
      admin: "admin-consent@capacitylens.dev",
    });
    const nominated = await nominate({ app, accountId: "a1", toUserId: admin.userId, cookie: owner.cookie });
    const requestId = (nominated.json() as { request: { id: string } }).request.id;

    const early = await completeNomination({
      app,
      accountId: "a1",
      requestId,
      expectedRevision: "0",
      cookie: owner.cookie,
    });
    expect(early.statusCode).toBe(409);
    expect(getMemberRole(db, "a1", admin.userId)).toBe("admin");
  });

  it("lets the nominee decline, and the decline ends the ceremony without moving anything", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { owner, admin } = await seedOwnerAndAdmin(app, db, {
      owner: "owner-decline@capacitylens.dev",
      admin: "admin-decline@capacitylens.dev",
    });
    const nominated = await nominate({ app, accountId: "a1", toUserId: admin.userId, cookie: owner.cookie });
    const requestId = (nominated.json() as { request: { id: string } }).request.id;

    expect(
      (await declineNomination({ app, accountId: "a1", requestId, expectedRevision: "0", cookie: admin.cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await completeNomination({ app, accountId: "a1", requestId, expectedRevision: "1", cookie: owner.cookie }))
        .statusCode,
    ).toBe(409);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
    expect(getMemberRole(db, "a1", admin.userId)).toBe("admin");
  });
}

function registerOwnershipConsentGuardTests(): void {
  it("does not let a third admin consent on the nominee's behalf", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { owner, admin } = await seedOwnerAndAdmin(app, db, {
      owner: "owner-third@capacitylens.dev",
      admin: "admin-third@capacitylens.dev",
    });
    const other = await signUp(app, "other-admin@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: other.userId, role: "admin", status: "active", createdAt: TS });
    const nominated = await nominate({ app, accountId: "a1", toUserId: admin.userId, cookie: owner.cookie });
    const requestId = (nominated.json() as { request: { id: string } }).request.id;

    const stolen = await acceptNomination({
      app,
      accountId: "a1",
      requestId,
      expectedRevision: "0",
      cookie: other.cookie,
    });
    expect(stolen.statusCode).toBe(403);
    // The other admin cannot destroy the ceremony either: it is still open at its original revision.
    expect(
      (await acceptNomination({ app, accountId: "a1", requestId, expectedRevision: "0", cookie: admin.cookie }))
        .statusCode,
    ).toBe(200);
  });

  it("lets the nominating owner cancel, and a stale revision is refused", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { owner, admin } = await seedOwnerAndAdmin(app, db, {
      owner: "owner-cancel@capacitylens.dev",
      admin: "admin-cancel@capacitylens.dev",
    });
    const nominated = await nominate({ app, accountId: "a1", toUserId: admin.userId, cookie: owner.cookie });
    const requestId = (nominated.json() as { request: { id: string } }).request.id;
    await acceptNomination({ app, accountId: "a1", requestId, expectedRevision: "0", cookie: admin.cookie });

    // "0" was authorised against the nomination, not against the acceptance that followed it.
    expect(
      (await cancelNomination({ app, accountId: "a1", requestId, expectedRevision: "0", cookie: owner.cookie }))
        .statusCode,
    ).toBe(409);
    expect(
      (await cancelNomination({ app, accountId: "a1", requestId, expectedRevision: "1", cookie: owner.cookie }))
        .statusCode,
    ).toBe(200);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
  });
}

function registerAdminOwnershipTransferRejectionTest(): void {
  it("an admin cannot nominate → 403 (nomination is owner-only, above admin)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: admin.userId, role: "admin", status: "active", createdAt: TS });
    const member = await signUp(app, "member2-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: member.userId, role: "admin", status: "active", createdAt: TS });

    expect((await nominate({ app, accountId: "a1", toUserId: member.userId, cookie: admin.cookie })).statusCode).toBe(
      403,
    );
    expect(getMemberRole(db, "a1", admin.userId)).toBe("admin"); // unchanged
    expect(getMemberRole(db, "a1", member.userId)).toBe("admin");
  });
}

function registerInvalidOwnershipTransferTargetTest(): void {
  it("the nominee must be an existing active Admin, and never the caller", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner2-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const editor = await signUp(app, "editor-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: editor.userId, role: "editor", status: "active", createdAt: TS });

    expect((await nominate({ app, accountId: "a1", toUserId: "ghost-user", cookie: owner.cookie })).statusCode).toBe(
      404,
    );
    // An Editor is a member, but the ceremony hands the company to someone who already administers
    // it: a lower tier would be an elevation of two steps on one person's say-so.
    const wrongTier = await nominate({ app, accountId: "a1", toUserId: editor.userId, cookie: owner.cookie });
    expect(wrongTier.statusCode).toBe(400);
    expect(parseErrorCode(wrongTier.json())).toBe("VALIDATION_FAILED");
    const selfTransfer = await nominate({ app, accountId: "a1", toUserId: owner.userId, cookie: owner.cookie });
    expect(selfTransfer.statusCode).toBe(400);
    expect(parseErrorCode(selfTransfer.json())).toBe("VALIDATION_FAILED");
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner"); // still the owner
  });
}

function registerOwnershipTransferShapeTest(): void {
  it("a missing or empty toUserId is a 400 (shape check, before the role/owner logic)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-guard-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });

    // Absent toUserId.
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/ownership-transfer",
          payload: {},
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(400);
    // Empty-string toUserId.
    expect((await nominate({ app, accountId: "a1", toUserId: "", cookie: owner.cookie })).statusCode).toBe(400);
    // Half a replacement predicate names no particular predecessor, so it is malformed rather than
    // leniently treated as "replace whatever is live".
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/ownership-transfer",
          payload: { toUserId: "somebody", expectedRequestId: "request-1" },
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner"); // still the owner; nothing changed
  });
}

function registerCrossTenantOwnershipTransferTest(): void {
  it("cross-tenant: an owner of a1 cannot nominate within a2 → 403", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const a1owner = await signUp(app, "a1owner-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: a1owner.userId, role: "owner", status: "active", createdAt: TS });
    const a2member = await signUp(app, "a2member-xfer@capacitylens.dev");
    upsertMember(db, { accountId: "a2", userId: a2member.userId, role: "admin", status: "active", createdAt: TS });

    expect(
      (await nominate({ app, accountId: "a2", toUserId: a2member.userId, cookie: a1owner.cookie })).statusCode,
    ).toBe(403);
    expect(getMemberRole(db, "a2", a2member.userId)).toBe("admin"); // unchanged
  });
}

describe("#780 ownership transfer ceremony — /api/accounts/:id/ownership-transfer", () => {
  registerOwnershipCeremonySuccessTest();
  registerOwnershipConsentTests();
  registerOwnershipConsentGuardTests();
  registerAdminOwnershipTransferRejectionTest();
  registerInvalidOwnershipTransferTargetTest();
  registerOwnershipTransferShapeTest();
  registerCrossTenantOwnershipTransferTest();
});
