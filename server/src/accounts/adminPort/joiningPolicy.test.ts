import { describe, expect, it } from "vitest";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { upsertMember } from "../../controlTables";
import { insertRow, openDb } from "../../db";
import { KeyedOperationLock } from "../KeyedOperationLock";
import { createSqliteAccountAdminPort } from "../sqliteAccountAdminPort";

const actor = (principalId: string): ActorContext => ({
  principalId,
  sessionId: `${principalId}-session`,
  assurance: "password",
  fresh: false,
});

describe("joining policy administration", () => {
  it("allows Owner edits and Admin reads, preserving settings after denied writes", async () => {
    const db = openDb(":memory:");
    try {
      insertRow(db, "accounts", {
        id: "a-studio",
        name: "Wayne Enterprises",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      for (const [userId, role] of [
        ["bruce", "owner"],
        ["diana", "admin"],
      ] as const) {
        upsertMember(db, {
          accountId: "a-studio",
          userId,
          role,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      const port = createSqliteAccountAdminPort({ applicationId: "test", db, lock: new KeyedOperationLock() });
      const settings = { policy: "approved_domains" as const, approvedDomains: ["STUDIO.example"] };
      await expect(
        port.setJoiningPolicy({
          actor: actor("bruce"),
          workspaceId: "a-studio",
          settings,
          command: { commandId: "command-1", idempotencyKey: "key-1" },
        }),
      ).resolves.toEqual({ policy: "approved_domains", approvedDomains: ["studio.example"] });
      await expect(port.readJoiningPolicy({ actor: actor("diana"), workspaceId: "a-studio" })).resolves.toEqual({
        policy: "approved_domains",
        approvedDomains: ["studio.example"],
      });
      await expect(
        port.setJoiningPolicy({
          actor: actor("diana"),
          workspaceId: "a-studio",
          settings: { policy: "open", approvedDomains: [] },
          command: { commandId: "command-2", idempotencyKey: "key-2" },
        }),
      ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
      await expect(port.readJoiningPolicy({ actor: actor("bruce"), workspaceId: "a-studio" })).resolves.toEqual({
        policy: "approved_domains",
        approvedDomains: ["studio.example"],
      });
    } finally {
      db.close();
    }
  });
});
