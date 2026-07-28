import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFieldError } from "./useFieldError";

describe("useFieldError", () => {
  it("clears both the message and its stale field association", () => {
    const { result, rerender } = renderHook(() => useFieldError());
    const clear = result.current.clear;

    act(() => result.current.fail("name", "Name is required."));
    expect(result.current).toMatchObject({ error: "Name is required.", errorField: "name" });

    act(() => result.current.clear());
    expect(result.current).toMatchObject({ error: null, errorField: null });
    rerender();
    expect(result.current.clear).toBe(clear);
  });
});
