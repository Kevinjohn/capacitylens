import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Component } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepeatingDateError } from "@capacitylens/shared/lib/repeatingDates";
import { buildRepeatedTimeOffDrafts } from "@/lib/repeatingTimeOff";
import { useTimeOffRepeat } from "./useTimeOffRepeat";

vi.mock("@/lib/repeatingTimeOff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/repeatingTimeOff")>()),
  buildRepeatedTimeOffDrafts: vi.fn(),
}));

const input = {
  resourceId: "bruce-wayne",
  startDate: "2026-01-30" as const,
  endDate: "2026-01-30" as const,
  type: "holiday" as const,
  note: "",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("useTimeOffRepeat preview errors", () => {
  it("keeps expected repeat validation errors out of render", () => {
    vi.mocked(buildRepeatedTimeOffDrafts).mockImplementationOnce(() => {
      throw new RepeatingDateError("invalid-last-weekday-start", "Choose the last weekday of the month.");
    });
    const { result } = renderHook(() => useTimeOffRepeat(input));

    act(() => result.current.changeRepeat("monthly-last-weekday"));

    expect(result.current.preview).toBeNull();
  });

  it("surfaces an unexpected RangeError to the component error boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(buildRepeatedTimeOffDrafts).mockImplementation(() => {
      throw new RangeError("Unexpected repeat failure");
    });
    class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? <p>{this.state.error.message}</p> : this.props.children;
      }
    }
    function Harness() {
      const repeat = useTimeOffRepeat(input);
      return <button onClick={() => repeat.changeRepeat("weekly")}>Enable repeat</button>;
    }
    render(
      <ErrorBoundary>
        <Harness />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable repeat" }));

    expect(screen.getByText("Unexpected repeat failure")).toBeInTheDocument();
  });
});
