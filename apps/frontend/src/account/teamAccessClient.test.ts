import { afterEach, describe, expect, it, vi } from "vitest";
import { accountClient } from "./accountClient";
import { runCommand } from "./commandRequest";
import { resolveRejectionMessage, teamAccessClient } from "./teamAccessClient";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.restoreAllMocks());

describe("teamAccessClient command outcomes", () => {
  it("classifies a clone-less in-progress command from one body read", async () => {
    const readBody = vi
      .fn()
      .mockResolvedValueOnce({ code: "COMMAND_IN_PROGRESS", error: "Still running." })
      .mockRejectedValue(new Error("body already consumed"));
    vi.spyOn(accountClient, "createInvitation").mockResolvedValue({
      ok: false,
      status: 409,
      json: readBody,
    } as unknown as Response);

    await expect(
      teamAccessClient.createInvitation({ accountId: "account-1", role: "viewer", email: "selina@wayne.test" }),
    ).resolves.toEqual({ kind: "unknown", status: 409, message: "Still running." });
    expect(readBody).toHaveBeenCalledOnce();
  });

  it("decodes an equivalent successful status instead of reporting a rejected command", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(accountClient, "createInvitation").mockResolvedValue(
      new Response(JSON.stringify({ emailed: true }), { status: 200 }),
    );

    await expect(
      teamAccessClient.createInvitation({ accountId: "account-1", role: "viewer", email: "selina@wayne.test" }),
    ).resolves.toMatchObject({ kind: "ok", status: 200, value: { emailed: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("equivalent success 200"));
  });
});

describe("teamAccessClient directory validation", () => {
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
      value: {
        signInTrackingEnabled: false,
        members: [
          {
            userId: "legacy-user",
            signInConfirmed: null,
          },
        ],
      },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unsupported member-directory row"));
  });

  it.each(["accessDisabled", "membershipPresent"] as const)(
    "rejects a present non-boolean member %s flag",
    async (field) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const member = {
        userId: "member-1",
        role: "viewer",
        status: "active",
        createdAt: "2026-07-27T10:00:00.000Z",
        name: "Bruce Wayne",
        email: null,
        isSelf: false,
        [field]: "false",
      };
      vi.spyOn(accountClient, "listMembers").mockResolvedValue(json({ members: [member] }));

      await expect(teamAccessClient.listMembers("account-1")).resolves.toMatchObject({ kind: "invalid" });
    },
  );
});

describe("teamAccessClient member resource links", () => {
  it("keeps an operation-ambiguous conflict uncertain despite a terminal-looking body", async () => {
    const response = await runCommand({
      operationKey: null,
      explicit: undefined,
      ambiguousStatus: 409,
      request: async () => Response.json({ code: "CONFLICT", error: "A conflict occurred." }, { status: 409 }),
    });
    vi.spyOn(accountClient, "setMemberResourceLink").mockResolvedValue(response);
    await expect(
      teamAccessClient.setMemberResourceLink({
        workspaceId: "a1",
        principalId: "u1",
        resourceId: "r1",
        expectedRevision: null,
      }),
    ).resolves.toMatchObject({ kind: "unknown", status: 409 });
  });

  it.each([
    [null, "created-revision"],
    ["prior-revision", "changed-revision"],
  ])("decodes create/change success with expected revision %s", async (expectedRevision, revision) => {
    vi.spyOn(accountClient, "setMemberResourceLink").mockResolvedValue(json({ resourceId: "r1", revision }));
    await expect(
      teamAccessClient.setMemberResourceLink({
        workspaceId: "a1",
        principalId: "u1",
        resourceId: "r1",
        expectedRevision,
      }),
    ).resolves.toEqual({ kind: "ok", status: 200, value: { resourceId: "r1", revision } });
  });

  it("preserves a structured conflict and contains an uncertain success body", async () => {
    vi.spyOn(accountClient, "setMemberResourceLink")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "CONFLICT", error: "The member link changed." }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const input = { workspaceId: "a1", principalId: "u1", resourceId: "r1", expectedRevision: null };
    await expect(teamAccessClient.setMemberResourceLink(input)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      message: "The member link changed.",
    });
    await expect(teamAccessClient.setMemberResourceLink(input)).resolves.toMatchObject({
      kind: "invalid",
      status: 200,
    });
  });
});

