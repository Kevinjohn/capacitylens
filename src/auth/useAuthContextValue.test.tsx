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
    const generation = result.current.sessionGeneration;
    rerender();
    expect(result.current.sessionGeneration).toBe(generation);
  });

  it("advances when the authenticated identity or mode is replaced", () => {
    const refreshAuth = async () => {};
    const signOut = async () => {};
    const first = buildOpenAuthResult("password", { id: "user-1", name: "Bruce Wayne" });
    const { result, rerender } = renderHook(({ status }) => useAuthContextValue(status, refreshAuth, signOut), {
      initialProps: { status: first },
    });
    const initialGeneration = result.current.sessionGeneration;
    rerender({ status: buildOpenAuthResult("password", { id: "user-2", name: "Clark Kent" }) });
    const replacementGeneration = result.current.sessionGeneration;
    rerender({ status: buildOpenAuthResult("sso", { id: "user-2", name: "Clark Kent" }) });
    expect(replacementGeneration).not.toBe(initialGeneration);
    expect(result.current.sessionGeneration).not.toBe(replacementGeneration);
  });
});
