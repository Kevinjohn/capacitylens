import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExternalProviderButton } from "./ExternalProviderButton";

describe("ExternalProviderButton", () => {
  it("uses Google's recognizable mark, compliant treatment and exact action copy", () => {
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
    expect(button).toHaveTextContent("Sign in with Google");
    expect(button).toHaveClass(
      "h-10",
      "min-h-10",
      "outline-solid",
      "outline-1",
      "outline-[#747775]",
      "dark:outline-[#8e918f]",
    );

    for (const markTestId of ["google-mark-light", "google-mark-dark"]) {
      const mark = screen.getByTestId(markTestId);
      expect(mark).toHaveAttribute("alt", "");
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark).toHaveAttribute("width", "180");
      expect(mark).toHaveAttribute("height", "40");
      expect(mark).toHaveClass("h-10", "w-[180px]", "max-w-full");
    }
  });

  it("always keeps the Google stroke when callers use the default variant", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "google", kind: "social" }}
        label="Continue with Google"
        googleLabel="Sign in with Google"
        className="w-full"
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toHaveClass(
      "w-full",
      "outline-solid",
      "outline-1",
      "outline-[#747775]",
    );
  });

  it("keeps configured copy and caller labels for other providers", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "github", kind: "social" }}
        label="Continue with GitHub"
        googleLabel="Sign in with Google"
        aria-label="Use GitHub"
      />,
    );

    const button = screen.getByRole("button", { name: "Use GitHub" });
    expect(button).toHaveTextContent("Continue with GitHub");
    expect(button.querySelector("img")).toBeNull();
    expect(button).not.toHaveClass("border-[#747775]");
  });
});
