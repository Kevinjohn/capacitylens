import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
  it("uses the upstream pill shape and exposes the resolved default variant", () => {
    render(<Badge>Owner</Badge>);

    const badge = screen.getByText("Owner");
    expect(badge).toHaveAttribute("data-variant", "default");
    expect(badge).toHaveClass(
      "rounded-full",
      "border-transparent",
      "bg-brand-soft",
      "text-brand-soft-ink",
    );
    expect(badge).not.toHaveClass("rounded-md");
  });

  it("keeps CapacityLens status tones while adding invalid-state styling", () => {
    render(
      <Badge aria-invalid="true" variant="danger">
        Not connected
      </Badge>,
    );

    expect(screen.getByText("Not connected")).toHaveClass(
      "bg-danger-soft",
      "text-danger-soft-ink",
      "aria-invalid:border-destructive",
      "aria-invalid:ring-destructive/20",
      "dark:aria-invalid:ring-destructive/40",
    );
  });

  it("supports upstream ghost and link variants with anchor-only hover treatments", () => {
    render(
      <>
        <Badge variant="ghost">Preview</Badge>
        <Badge asChild variant="link">
          <a href="/settings">Settings</a>
        </Badge>
      </>,
    );

    expect(screen.getByText("Preview")).toHaveClass(
      "[a&]:hover:bg-accent",
      "[a&]:hover:text-accent-foreground",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "data-variant",
      "link",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveClass(
      "text-brand",
      "[a&]:hover:underline",
    );
  });
});
