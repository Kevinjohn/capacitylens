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

interface TransferInput {
  app: FastifyInstance;
  accountId: string;
  toUserId: string;
  cookie?: string | undefined;
}

const transfer = ({ app, accountId, toUserId, cookie }: TransferInput) =>
  call(app, {
    method: "POST",
    url: `/api/accounts/${accountId}/transfer-ownership`,
    payload: { toUserId },
    headers: cookie ? { cookie } : {},
  });

function registerOwnershipTransferSuccessTest(): void {
  it("owner → existing member: target becomes owner, caller steps down to admin (atomic)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const member = await signUp(app, "member-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: member.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect((await transfer({ app, accountId: "a1", toUserId: member.userId, cookie: owner.cookie })).statusCode).toBe(
      200,
    );
    expect(getMemberRole(db, "a1", member.userId)).toBe("owner");
    expect(getMemberRole(db, "a1", owner.userId)).toBe("admin");
    // createdAt is the immutable JOIN timestamp — a transfer (a role change on both rows) must NOT
    // reset it, else both users jump to the bottom of the createdAt-ordered member list and show the
    // transfer moment as their "joined" date. Both must still read the original TS. (Code-review fix.)
    const createdAtOf = (userId: string) =>
      (
        db.prepare("SELECT createdAt FROM account_members WHERE accountId = ? AND userId = ?").get("a1", userId) as {
          createdAt: string;
        }
      ).createdAt;
    expect(createdAtOf(member.userId)).toBe(TS);
    expect(createdAtOf(owner.userId)).toBe(TS);
  });
}

function registerAdminOwnershipTransferRejectionTest(): void {
  it("admin cannot transfer ownership → 403 (transferOwnership is owner-only, above admin)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const member = await signUp(app, "member2-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: member.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect((await transfer({ app, accountId: "a1", toUserId: member.userId, cookie: admin.cookie })).statusCode).toBe(
      403,
    );
    expect(getMemberRole(db, "a1", admin.userId)).toBe("admin"); // unchanged
    expect(getMemberRole(db, "a1", member.userId)).toBe("editor");
  });
}

function registerInvalidOwnershipTransferTargetTest(): void {
  it("target must be an existing member → 404; cannot transfer to self → 400 (both leave state intact)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner2-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    expect((await transfer({ app, accountId: "a1", toUserId: "ghost-user", cookie: owner.cookie })).statusCode).toBe(
      404,
    );
    const selfTransfer = await transfer({ app, accountId: "a1", toUserId: owner.userId, cookie: owner.cookie });
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
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    // Absent toUserId.
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/transfer-ownership",
          payload: {},
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(400);
    // Empty-string toUserId.
    expect((await transfer({ app, accountId: "a1", toUserId: "", cookie: owner.cookie })).statusCode).toBe(400);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner"); // still the owner; nothing changed
  });
}

function registerCrossTenantOwnershipTransferTest(): void {
  it("cross-tenant: an owner of a1 cannot transfer ownership within a2 → 403", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const a1owner = await signUp(app, "a1owner-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a1owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const a2member = await signUp(app, "a2member-xfer@capacitylens.dev");
    upsertMember(db, {
      accountId: "a2",
      userId: a2member.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await transfer({ app, accountId: "a2", toUserId: a2member.userId, cookie: a1owner.cookie })).statusCode,
    ).toBe(403);
    expect(getMemberRole(db, "a2", a2member.userId)).toBe("editor"); // unchanged
  });
}

describe("P1.11 transfer ownership — POST /api/accounts/:id/transfer-ownership (owner-only)", () => {
  registerOwnershipTransferSuccessTest();
  registerAdminOwnershipTransferRejectionTest();
  registerInvalidOwnershipTransferTargetTest();
  registerOwnershipTransferShapeTest();
  registerCrossTenantOwnershipTransferTest();
});
