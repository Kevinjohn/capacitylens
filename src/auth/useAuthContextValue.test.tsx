import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildOpenAuthResult } from "./authStatus";
import { useAuthContextValue } from "./useAuthContextValue";

describe("useAuthContextValue session boundary", () => {
  it("keeps the scalar boundary stable across benign rerenders", () => {
    const refreshAuth = async () => {};
    const signOut = async () => {};
    const status = buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" });
    const { result, rerender } = renderHook(() => useAuthContextValue(status, refreshAuth, signOut));
    rerender();
    expect(result.current.sessionInstanceId).toBeNull();
  });

  it("keeps the application session handle across an equivalent refresh", () => {
    const refreshAuth = async () => {};
    const signOut = async () => {};
    const first = buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" }, "A".repeat(43));
    const { result, rerender } = renderHook(({ status }) => useAuthContextValue(status, refreshAuth, signOut), {
      initialProps: { status: first },
    });
    rerender({ status: buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" }, "A".repeat(43)) });
    expect(result.current.sessionInstanceId).toBe("A".repeat(43));
  });

  it("carries a changed same-user session handle as a new private-state boundary", () => {
    const refreshAuth = async () => {};
    const signOut = async () => {};
    const first = buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" }, "A".repeat(43));
    const { result, rerender } = renderHook(({ status }) => useAuthContextValue(status, refreshAuth, signOut), {
      initialProps: { status: first },
    });
    rerender({
      status: buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" }, "B".repeat(43)),
    });
    expect(result.current.sessionInstanceId).toBe("B".repeat(43));
  });
});
