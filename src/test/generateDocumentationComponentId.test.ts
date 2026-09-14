// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateDocumentationComponentId } from "../../docs-src/.vitepress/generateDocumentationComponentId.mts";

const identityHash = (value: string) => value;
type VitePressConfig = {
  vue?: { features?: { componentIdGenerator?: typeof generateDocumentationComponentId } };
};
const vitepressConfig = (
  (await import(new URL("../../docs-src/.vitepress/config.mts", import.meta.url).href)) as {
    default: VitePressConfig;
  }
).default;

describe("documentation Vue component IDs", () => {
  it("passes the exact generator callback to VitePress", () => {
    expect(vitepressConfig.vue?.features?.componentIdGenerator).toBe(generateDocumentationComponentId);
  });

  it.each([
    [
      "ordinary node_modules fallback",
      "/workspace/node_modules/vitepress/dist/client/theme-default/components/VPBackdrop.vue",
      "node_modules/vitepress/dist/client/theme-default/components/VPBackdrop.vue",
    ],
    ["distinct package names", "/workspace/node_modules/first-package/index.js", "node_modules/first-package/index.js"],
    [
      "scoped packages",
      "/workspace/node_modules/@vue/runtime-core/dist/runtime-core.cjs.js",
      "node_modules/@vue/runtime-core/dist/runtime-core.cjs.js",
    ],
  ])("normalizes %s without losing package identity", (_name, filepath, expected) => {
    expect(generateDocumentationComponentId(filepath, "", false, identityHash)).toBe(expected);
  });

  it("ignores worktree and pnpm virtual-store paths for equivalent dependencies", () => {
    const source = "<template><div /></template>";
    const first = generateDocumentationComponentId(
      "../../../../worktrees/first/node_modules/.pnpm/vitepress@1.6.4_hash-a/node_modules/vitepress/dist/client/theme-default/components/VPBackdrop.vue",
      source,
      true,
      identityHash,
    );
    const second = generateDocumentationComponentId(
      "../../../../worktrees/second/node_modules/.pnpm/vitepress@1.6.4_hash-b/node_modules/vitepress/dist/client/theme-default/components/VPBackdrop.vue",
      source,
      true,
      identityHash,
    );

    expect(first).toBe(second);
  });

  it("keeps distinct component paths and source changes distinct", () => {
    const dependencyPath =
      "../../../../worktrees/docs/node_modules/.pnpm/vitepress@1.6.4_hash/node_modules/vitepress/dist/client/theme-default/components/VPBackdrop.vue";
    const first = generateDocumentationComponentId(dependencyPath, "<div>first</div>", true, identityHash);
    const otherPath = generateDocumentationComponentId(
      dependencyPath.replace("VPBackdrop", "VPNavBar"),
      "<div>first</div>",
      true,
      identityHash,
    );
    const otherSource = generateDocumentationComponentId(dependencyPath, "<div>second</div>", true, identityHash);

    expect(first).not.toBe(otherPath);
    expect(first).not.toBe(otherSource);
  });

  it("matches Vue's default hash input for project components in dev and production", () => {
    const filepath = "../../.vitepress/theme/Breadcrumbs.vue";
    const source = "<template><nav /></template>";

    expect(generateDocumentationComponentId(filepath, source, false, identityHash)).toBe(filepath);
    expect(generateDocumentationComponentId(filepath, source, true, identityHash)).toBe(filepath + source);
  });
});
