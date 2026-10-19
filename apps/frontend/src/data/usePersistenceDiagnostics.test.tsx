import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePersistenceDiagnostics } from "./usePersistenceDiagnostics";
import {
  incrementPersistenceDiagnostic,
  resetPersistenceDiagnostics,
  setPersistenceSuspended,
} from "./persistenceDiagnostics";

beforeEach(() => resetPersistenceDiagnostics());

describe("usePersistenceDiagnostics", () => {
  it("reports the current counters", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());
    expect(result.current).toMatchObject({ savesFailed: 0, suspended: false });
  });

  it("re-renders when a counter is incremented", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());

    act(() => incrementPersistenceDiagnostic("savesFailed"));
    expect(result.current.savesFailed).toBe(1);
  });

  it("re-renders when persistence is suspended", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());

    act(() => setPersistenceSuspended(true));
    expect(result.current.suspended).toBe(true);
  });
});
