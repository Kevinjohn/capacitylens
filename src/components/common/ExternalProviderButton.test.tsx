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
        microsoftLabel="Sign in with Microsoft"
        disabled
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Sign in with Google");
    expect(button).toHaveClass("h-10", "min-h-10", "shadow-none");
    for (const outlineClass of ["outline-solid", "outline-1", "outline-[#747775]", "dark:outline-[#8e918f]"]) {
      expect(button).not.toHaveClass(outlineClass);
    }

    for (const markTestId of ["google-mark-light", "google-mark-dark"]) {
      const mark = screen.getByTestId(markTestId);
      expect(mark).toHaveAttribute("alt", "");
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark).toHaveAttribute("width", "360");
      expect(mark).toHaveAttribute("height", "80");
      expect(mark).toHaveClass("h-10", "w-[180px]", "max-w-full");
    }
  });

  it("does not add an outer stroke when callers use the default variant", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "google", kind: "social" }}
        label="Continue with Google"
        googleLabel="Sign in with Google"
        microsoftLabel="Sign in with Microsoft"
        className="w-full"
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button).toHaveClass("w-full");
    for (const outlineClass of ["outline-solid", "outline-1", "outline-[#747775]"]) {
      expect(button).not.toHaveClass(outlineClass);
    }
  });

  it("uses Google presentation for a explicitly branded Google provider", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "google", kind: "social", brand: "google" }}
        label="Continue with Google"
        googleLabel="Sign in with Google"
        microsoftLabel="Sign in with Microsoft"
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button).not.toHaveClass("outline-solid");
    expect(button).not.toHaveClass("outline-[#747775]");
    expect(screen.getByTestId("google-mark-light")).toBeInTheDocument();
  });

  it("uses Microsoft presentation for social and explicitly branded Google providers", () => {
    const { rerender } = render(
      <ExternalProviderButton
        provider={{ id: "microsoft", kind: "social" }}
        label="Continue with Microsoft"
        googleLabel="Sign in with Google"
        microsoftLabel="Sign in with Microsoft"
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toHaveClass("w-[215px]");
    expect(screen.getByTestId("microsoft-mark")).toBeInTheDocument();

    rerender(
      <ExternalProviderButton
        provider={{ id: "microsoft", kind: "social", brand: "microsoft" }}
        label="Continue with Microsoft"
        googleLabel="Sign in with Google"
        microsoftLabel="Sign in with Microsoft"
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toHaveTextContent("Sign in with Microsoft");
    expect(screen.getByTestId("microsoft-mark")).toBeInTheDocument();
  });

  it("uses GitHub's mark and configured copy for the supported GitHub provider", () => {
    render(
      <ExternalProviderButton
        provider={{ id: "github", kind: "social" }}
        label="Continue with GitHub"
        googleLabel="Sign in with Google"
        microsoftLabel="Sign in with Microsoft"
        aria-label="Use GitHub"
      />,
    );

    const button = screen.getByRole("button", { name: "Use GitHub" });
    expect(button).toHaveTextContent("Continue with GitHub");
    expect(button).toHaveClass("w-[215px]", "bg-[#24292f]", "text-white");
    expect(screen.getByTestId("github-mark")).toBeInTheDocument();
  });
});
