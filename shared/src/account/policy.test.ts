import { describe, expect, it } from "vitest";
import type { Role } from "./types";
import {
  canAdministerAccount,
  canAdministerIdentityAcrossWorkspaces,
  canChangeMemberStatus,
  canEditAnyMemberRole,
  canManageMemberRole,
  canRemoveMember,
} from "./policy";

const roles = (entries: Array<[string, Role]>): ReadonlyMap<string, Role> => new Map(entries);

describe("account administration policy", () => {
  it("keeps member/invitation administration at admin tier and transfer owner-only", () => {
    expect(canAdministerAccount("viewer", "manage-members")).toBe(false);
    expect(canAdministerAccount("editor", "manage-invitations")).toBe(false);
    expect(canAdministerAccount("admin", "manage-members")).toBe(true);
    expect(canAdministerAccount("admin", "manage-member-sign-in-tracking")).toBe(false);
    expect(canAdministerAccount("owner", "manage-member-sign-in-tracking")).toBe(true);
    expect(canAdministerAccount("admin", "transfer-ownership")).toBe(false);
    expect(canAdministerAccount("owner", "transfer-ownership")).toBe(true);
    expect(canAdministerAccount("admin", "erase-workspace")).toBe(false);
    expect(canAdministerAccount("owner", "erase-workspace")).toBe(true);
    expect(canAdministerAccount("viewer", "masquerade-member")).toBe(false);
    expect(canAdministerAccount("editor", "masquerade-member")).toBe(false);
    expect(canAdministerAccount("admin", "masquerade-member")).toBe(true);
    expect(canAdministerAccount("owner", "masquerade-member")).toBe(true);
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

describe("canEditAnyMemberRole(actor, target) — 'may I touch this member's role at all'", () => {
  const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

  it("tracks removal authority for every actor/target pair", () => {
    // CURRENT TRUTH, not a contract. The two answer different questions ("may I retitle you" vs
    // "may I revoke you") and today they happen to agree. This sweep exists so that if either rule
    // gains a condition, the divergence is a deliberate, visible decision here — NOT so that a
    // future difference must be treated as a bug.
    for (const actor of ROLES) {
      for (const target of ROLES) {
        expect(canEditAnyMemberRole(actor, target), `${actor}->${target}`).toBe(canRemoveMember(actor, target));
      }
    }
  });

  it("keeps the Owner outside ordinary role edits", () => {
    // An Owner's role moves only through the atomic ownership transfer.
    expect(canEditAnyMemberRole("owner", "owner")).toBe(false);
    expect(canEditAnyMemberRole("admin", "owner")).toBe(false);
  });

  it("requires the admin tier", () => {
    expect(canEditAnyMemberRole("admin", "editor")).toBe(true);
    expect(canEditAnyMemberRole("owner", "viewer")).toBe(true);
    expect(canEditAnyMemberRole("editor", "viewer")).toBe(false);
    expect(canEditAnyMemberRole("viewer", "viewer")).toBe(false);
  });

  it("fails closed on unknown roles", () => {
    expect(canEditAnyMemberRole("superuser" as Role, "editor")).toBe(false);
    expect(canEditAnyMemberRole("admin", "superuser" as Role)).toBe(false);
  });
});

describe("canManageMemberRole delegates to canEditAnyMemberRole without changing a decision", () => {
  const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

  // Hand-derived from the rules, NOT from the implementation: the actor must hold manage-members
  // (admin tier), and neither demoting the Owner nor promoting anyone TO Owner is an ordinary role
  // edit — both go through ownership transfer.
  const oracle = (actor: Role, target: Role, next: Role): boolean =>
    (actor === "owner" || actor === "admin") && target !== "owner" && next !== "owner";

  it("preserves every decision over actor × target × nextRole", () => {
    for (const actor of ROLES) {
      for (const target of ROLES) {
        for (const next of ROLES) {
          const label = `${actor}->${target}=>${next}`;
          expect(canManageMemberRole(actor, target, next), label).toBe(oracle(actor, target, next));
          // …and that decision is exactly the standing check AND the destination check.
          expect(canManageMemberRole(actor, target, next), label).toBe(
            canEditAnyMemberRole(actor, target) && next !== "owner",
          );
        }
      }
    }
  });

  it("still fails closed on an unknown target or next role", () => {
    expect(canManageMemberRole("admin", "superuser" as Role, "editor")).toBe(false);
    expect(canManageMemberRole("admin", "editor", "superuser" as Role)).toBe(false);
  });
});
