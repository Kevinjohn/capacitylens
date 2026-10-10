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
  "src/components/ui/alert-dialog.tsx": "7ec870df4db50175f942e07200c63c28f6b59a488d0b0a85df1bc2fdb3730e0a",
  "src/components/ui/alert.tsx": "b3e3c87de1dec5d9348da1c79419f2bea6ed220a79ad647820b2feaefa9e8312",
  "src/components/ui/avatar.tsx": "7fc31dd728a32df52504fa4031e67d369b23ff827d9b561ed8e8837cca4ade78",
  "src/components/ui/badge.tsx": "8845be9df7d59857e142c71bfd1e64a877da4c180ce90f69622e5fd0921e3525",
  "src/components/ui/button.tsx": "57752f2be2f0f335b8f7c95aaba61635f007c15fe8ef2b0e336dc5681f9813f4",
  "src/components/ui/dialog.tsx": "2add1f7d11d06bcac533dad74f860e08076c345087683adecc5d1a1626a673f2",
  "src/components/ui/empty.tsx": "522574d7f555860d447b1d3cb7b9b137d1a68dbaa2fcf153dc27be7bd63dc1d6",
  "src/components/ui/item.tsx": "a750de65857517a9d1d8fdf0a547ffff9a1d43018c564ddfe3bfb41638cee2bc",
  "src/components/ui/popover.tsx": "eb92e773ddef29fe93191440c10d3197f0deebc40dbb3753f2e6716016c02b90",
  "src/components/ui/select.tsx": "e24ba0bf3a3bb18407167cd9356924e8992e4f3125e395aaeb9deee284a728dd",
  "src/components/ui/sheet.tsx": "f7c065e7d624885909019360a6acfe4ccb9fabfb1383f52b5c41a2e92354c7c1",
  "src/components/ui/sidebar.tsx": "b2332c1c67fb919ebd8a58fa6abc9a92b534e2f1aabef1723f434d20295d3697",
  "src/components/ui/toggle.tsx": "b69ccd53ce2f6877ba7ded647ce4eeaa1e6a13d3826e6b0c81cc94aefe950f3b",
  "src/components/ui/toggle-group.tsx": "6c68693b821ac32b07ccc0bc929378e1c99ca87a2d42505b34957e0597277677",
  "src/components/ui/tooltip.tsx": "081459726b49b3bcb461d2b926280b6b89e6b25c156fa9cf765ee4fd6303a4e9",
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
