// i18n scaffolding tests (P1.5.1) — Paraglide (inlang) compile-time, type-safe messages.
//
// ACCEPTANCE — "a removed key fails the build": the demonstrator key `form_cancel` is referenced
// in type-checked code. Deleting it and recompiling removes the generated function, so TypeScript and
// the green gate fail. Brand identity is deliberately single-sourced from shared/brand instead of
// being duplicated in the translation catalogue.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { baseLocale, locales } from "@/paraglide/runtime.js";
import { m } from "@/i18n";

describe("i18n scaffolding (Paraglide)", () => {
  it("compiles English as the base locale", () => {
    expect(baseLocale).toBe("en");
    expect(locales).toContain("en");
  });

  it("resolves the demonstrator message", () => {
    expect(m.form_cancel()).toBe("Cancel");
  });

  it("renders a typed message in a component", () => {
    function Wordmark() {
      return <div>{m.form_cancel()}</div>;
    }
    render(<Wordmark />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});
