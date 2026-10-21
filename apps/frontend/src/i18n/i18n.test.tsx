// A type-checked message reference proves removing its compiled key fails the build.
// Brand identity remains outside the translation catalogue.

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

  it("owns the accessible allocation status separator in the message catalogue", () => {
    expect(m.scheduler_bar_aria_status({ status: "Tentative" })).toBe("Tentative, ");
  });

  it("injects the product name into every branded catalogue message", () => {
    const app = "Renamed Product";
    expect(m.settings_revoke_sessions_message({ member: "Avery", app })).toContain(app);
    expect(m.settings_revoke_self_sessions_message({ app })).toContain(app);
    expect(m.notice_sync_conflict({ app })).toContain(app);
  });

  it("renders a typed message in a component", () => {
    function Wordmark() {
      return <div>{m.form_cancel()}</div>;
    }
    render(<Wordmark />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});
