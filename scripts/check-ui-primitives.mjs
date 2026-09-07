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
  "src/components/ui/alert-dialog.tsx": "349db420b7bbf35740d3ab12ed59d43890a7c1e3226254aec3565958a9a4dcfe",
  "src/components/ui/alert.tsx": "ebc8fc4919d4fb9df5fe2ec21f79b857e842aa175d48334956e201f61a774455",
  "src/components/ui/avatar.tsx": "b890b5ca3e769447cf5796c0b52a9013d95819084775de1118c9eba0b64780fb",
  "src/components/ui/badge.tsx": "88af8875cd6388974fd6c484cd1a0edde37daebc5ae4dc2dbac6d86be35d6f8e",
  "src/components/ui/button.tsx": "b38872acc994a075150fe2c9cf22d2d3f0820d6e7081457a6742d56aa3400ad5",
  "src/components/ui/dialog.tsx": "205eb95021029f859a758bcfb3cc1b06411e4115770e1b3832ac05dcb965562b",
  "src/components/ui/empty.tsx": "7a1a93dfb6e50fd48828adda4190d5c41d1d3eab291c90cdb15f5fc7ee85a35e",
  "src/components/ui/item.tsx": "79bc4c78f8c16dc2c31c8ff1d24a552d9a4925ecfe60065c123022b712374580",
  "src/components/ui/popover.tsx": "f61dada3673fe5a39c3a13bec2f4d13cda295b50284ec59468e33da70be8b3eb",
  "src/components/ui/select.tsx": "7436a6e6038632222389ff5b91cb2144776679305b58deaf143b1fef1c5bcaeb",
  "src/components/ui/sheet.tsx": "6be9428d6cbd836f873775c304bbacce1d5466faef038e96b8946a418c566051",
  "src/components/ui/sidebar.tsx": "4fcded8e5ea74e8d10f2a6cab324bc2137082df0f671e861f612cda5a6fb1469",
  "src/components/ui/toggle.tsx": "edfc0cff9f0493b8fc3a69e76f3776ed76d7ca94051dd430788d6c3a37c7e23f",
  "src/components/ui/toggle-group.tsx": "1449e176d081571505dbb4c5cdd1118534750fa8a837d5faafc65064412e3414",
  "src/components/ui/tooltip.tsx": "ad91c94f267ab82affe152c8cc20cfa78c2d7225af8f83618e3ec5a925b734aa",
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
