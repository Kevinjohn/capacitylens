import { describe, expect, it } from "vitest";
import { coreSpecPattern, reportPhaseName, selectsOnlyExplicitCoreSpecs } from "../scripts/playwright-server-scope";

describe("Playwright server scope", () => {
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
