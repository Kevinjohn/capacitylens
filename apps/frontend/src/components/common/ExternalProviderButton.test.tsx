import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExternalProviderButton } from "./ExternalProviderButton";

describe("ExternalProviderButton", () => {
  it("uses Google's recognizable mark and exact accessible action", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "google", kind: "social" }}
        label="Continue with Google"
        googleLabel="Sign in with Google"
        disabled
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("h-10", "min-h-10", "w-[180px]", "shadow-none");
    expect(button).not.toHaveClass("outline-solid", "outline-1");
    for (const markTestId of ["google-mark-light", "google-mark-dark"]) {
      expect(screen.getByTestId(markTestId)).toHaveAttribute("alt", "");
      expect(screen.getByTestId(markTestId)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("does not add an outer stroke when callers use the default variant", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "google", kind: "social", brand: "google" }}
        googleLabel="Sign in with Google"
        className="w-full"
      />,
    );
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toHaveClass("w-full");
  });
});
