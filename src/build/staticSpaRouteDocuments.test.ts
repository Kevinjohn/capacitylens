import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "vite";
import { staticSpaRouteDocuments } from "../../vite.config";

describe("staticSpaRouteDocuments", () => {
  it("writes route documents only after a successful bundle write", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "capacitylens-spa-routes-"));
    try {
      const shell = "<!doctype html><title>CapacityLens</title>";
      await writeFile(join(outputDirectory, "index.html"), shell);

      const plugin = staticSpaRouteDocuments();
      expect(plugin.closeBundle).toBeUndefined();
      expect(plugin.writeBundle).toBeTypeOf("function");

      expect(plugin.configResolved).toBeTypeOf("function");
      (plugin.configResolved as (config: ResolvedConfig) => void)({
        root: outputDirectory,
        build: { outDir: "." },
      } as ResolvedConfig);
      await (plugin.writeBundle as () => Promise<void>)();

      await expect(readFile(join(outputDirectory, "resources/index.html"), "utf8")).resolves.toBe(shell);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
