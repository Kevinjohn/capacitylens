import { afterEach, describe, expect, it, vi } from "vitest";
import { accountClient } from "./accountClient";
import { teamAccessClient } from "./teamAccessClient";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.restoreAllMocks());

describe("teamAccessClient identity validation", () => {
  it("decodes an equivalent successful status instead of reporting a rejected command", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(accountClient, "issuePasswordReset").mockResolvedValue(
      new Response(JSON.stringify({ token: "one-time-token" }), { status: 200 }),
    );

    await expect(teamAccessClient.issuePasswordReset("account-1", "user-1")).resolves.toMatchObject({
      kind: "ok",
      status: 200,
      value: { token: "one-time-token" },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("equivalent success 200"));
  });

  it("defaults absent additive fields and contains unsupported rows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(accountClient, "listMembers").mockResolvedValue(
      json({
        members: [
          {
            userId: "legacy-user",
            role: "viewer",
            status: "active",
            createdAt: "2026-07-27T10:00:00.000Z",
            name: "Legacy",
            email: null,
            isSelf: false,
          },
          {
            userId: "future-user",
            role: "super-admin",
            status: "active",
            createdAt: "2026-07-27T10:00:00.000Z",
            name: "Future",
            email: null,
            isSelf: false,
          },
        ],
      }),
    );

    await expect(teamAccessClient.listMembers("account-1")).resolves.toMatchObject({
      kind: "ok",
      value: [
        {
          userId: "legacy-user",
          mayResetPassword: false,
          mayRevokeSessions: false,
        },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unsupported member-directory row"),
      expect.objectContaining({ userId: "future-user" }),
    );
  });

  it("defaults an absent invitation preauthorization email and preserves valid peers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(accountClient, "listInvitations").mockResolvedValue(
      json({
        invites: [
          {
            id: "legacy-invite",
            role: "viewer",
            expiresAt: "2026-08-27T10:00:00.000Z",
            usedAt: null,
            createdAt: "2026-07-27T10:00:00.000Z",
          },
          {
            id: "future-invite",
            role: "auditor",
            expiresAt: "2026-08-27T10:00:00.000Z",
            usedAt: null,
            createdAt: "2026-07-27T10:00:00.000Z",
          },
        ],
      }),
    );

    await expect(teamAccessClient.listInvitations("account-1")).resolves.toMatchObject({
      kind: "ok",
      value: [{ id: "legacy-invite", preauthEmail: null }],
    });
  });

  it.each(["2026-02-30T10:00:00.000Z", "0", "2026-08-27", "2026-08-27T11:00:00.000+01:00"])(
    "rejects a non-canonical invitation timestamp: %s",
    async (expiresAt) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(accountClient, "listInvitations").mockResolvedValue(
        json({
          invites: [
            {
              id: "invite-1",
              role: "viewer",
              preauthEmail: null,
              expiresAt,
              usedAt: null,
              createdAt: "2026-07-27T10:00:00.000Z",
            },
          ],
        }),
      );

      await expect(teamAccessClient.listInvitations("account-1")).resolves.toMatchObject({ kind: "invalid" });
    },
  );

  it("rejects duplicate member identities", async () => {
    const member = {
      userId: "user-1",
      role: "viewer",
      status: "active",
      createdAt: "2026-07-27T10:00:00.000Z",
      name: "Ada",
      email: "ada@example.test",
      isSelf: false,
      mayResetPassword: false,
      mayRevokeSessions: false,
    };
    vi.spyOn(accountClient, "listMembers").mockResolvedValue(
      json({
        members: [member, { ...member, role: "admin" }],
      }),
    );

    await expect(teamAccessClient.listMembers("account-1")).resolves.toMatchObject({ kind: "invalid" });
  });

  it("rejects duplicate invitation identities", async () => {
    const invitation = {
      id: "invite-1",
      role: "viewer",
      preauthEmail: null,
      expiresAt: "2026-08-27T10:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-27T10:00:00.000Z",
    };
    vi.spyOn(accountClient, "listInvitations").mockResolvedValue(
      json({
        invites: [invitation, { ...invitation, role: "editor" }],
      }),
    );

    await expect(teamAccessClient.listInvitations("account-1")).resolves.toMatchObject({ kind: "invalid" });
  });
});
