import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store/useStore";
import { usePersistenceDiagnostics } from "./usePersistenceDiagnostics";
import { createPlanningCacheState } from "./planning/planningCacheController";

beforeEach(() => {
  vi.stubEnv("VITE_CAPACITYLENS_DEMO", "0");
  useStore.setState({ planning: createPlanningCacheState().planning, past: [], future: [] });
});

afterEach(() => vi.unstubAllEnvs());

describe("usePersistenceDiagnostics", () => {
  it("reports the current planning state without cache rows", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());
    expect(result.current).toEqual({
      status: "idle",
      revision: null,
      commitment: "none",
      canUndo: false,
      canRedo: false,
    });
  });

  it("re-renders when the live controller state changes", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());
    act(() => useStore.setState((state) => ({ planning: { ...state.planning, status: "error", revision: 8 } })));
    expect(result.current).toMatchObject({ status: "error", revision: 8 });
  });

  it("identifies the memory-only demo without a server revision", () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    const { result } = renderHook(() => usePersistenceDiagnostics());
    expect(result.current).toMatchObject({ status: "demo", revision: null });
  });
});
