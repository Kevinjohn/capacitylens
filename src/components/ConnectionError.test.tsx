import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionError } from "./ConnectionError";

describe("ConnectionError", () => {
  it("explains that server data is safe and retries through its primary action", () => {
    const onRetry = vi.fn();
    render(<ConnectionError onRetry={onRetry} />);

    expect(screen.getByRole("heading", { level: 1, name: "Can’t reach the server" })).toBeInTheDocument();
    expect(screen.getByText(/saved data is safe on the server/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
