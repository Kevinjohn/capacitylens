import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { PermissionContext, useCan, useCanEdit } from "./permissionContext";
import { can } from "@capacitylens/shared/domain/access";
import type { Action, Role } from "@capacitylens/shared/domain/access";

// The generalised affordance gate. Two things must hold and neither is visible from a component
// test: a RESOLVED role delegates to the pure `can` matrix untouched (so client affordances and the
// server's route guard cannot diverge), and a NULL role permits everything — the OFF/demo/no-provider
// regression guard that keeps the shipped no-login deploy byte-identical to the app before
// permissions existed. permissionGating.test.tsx covers what the components then DO with the answer.

// Hard-coded rather than imported as a list, so the sweep is its own source of truth. The
// `satisfies` ties it to the union: a new Action that isn't listed here is a compile error.
const ACTIONS = [
  "read",
  "write",
  "manageInternalClient",
  "manageMembers",
  "manageInvites",
  "manageMemberSignInTracking",
  "purge",
  "deleteAccount",
  "transferOwnership",
] as const satisfies readonly Action[];

const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

const withRole =
  (role: Role | null) =>
  ({ children }: { children: ReactNode }) => (
    <PermissionContext.Provider value={{ role }}>{children}</PermissionContext.Provider>
  );

describe("useCan", () => {
  it("delegates every resolved role × action to the pure matrix", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const { result } = renderHook(() => useCan(action), { wrapper: withRole(role) });
        expect(result.current, `${role}/${action}`).toBe(can(role, action));
      }
    }
  });

  it("permits EVERY action for a null role — the OFF/demo/no-provider guard", () => {
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), { wrapper: withRole(null) });
      expect(result.current, action).toBe(true);
    }
  });

  it("treats a missing provider exactly like an explicit null role", () => {
    // No wrapper at all: the context default. This is the isolated-render / demo path.
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action));
      expect(result.current, action).toBe(true);
    }
  });

  it("still denies a resolved viewer the write tier", () => {
    const { result } = renderHook(() => useCan("write"), { wrapper: withRole("viewer") });
    expect(result.current).toBe(false);
  });
});

describe("useCanEdit", () => {
  it("is exactly useCan('write') for every role, including null", () => {
    for (const role of [...ROLES, null]) {
      const { result } = renderHook(() => ({ edit: useCanEdit(), write: useCan("write") }), {
        wrapper: withRole(role),
      });
      expect(result.current.edit, `${role}`).toBe(result.current.write);
    }
  });
});
