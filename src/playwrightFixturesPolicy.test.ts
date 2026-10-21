import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Playwright fixture policy", () => {
  it("routes secondary browser contexts through the page-error-observing fixture", () => {
    const directContextCreators = readdirSync("e2e", { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
      .map((entry) => `${entry.parentPath}/${entry.name}`)
      .filter((path) => readFileSync(path, "utf8").includes("browser.newContext("));

    expect(directContextCreators).toEqual([]);
  });
});
