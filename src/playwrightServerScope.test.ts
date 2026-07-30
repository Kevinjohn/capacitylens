import { describe, expect, it } from "vitest";
import { coreSpecPattern, reportPhaseName, selectsOnlyExplicitCoreSpecs } from "../scripts/playwright-server-scope";
import { E2E_RUN_PRESETS, resolvePlaywrightRunMode } from "../scripts/playwright-run-mode.mjs";

describe("Playwright server scope", () => {
  it.each(Object.entries(E2E_RUN_PRESETS))(
    "keeps the %s preset's projects and server profile aligned",
    (_name, preset) => {
      const mode = resolvePlaywrightRunMode(preset.environment, ["node", "playwright", "test"], () => false);
      expect(mode.projects).toEqual(
        preset.projects.length > 0 ? preset.projects : ["chromium", "db-backed", "auth-backed"],
      );
      expect(mode.serverProfile).toBe(
        preset === E2E_RUN_PRESETS.standard ? "standard" : preset === E2E_RUN_PRESETS.chromiumWebkit ? "vite" : "vite",
      );
    },
  );

  it("rejects contradictory run modes instead of selecting projects and servers from different modes", () => {
    expect(() =>
      resolvePlaywrightRunMode(
        { CAPACITYLENS_OIDC_E2E: "1", CAPACITYLENS_REHEARSAL_URL: "http://rehearsal.test" },
        [],
        () => false,
      ),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      resolvePlaywrightRunMode({ CAPACITYLENS_WEBKIT_ONLY: "1", CAPACITYLENS_FIREFOX_ONLY: "1" }, [], () => false),
    ).toThrow(/mutually exclusive/);
  });

  it("uses a non-empty report phase and rejects lossy or traversal-shaped aliases", () => {
    expect(reportPhaseName(undefined)).toBe("default");
    expect(reportPhaseName("")).toBe("default");
    expect(reportPhaseName("chromium-server")).toBe("chromium-server");
    expect(() => reportPhaseName("///")).toThrow(/letters, numbers, underscores and hyphens/);
    expect(() => reportPhaseName("webkit/1")).toThrow(/letters, numbers, underscores and hyphens/);
  });

  it.each(["ts", "tsx", "mts", "cts"])("matches core .spec.%s files without matching server flavours", (extension) => {
    expect(coreSpecPattern.test(`toolbar.spec.${extension}`)).toBe(true);
    expect(coreSpecPattern.test(`toolbar.db.spec.${extension}`)).toBe(false);
    expect(coreSpecPattern.test(`toolbar.auth.spec.${extension}`)).toBe(false);
    expect(coreSpecPattern.test(`toolbar.oidc.spec.${extension}`)).toBe(false);
  });

  it("recognises one or more explicitly selected core specs", () => {
    expect(
      selectsOnlyExplicitCoreSpecs(["node", "playwright", "test", "e2e/scheduler.spec.ts", "e2e/timeoff.spec.ts"]),
    ).toBe(true);
  });

  it.each([
    ["an unfiltered run", ["node", "playwright", "test"]],
    ["a directory selector", ["node", "playwright", "test", "e2e"]],
    ["a database-backed spec", ["node", "playwright", "test", "e2e/persistence.db.spec.ts"]],
    ["a mixed selection", ["node", "playwright", "test", "e2e/scheduler.spec.ts", "e2e/invite.auth.spec.ts"]],
  ])("retains the full server set for %s", (_label, argv) => {
    expect(selectsOnlyExplicitCoreSpecs(argv)).toBe(false);
  });
});
