import { describe, expect, it } from "vitest";
import type { TeamInvitation, TeamMember } from "../../account/teamAccessClient";
import { buildMemberDirectoryPresentation, sortInvitationsForPresentation } from "./buildMemberDirectoryPresentation";

function member({
  userId,
  role,
  name,
  status = "active",
}: {
  userId: string;
  role: TeamMember["role"];
  name: string;
  status?: TeamMember["status"];
}) {
  return { userId, role, name, status } as TeamMember;
}

describe("member directory presentation", () => {
  it("orders active and inactive members by role, name, then stable id", () => {
    const result = buildMemberDirectoryPresentation([
      member({ userId: "viewer", role: "viewer", name: "Bruce Wayne" }),
      member({ userId: "editor-z", role: "editor", name: "Clark Kent" }),
      member({ userId: "admin-b", role: "admin", name: "Alfred Pennyworth" }),
      member({ userId: "owner", role: "owner", name: "Lucius Fox" }),
      member({ userId: "admin-a", role: "admin", name: "Alfred Pennyworth" }),
      member({ userId: "inactive-viewer", role: "viewer", name: "Diana Prince", status: "disabled" }),
      member({ userId: "inactive-owner", role: "owner", name: "Thomas Wayne", status: "archived" }),
    ]);

    expect(result.activeMembers?.map(({ userId }) => userId)).toEqual([
      "owner",
      "admin-a",
      "admin-b",
      "editor-z",
      "viewer",
    ]);
    expect(result.inactiveMembers.map(({ userId }) => userId)).toEqual(["inactive-owner", "inactive-viewer"]);
  });

  it("orders invitations by role, email, creation time, then id", () => {
    const invitations = [
      {
        id: "viewer",
        role: "viewer",
        preauthEmail: "a@example.com",
        createdAt: "2026-01-01",
        expiresAt: "2026-12-01T00:00:00.000Z",
        usedAt: null,
      },
      {
        id: "admin-b",
        role: "admin",
        preauthEmail: "same@example.com",
        createdAt: "2026-01-01",
        expiresAt: "2026-12-01T00:00:00.000Z",
        usedAt: null,
      },
      {
        id: "admin-a",
        role: "admin",
        preauthEmail: "same@example.com",
        createdAt: "2026-01-01",
        expiresAt: "2026-12-01T00:00:00.000Z",
        usedAt: null,
      },
      {
        id: "editor",
        role: "editor",
        preauthEmail: null,
        createdAt: "2026-01-01",
        expiresAt: "2026-12-01T00:00:00.000Z",
        usedAt: null,
      },
    ] satisfies TeamInvitation[];

    expect(sortInvitationsForPresentation(invitations).map(({ id }) => id)).toEqual([
      "admin-a",
      "admin-b",
      "editor",
      "viewer",
    ]);
  });
});
