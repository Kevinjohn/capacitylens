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
  "src/components/ui/alert.tsx": "92d9102a9071def3e6de8fff46c66e3cd732680178a3bb020e41744d4e0039f3",
  "src/components/ui/avatar.tsx": "7fc31dd728a32df52504fa4031e67d369b23ff827d9b561ed8e8837cca4ade78",
  "src/components/ui/badge.tsx": "360f48a4e7bd85782b10cb73315771523aa5591016844ce1b947230898c1eea4",
  "src/components/ui/button.tsx": "9e819c5d0226bd27714e7202939972dfb547b3d5ac49948406f872e582c0bd3f",
  "src/components/ui/dialog.tsx": "2add1f7d11d06bcac533dad74f860e08076c345087683adecc5d1a1626a673f2",
  "src/components/ui/empty.tsx": "2ed1475bfb2c05dde82474b3e91ff387472edc75c06caf84153ac17d9e95a920",
  "src/components/ui/item.tsx": "1ba619dc4832a99fd3650177ec1fa4f4e5d68104f19c73b0d6b906b5d3cc817e",
  "src/components/ui/popover.tsx": "eb92e773ddef29fe93191440c10d3197f0deebc40dbb3753f2e6716016c02b90",
  "src/components/ui/select.tsx": "e24ba0bf3a3bb18407167cd9356924e8992e4f3125e395aaeb9deee284a728dd",
  "src/components/ui/sheet.tsx": "f7c065e7d624885909019360a6acfe4ccb9fabfb1383f52b5c41a2e92354c7c1",
  "src/components/ui/sidebar.tsx": "b81b8ffa4f7b1e094caf31b2f4a591690b610cbd83ef8f10c20045698e9d9524",
  "src/components/ui/toggle.tsx": "ee5a287b35aa18fda4c9e961b0876bf3223896993fdf3d8f177803ea1b9a8631",
  "src/components/ui/toggle-group.tsx": "09df43aa58939b643480cad180aa0d3aa3b798c1104e52cc9bef7ca51c1d4df0",
  "src/components/ui/tooltip.tsx": "0d6c390975f39666a5c4eaff607d1dd0b83997fc683bb5290feab92d270ba9c9",
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
