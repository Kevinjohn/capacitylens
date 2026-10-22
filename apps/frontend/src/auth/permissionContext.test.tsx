import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { PermissionContext, useCan, useCanEdit } from "./permissionContext";
import { can } from "@capacitylens/shared/domain/access";
import type { Action, Role } from "@capacitylens/shared/domain/access";
import { useStore } from "@/store/useStore";

// Resolved roles use the shared `can` matrix; an absent role permits actions only outside masquerade.

// Keep the matrix sweep explicit and reject entries that are not valid actions.
const ACTIONS = [
  "read",
  "write",
  "manageInternalClient",
  "manageMembers",
  "manageInvites",
  "manageMemberSignInTracking",
  "anonymise",
  "transferOwnership",
  "actOnOwnershipTransfer",
  "masquerade",
] as const satisfies readonly Action[];

const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

beforeEach(() => useStore.getState().setMasquerade({ kind: "inactive" }));

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

  it("permits reads but denies every other action throughout a masquerade transition", () => {
    act(() =>
      useStore.getState().setMasquerade({
        kind: "starting",
        pending: { accountId: "a-studio", targetUserId: "u-viewer" },
        generation: 1,
      }),
    );
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), { wrapper: withRole("owner") });
      expect(result.current, action).toBe(action === "read");
    }
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
