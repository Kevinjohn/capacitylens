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
  "src/components/ui/alert.tsx": "bd29934aa20bbbec8a3a8288760e1b1bd14fa417833eed81aa7bcbe3c1952d4a",
  "src/components/ui/avatar.tsx": "3d0fefe17e5b306b0988c179a0f1061e6db602c3737d390d53a8b446a05afaed",
  "src/components/ui/badge.tsx": "3de25b19c1f7102ecae4cdde65346c1df6937aa4757dc0e96dd2235e45ab8cfe",
  "src/components/ui/button.tsx": "2b496d42d6ee283218eb09840f5ac80e9e70d7bc7d0c4a8aafb12ab6a6545dd5",
  "src/components/ui/dialog.tsx": "53579f839edf9ba006c680cbf7f3921d4fed0d7ff175f6a25556dba12f0a1d35",
  "src/components/ui/empty.tsx": "58d34dee3134788a7589b90da577dc4c2a3f3b8ff08aad88c793ae15795eaa2e",
  "src/components/ui/popover.tsx": "7305ffad7b25b357d5b773eb305414f4b9f3edbcfa76104a8d23d49bd22562e0",
  "src/components/ui/select.tsx": "8599b341223be4c0cd302ccd3115caddf0231f76a5263931953410d8d270b8b0",
  "src/components/ui/sheet.tsx": "96e98f094c75fed4bc0a51fc13a415ef1571440f6af00a27628382e6396a0369",
  "src/components/ui/sidebar.tsx": "c33615478512cbcfa35642b5ddea61ec0b1d580689b43d2861764beaf5bd763d",
  "src/components/ui/toggle-group.tsx": "13d5432461ff342a30e5b8fddd2987fd9a50b92cdcb4df261099b68a8692bf85",
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
