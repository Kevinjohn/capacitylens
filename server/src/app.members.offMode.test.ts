import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type Db } from "./db";
import { upsertMember, getMemberRole } from "./controlTables";
import { call } from "./testHelpers";
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

const membersReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, {
    method: "GET",
    url: `/api/accounts/${accountId}/members`,
    headers,
  });

interface PatchRoleReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  role: unknown;
  headers?: Record<string, string> | undefined;
}

const patchRoleReq = ({ app, accountId, userId, role, headers = {} }: PatchRoleReqInput) =>
  call(app, {
    method: "PATCH",
    url: `/api/accounts/${accountId}/members/${userId}`,
    payload: { role },
    headers,
  });

interface RemoveReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  headers?: Record<string, string> | undefined;
}

const removeReq = ({ app, accountId, userId, headers = {} }: RemoveReqInput) =>
  call(app, {
    method: "DELETE",
    url: `/api/accounts/${accountId}/members/${userId}`,
    headers,
  });

const invitesReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, {
    method: "GET",
    url: `/api/accounts/${accountId}/invites`,
    headers,
  });

describe("member endpoints — OFF mode (trusted-local)", () => {
  it("GET members / invites return empty; mutate routes report the unavailable capability", async () => {
    const db = openDb(":memory:");
    const app = createApp(db); // authMode defaults to 'off'
    seedTwo(db);
    const unavailable = {
      error: "Member management is unavailable in trusted-local mode.",
    };

    expect((await membersReq(app, "a1")).json()).toEqual({ members: [], signInTrackingEnabled: false });
    expect((await invitesReq(app, "a1")).json()).toEqual({ invites: [] });
    // Trusted-local has no member model, so neither nonexistent nor manually seeded rows should
    // make an inert request look like a committed membership mutation.
    const ghostPatch = await patchRoleReq({ app, accountId: "a1", userId: "ghost", role: "editor" });
    expect(ghostPatch.statusCode).toBe(400);
    expect(ghostPatch.json()).toEqual(unavailable);
    const ghostRemove = await removeReq({ app, accountId: "a1", userId: "ghost" });
    expect(ghostRemove.statusCode).toBe(400);
    expect(ghostRemove.json()).toEqual(unavailable);

    upsertMember(db, {
      accountId: "a1",
      userId: "demo",
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const patch = await patchRoleReq({ app, accountId: "a1", userId: "demo", role: "admin" });
    expect(patch.statusCode).toBe(400);
    expect(patch.json()).toEqual(unavailable);
    const remove = await removeReq({ app, accountId: "a1", userId: "demo" });
    expect(remove.statusCode).toBe(400);
    expect(remove.json()).toEqual(unavailable);
    const transfer = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/transfer-ownership",
      payload: { toUserId: "somebody-else" },
    });
    expect(transfer.statusCode).toBe(400);
    expect(transfer.json()).toEqual(unavailable);
    expect(getMemberRole(db, "a1", "somebody-else")).toBeNull(); // no phantom member minted
    expect(getMemberRole(db, "a1", "demo")).toBe("owner");
  });
});
