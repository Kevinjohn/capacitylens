import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductOrientation } from "./ProductOrientation";

describe("ProductOrientation", () => {
  it("presents concise guidance in a labelled, non-modal region", () => {
    render(<ProductOrientation onDismiss={() => undefined} />);

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
    const view = render(<ProductOrientation onDismiss={onDismiss} />);
    expect(screen.getByRole("heading", { name: "How CapacityLens works" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    view.rerender(<ProductOrientation onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
