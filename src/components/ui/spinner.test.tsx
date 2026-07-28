import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("exposes its loading state and composes caller styles", () => {
    render(<Spinner className="text-muted-foreground" data-testid="spinner" />);

    expect(screen.getByRole("status", { name: "Loading" })).toBe(screen.getByTestId("spinner"));
    expect(screen.getByTestId("spinner")).toHaveClass("size-4", "animate-spin", "text-muted-foreground");
  });
});
