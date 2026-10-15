import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductOrientation } from "./ProductOrientation";

describe("ProductOrientation", () => {
  const initialFocus = { sequence: 0, delayMs: 0 };

  it("presents concise guidance in a labelled, non-modal region", () => {
    render(<ProductOrientation focusRequest={initialFocus} onDismiss={() => undefined} />);

    const heading = screen.getByRole("heading", { name: "How CapacityLens works" });
    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toContainElement(heading);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/week-by-week view/)).toBeInTheDocument();
    expect(screen.getByText(/People appear as rows/)).toBeInTheDocument();
    expect(screen.getByText(/does not manage tasks, tickets or deadlines/)).toBeInTheDocument();
  });

  it("focuses its heading once when shown and dismisses on request", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const view = render(<ProductOrientation focusRequest={initialFocus} onDismiss={onDismiss} />);
    expect(screen.getByRole("heading", { name: "How CapacityLens works" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    view.rerender(<ProductOrientation focusRequest={initialFocus} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("focuses only for an explicit activation request, including after a close delay", () => {
    vi.useFakeTimers();
    const view = render(<ProductOrientation focusRequest={initialFocus} onDismiss={() => undefined} />);
    const heading = screen.getByRole("heading", { name: "How CapacityLens works" });
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();

    view.rerender(<ProductOrientation focusRequest={initialFocus} onDismiss={() => undefined} />);
    expect(other).toHaveFocus();

    view.rerender(<ProductOrientation focusRequest={{ sequence: 1, delayMs: 300 }} onDismiss={() => undefined} />);
    expect(other).toHaveFocus();
    vi.advanceTimersByTime(300);
    expect(heading).toHaveFocus();
    other.remove();
    vi.useRealTimers();
  });
});