describe("teamAccessClient invitation rows", () => {
  it("drops rows without an address or an invitable role and keeps valid peers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = { expiresAt: "2026-08-27T10:00:00.000Z", createdAt: "2026-07-27T10:00:00.000Z" };
    vi.spyOn(accountClient, "listInvitations").mockResolvedValue(
      json({
        invites: [
          { ...row, id: 1, role: "viewer", preauthEmail: "selina@wayne.test" },
          { ...row, id: 2, role: "viewer" },
          { ...row, id: 3, role: "auditor", preauthEmail: "harley@wayne.test" },
        ],
      }),
    );

    await expect(teamAccessClient.listInvitations("account-1")).resolves.toMatchObject({
      kind: "ok",
      value: [{ id: "1", preauthEmail: "selina@wayne.test" }],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unsupported invitation-directory row"));
  });
});

describe("teamAccessClient invitation creation", () => {
  it.each([
    [201, true],
    [202, false],
  ])("reports whether a %s invitation was emailed", async (status, emailed) => {
    const create = vi
      .spyOn(accountClient, "createInvitation")
      .mockResolvedValue(new Response(JSON.stringify({ id: 1, emailed }), { status }));
    const input = { accountId: "a1", role: "editor" as const, email: "selina@wayne.test" };

    await expect(teamAccessClient.createInvitation(input)).resolves.toMatchObject({ kind: "ok", value: { emailed } });
    expect(create).toHaveBeenCalledWith(input);
  });

  it.each(["2026-02-30T10:00:00.000Z", "0", "2026-08-27", "2026-08-27T11:00:00.000+01:00"])(
    "rejects a non-canonical invitation timestamp: %s",
    async (expiresAt) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(accountClient, "listInvitations").mockResolvedValue(
        json({
          invites: [
            {
              id: 1,
              role: "viewer",
              preauthEmail: "selina@wayne.test",
              expiresAt,
              createdAt: "2026-07-27T10:00:00.000Z",
            },
          ],
        }),
      );

      await expect(teamAccessClient.listInvitations("account-1")).resolves.toMatchObject({ kind: "invalid" });
    },
  );
});

describe("teamAccessClient duplicate validation", () => {
  it("rejects duplicate member identities", async () => {
    const member = {
      userId: "user-1",
      role: "viewer",
      status: "active",
      createdAt: "2026-07-27T10:00:00.000Z",
      name: "Ada",
      email: "ada@example.test",
      isSelf: false,
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
      id: 1,
      role: "viewer",
      preauthEmail: "selina@wayne.test",
      expiresAt: "2026-08-27T10:00:00.000Z",
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

describe("rejectionMessage", () => {
  // Only a `rejected` outcome carries a sentence the server wrote about the user's request. The
  // other non-ok kinds describe the client's own uncertainty, so the caller's operation-specific
  // fallback stays the better thing to show.
  it("prefers the server's sentence on a rejection", () => {
    expect(
      resolveRejectionMessage({ kind: "rejected", status: 409, message: "That member owns the account." }, "fallback"),
    ).toBe("That member owns the account.");
  });

  it("falls back when a rejection carried no sentence", () => {
    expect(resolveRejectionMessage({ kind: "rejected", status: 403, message: null }, "fallback")).toBe("fallback");
  });

  it("falls back rather than showing a blank toast for an empty rejection message", () => {
    expect(resolveRejectionMessage({ kind: "rejected", status: 403, message: "" }, "fallback")).toBe("fallback");
  });

  it("keeps the caller's sentence for unknown and invalid outcomes", () => {
    expect(resolveRejectionMessage({ kind: "unknown", status: 502, message: "Gateway timeout." }, "fallback")).toBe(
      "fallback",
    );
    expect(
      resolveRejectionMessage(
        { kind: "invalid", status: 200, message: "The server returned an invalid response." },
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("keeps the caller's sentence for a success handed to it defensively", () => {
    expect(resolveRejectionMessage<true>({ kind: "ok", status: 204, value: true }, "fallback")).toBe("fallback");
  });
});
