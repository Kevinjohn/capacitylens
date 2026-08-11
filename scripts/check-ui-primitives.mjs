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
  "src/components/ui/badge.tsx": "b694c63f9d671da39f1080fb6553e7193be113b3f9d43f582d03a62aaa12aedb",
  "src/components/ui/button.tsx": "6f008b9eeb35d318187132c0239c0add3b281813789e6d4dcf68a4f7c5fb46b2",
  "src/components/ui/dialog.tsx": "205eb95021029f859a758bcfb3cc1b06411e4115770e1b3832ac05dcb965562b",
  "src/components/ui/empty.tsx": "7a1a93dfb6e50fd48828adda4190d5c41d1d3eab291c90cdb15f5fc7ee85a35e",
  "src/components/ui/popover.tsx": "f61dada3673fe5a39c3a13bec2f4d13cda295b50284ec59468e33da70be8b3eb",
  "src/components/ui/select.tsx": "69293c2bc2ba73582bfc8e79622f98e3345b8df99a83e2447567e9c6fa1d010b",
  "src/components/ui/sheet.tsx": "6be9428d6cbd836f873775c304bbacce1d5466faef038e96b8946a418c566051",
  "src/components/ui/sidebar.tsx": "20448ce1be6a481a85e5e97a12fb1c65d6eff987330436a018df998553695e29",
  "src/components/ui/toggle.tsx": "edfc0cff9f0493b8fc3a69e76f3776ed76d7ca94051dd430788d6c3a37c7e23f",
  "src/components/ui/toggle-group.tsx": "e4c20c6688e2194eb0bfef615337b492617c9ea55d41bdb5f41964a8f1456fa9",
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
