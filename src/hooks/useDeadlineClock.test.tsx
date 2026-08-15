import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeadlineClock } from "./useDeadlineClock";

// Timer behaviour, on fake timers so "just after the deadline" is exact rather than flaky. The
// properties worth pinning are the ones a list depends on: it wakes AFTER the boundary (never at or
// before it, which would re-render with the deadline still in the future), it arms nothing when
// nothing is pending, it re-arms when a nearer deadline appears, it keeps working down a QUEUE of
// deadlines because the caller's stale filter is run against the hook's own clock, an inline picker
// does not churn the armed timer, and a deadline beyond setTimeout's 32-bit ceiling is clamped
// instead of overflowing into an immediate-fire loop.

const START = Date.UTC(2026, 6, 14, 12, 0, 0);
const MAX_TIMEOUT_DELAY = 2_147_483_647;

/** The call shape both Settings sections use: the nearest deadline STILL AHEAD of the hook's clock. */
const nextOf =
  (...deadlines: number[]) =>
  (clock: number): number | null =>
    deadlines
      .filter((at) => at > clock)
      .reduce<number | null>((nearest, at) => (nearest === null ? at : Math.min(nearest, at)), null);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDeadlineClock", () => {
  it("starts at the current time", () => {
    const { result } = renderHook(() => useDeadlineClock(nextOf(START + 60_000)));
    expect(result.current).toBe(START);
  });

  it("advances just AFTER the deadline passes, not at it", () => {
    const deadline = START + 60_000;
    const { result } = renderHook(() => useDeadlineClock(nextOf(deadline)));

    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(START); // still armed: firing at exactly the deadline is too early

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(deadline + 1);
    expect(result.current).toBeGreaterThan(deadline);
  });

  it("arms nothing at all when no deadline is pending", () => {
    const { result } = renderHook(() => useDeadlineClock(() => null));

    act(() => void vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(result.current).toBe(START);
  });

  it("re-arms on the nearer deadline when one appears", () => {
    const { result, rerender } = renderHook(({ nextAt }: { nextAt: number | null }) => useDeadlineClock(() => nextAt), {
      initialProps: { nextAt: START + 60_000 },
    });

    rerender({ nextAt: START + 5_000 });
    act(() => void vi.advanceTimersByTime(5_001));
    expect(result.current).toBe(START + 5_001);
  });

  it("works down a queue of deadlines, the caller's stale filter running against its own clock", () => {
    const first = START + 5_000;
    const second = START + 9_000;
    const { result } = renderHook(() => useDeadlineClock(nextOf(first, second)));

    act(() => void vi.advanceTimersByTime(5_001));
    // The first has fired, so the picker — asked with the clock it just produced — drops it as past
    // and answers with the second; a picker asked with any OTHER clock could not have done that.
    expect(result.current).toBe(first + 1);

    act(() => void vi.advanceTimersByTime(3_999));
    expect(result.current).toBe(first + 1); // armed for the second, which has not passed yet

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(second + 1);
  });

  it("does not re-arm when only the picker's identity changes", () => {
    // The picker is expected to be an inline arrow — a NEW function every render. The effect keys on
    // the instant it returns, so re-renders that change nothing else must leave the timer alone.
    const deadline = START + 60_000;
    const { rerender } = renderHook(() => useDeadlineClock(nextOf(deadline)));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    rerender();
    rerender();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("stops waking once the deadline is cleared", () => {
    const { result, rerender } = renderHook(({ nextAt }: { nextAt: number | null }) => useDeadlineClock(() => nextAt), {
      initialProps: { nextAt: (START + 5_000) as number | null },
    });

    rerender({ nextAt: null });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(START);
  });

  it("clamps a deadline beyond setTimeout's 32-bit ceiling instead of overflowing", () => {
    // Passed through raw, this delay overflows and fires IMMEDIATELY (then again on every re-arm).
    const deadline = START + 3 * MAX_TIMEOUT_DELAY;
    const { result } = renderHook(() => useDeadlineClock(nextOf(deadline)));

    // Each clamped wake re-arms for the remainder without advancing the clock: the deadline has not
    // been crossed, so there is nothing for a re-render to show.
    act(() => void vi.advanceTimersByTime(MAX_TIMEOUT_DELAY));
    expect(result.current).toBe(START);
    act(() => void vi.advanceTimersByTime(MAX_TIMEOUT_DELAY));
    expect(result.current).toBe(START);
    act(() => void vi.advanceTimersByTime(MAX_TIMEOUT_DELAY));
    expect(result.current).toBe(START);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(deadline + 1);
  });

  it("clears its outstanding timer on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useDeadlineClock(nextOf(START + 60_000)));

    clearTimeoutSpy.mockClear();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
