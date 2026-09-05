import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JumpToDateInput } from "./JumpToDateInput";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount } from "../../test/fixtures";

// DECISION (#173): the toolbar no longer renders this picker (see SHOW_JUMP_TO_DATE in
// ToolbarDateNavigation.tsx), so its behaviour is covered here rather than through the toolbar.

beforeEach(() => {
  resetStoreWithAccount();
});

describe("JumpToDateInput", () => {
  it("shows the current focus date", () => {
    useStore.getState().goToDate("2026-06-01");
    render(<JumpToDateInput />);

    expect(screen.getByLabelText("Jump to date")).toHaveValue(useStore.getState().ui.focusDate);
  });

  it("moves the grid to a valid date", () => {
    const goToDate = vi.fn();
    useStore.setState({ goToDate });
    render(<JumpToDateInput />);

    fireEvent.change(screen.getByLabelText("Jump to date"), { target: { value: "2026-09-10" } });
    expect(goToDate).toHaveBeenCalledWith("2026-09-10");
  });

  it("does not call goToDate for a malformed programmatic date change", () => {
    const goToDate = vi.fn();
    useStore.setState({ goToDate });
    render(<JumpToDateInput />);

    fireEvent.change(screen.getByLabelText("Jump to date"), { target: { value: "2026-2-30" } });
    expect(goToDate).not.toHaveBeenCalled();
  });
});
