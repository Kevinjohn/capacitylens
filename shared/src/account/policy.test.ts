import { describe, expect, it } from "vitest";
import type { Role } from "./types";
import {
  canAdministerAccount,
  canAdministerIdentityAcrossWorkspaces,
  canChangeMemberStatus,
  canManageMemberRole,
  canRemoveMember,
} from "./policy";

const roles = (entries: Array<[string, Role]>): ReadonlyMap<string, Role> => new Map(entries);

describe("account administration policy", () => {
  it("keeps member/invitation administration at admin tier and transfer owner-only", () => {
    expect(canAdministerAccount("viewer", "manage-members")).toBe(false);
    expect(canAdministerAccount("editor", "manage-invitations")).toBe(false);
    expect(canAdministerAccount("admin", "manage-members")).toBe(true);
    expect(canAdministerAccount("admin", "transfer-ownership")).toBe(false);
    expect(canAdministerAccount("owner", "transfer-ownership")).toBe(true);
    expect(canAdministerAccount("admin", "erase-workspace")).toBe(false);
    expect(canAdministerAccount("owner", "erase-workspace")).toBe(true);
  });

  it("keeps Owner outside ordinary role and removal operations", () => {
    expect(canManageMemberRole("owner", "editor", "admin")).toBe(true);
    expect(canManageMemberRole("owner", "owner", "admin")).toBe(false);
    expect(canManageMemberRole("owner", "admin", "owner")).toBe(false);
    expect(canRemoveMember("owner", "owner")).toBe(false);
    expect(canRemoveMember("admin", "editor")).toBe(true);
  });

  it("requires identity-administration standing in every target workspace", () => {
    expect(
      canAdministerIdentityAcrossWorkspaces(
        roles([
          ["a", "admin"],
          ["b", "owner"],
        ]),
        roles([
          ["a", "editor"],
          ["b", "admin"],
        ]),
        false,
      ),
    ).toBe(true);
    expect(
      canAdministerIdentityAcrossWorkspaces(
        roles([["a", "admin"]]),
        roles([
          ["a", "editor"],
          ["b", "viewer"],
        ]),
        false,
      ),
    ).toBe(false);
    expect(
      canAdministerIdentityAcrossWorkspaces(
        roles([
          ["a", "admin"],
          ["b", "admin"],
        ]),
        roles([
          ["a", "editor"],
          ["b", "owner"],
        ]),
        false,
      ),
    ).toBe(false);
  });

  it("allows self-operation but fails closed for an identity with no memberships", () => {
    expect(canAdministerIdentityAcrossWorkspaces(roles([["a", "viewer"]]), roles([["a", "viewer"]]), true)).toBe(true);
    expect(canAdministerIdentityAcrossWorkspaces(roles([]), roles([]), true)).toBe(false);
  });

  it("fails closed on unknown runtime values", () => {
    expect(canAdministerAccount("superuser" as Role, "manage-members")).toBe(false);
    expect(canAdministerAccount("owner", "unknown" as never)).toBe(false);
    expect(canManageMemberRole("admin", "superuser" as Role, "editor")).toBe(false);
    expect(canManageMemberRole("admin", "editor", "superuser" as Role)).toBe(false);
    expect(canRemoveMember("admin", "superuser" as Role)).toBe(false);
  });
});

describe("canChangeMemberStatus(actor, target, isSelf) — disable/archive/restore matrix (#175)", () => {
  const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

  it("tracks removal authority for every actor/target pair", () => {
    // Suspending a membership withdraws exactly what removing it would, so the two share one gate:
    // any divergence here would be a way to reach a target you are not allowed to remove.
    for (const actor of ROLES) {
      for (const target of ROLES) {
        expect(canChangeMemberStatus(actor, target, false), `${actor}->${target}`).toBe(canRemoveMember(actor, target));
      }
    }
  });

  it("never permits suspending the Owner", () => {
    // Load-bearing: the single-active-owner partial index and the ownerless-account boot assertion
    // both key on role='owner' AND status='active'.
    expect(canChangeMemberStatus("owner", "owner", false)).toBe(false);
    expect(canChangeMemberStatus("admin", "owner", false)).toBe(false);
  });

  it("refuses self-operation even for an owner — lockout would be unrecoverable in-app", () => {
    for (const actor of ROLES) {
      expect(canChangeMemberStatus(actor, actor, true), actor).toBe(false);
    }
  });

  it("fails closed on an unknown role", () => {
    expect(canChangeMemberStatus("superuser" as Role, "editor", false)).toBe(false);
    expect(canChangeMemberStatus("admin", "superuser" as Role, false)).toBe(false);
  });
});
