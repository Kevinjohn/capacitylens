import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("@capacitylens/shared package exports", () => {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "shared/package.json"), "utf8")) as {
    exports: Record<string, string>;
  };

  it("resolves every explicit production subpath to an existing source file", () => {
    for (const subpath of Object.keys(packageJson.exports)) {
      const specifier = `@capacitylens/shared${subpath.slice(1)}`;
      const resolved = import.meta.resolve(specifier);

      expect(resolved).toMatch(/\/src\/.+\.ts$/);
      expect(existsSync(new URL(resolved))).toBe(true);
    }
  });

  it.each(["packageExports.test", "testEnvironment.test", "account/index", "account/private"])(
    "does not export test or private implementation subpath %s",
    (subpath) => {
      expect(() => import.meta.resolve(`@capacitylens/shared/${subpath}`)).toThrow(/not defined by "exports"/i);
    },
  );

  it("contains no wildcard that can expose future test modules", () => {
    expect(Object.keys(packageJson.exports).some((subpath) => subpath.includes("*"))).toBe(false);
  });
});
