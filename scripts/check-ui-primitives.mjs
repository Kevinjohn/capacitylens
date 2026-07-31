import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const mcpManifest = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
const registryPin = packageManifest.scripts["ui:registry"].match(/shadcn@([^\s]+)/)?.[1];
const mcpPin = mcpManifest.mcpServers.shadcn.args.find((argument) => argument.startsWith("shadcn@"))?.slice(7);
if (!registryPin || registryPin !== mcpPin) {
  console.error(`shadcn tooling versions differ: registry=${registryPin ?? "missing"}, MCP=${mcpPin ?? "missing"}`);
  process.exit(1);
}

const sourceOwnedPrimitives = {
  "src/components/ui/alert-dialog.tsx": "7854a649e9b85a45d4bc4cbcc409fc192893e0d9eac40f4a5611a007a38d27b7",
  "src/components/ui/alert.tsx": "cb5b6abff8315ab84bbdd44350d0faf955b5934e0b16170bb14e17f81534f3fa",
  "src/components/ui/badge.tsx": "73ecb22f7de789caa013d8231a20dfa1d6bba4409c72a7718d9e8b3da2b6f597",
  "src/components/ui/button.tsx": "b55c92749d58f8ef7fb1117701ce0a2a82a50f08a12bbbe176b9ac32d886160f",
  "src/components/ui/dialog.tsx": "80c494bfa68cf59c812c86dada4f489da1f669abfbb9e614f6a63f82cd5bd47b",
  "src/components/ui/popover.tsx": "7305ffad7b25b357d5b773eb305414f4b9f3edbcfa76104a8d23d49bd22562e0",
  "src/components/ui/select.tsx": "341dbaaa24291a3bf0d2cf6695a61cc2e5b2805231aee8d4a74128a8b1335e69",
  "src/components/ui/sheet.tsx": "1b91386e5abe0b56ef8133d2b2f45ee3bf834be323ba14b1f22e473e3483fdaf",
  "src/components/ui/toggle-group.tsx": "9bb5d6398667d61659066bfc314162e53be7a4cc7b306f80b92f1602855c156b",
  "src/components/ui/tooltip.tsx": "00a6287d9fd1b8957f6fe7aa790e81312421bad7f4baced67ecf6d9354a2de5c",
};

const changed = [];
for (const [path, expected] of Object.entries(sourceOwnedPrimitives)) {
  const source = await readFile(new URL(`../${path}`, import.meta.url));
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expected) changed.push(path);
}

if (changed.length > 0) {
  console.error(
    [
      "Source-owned UI primitive contract changed:",
      ...changed.map((path) => `- ${path}`),
      "Review the pinned registry dry-run, preserve documented local behaviour, then update this contract deliberately.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `UI primitive contract verified (${Object.keys(sourceOwnedPrimitives).length} source-owned files; shadcn ${registryPin}).`,
);
